import http from 'node:http';
import fs from 'node:fs';

const DEFAULT_SOCKET = '/var/run/docker.sock';

export function createDockerClient(socketPath = DEFAULT_SOCKET) {
  function isAvailable() {
    try {
      return fs.existsSync(socketPath);
    } catch {
      return false;
    }
  }

  function request(method, path, body = null, timeoutMs = 15000) {
    return new Promise((resolve, reject) => {
      if (!isAvailable()) {
        reject(new Error('Docker socket indisponível (/var/run/docker.sock).'));
        return;
      }

      const payload = body !== null ? JSON.stringify(body) : null;
      const headers = {};
      if (payload !== null) {
        headers['Content-Type'] = 'application/json';
        headers['Content-Length'] = Buffer.byteLength(payload);
      }

      const req = http.request(
        {
          socketPath,
          path,
          method,
          headers,
          timeout: timeoutMs,
        },
        (res) => {
          const chunks = [];
          res.on('data', (c) => chunks.push(c));
          res.on('end', () => {
            const text = Buffer.concat(chunks).toString('utf8');
            let json = null;
            try {
              json = text ? JSON.parse(text) : null;
            } catch {
              json = text;
            }
            if (res.statusCode >= 200 && res.statusCode < 300) {
              resolve({ status: res.statusCode, data: json });
            } else {
              const msg =
                (json && typeof json === 'object' && json.message) ||
                (typeof json === 'string' && json) ||
                `Docker HTTP ${res.statusCode}`;
              const err = new Error(msg);
              err.statusCode = res.statusCode;
              reject(err);
            }
          });
        }
      );

      req.on('timeout', () => {
        req.destroy(new Error('Timeout na comunicação com o Docker Engine.'));
      });
      req.on('error', (err) => reject(err));

      if (payload !== null) {
        req.write(payload);
      }
      req.end();
    });
  }

  async function inspectContainer(name) {
    try {
      const { data } = await request('GET', `/containers/${encodeURIComponent(name)}/json`);
      return {
        exists: true,
        id: data.Id?.slice(0, 12) || null,
        name: (data.Name || name).replace(/^\//, ''),
        image: data.Config?.Image || '',
        tty: Boolean(data.Config?.Tty),
        state: data.State?.Status || 'unknown',
        running: Boolean(data.State?.Running),
        restarting: Boolean(data.State?.Restarting),
        startedAt: data.State?.StartedAt || null,
        finishedAt: data.State?.FinishedAt || null,
        restartCount: data.RestartCount || 0,
        health: data.State?.Health?.Status || null,
        memLimitBytes: data.HostConfig?.Memory || 0,
      };
    } catch (err) {
      if (err.statusCode === 404) {
        return { exists: false, name, state: 'not_found', running: false };
      }
      return { exists: false, name, state: 'unavailable', running: false, error: err.message };
    }
  }

  async function getContainerStats(name) {
    try {
      const { data } = await request(
        'GET',
        `/containers/${encodeURIComponent(name)}/stats?stream=false`,
        null,
        10000
      );
      if (!data || typeof data !== 'object') return null;

      // Cálculo de CPU % normalizado (0-100% da capacidade total da placa)
      const cpuDelta =
        (data.cpu_stats?.cpu_usage?.total_usage || 0) -
        (data.precpu_stats?.cpu_usage?.total_usage || 0);
      const systemDelta =
        (data.cpu_stats?.system_cpu_usage || 0) - (data.precpu_stats?.system_cpu_usage || 0);
      const onlineCpus =
        data.cpu_stats?.online_cpus ||
        data.cpu_stats?.cpu_usage?.percpu_usage?.length ||
        1;
      let cpuPercent = 0;
      if (systemDelta > 0 && cpuDelta > 0) {
        cpuPercent = Math.min(100, (cpuDelta / systemDelta) * 100);
      }
      const cpuCoresUsed =
        systemDelta > 0 && cpuDelta > 0
          ? Number(((cpuDelta / systemDelta) * onlineCpus).toFixed(2))
          : 0;

      // Memória RSS real (descontando page cache quando presente em cgroup v1/v2)
      const memUsageRaw = data.memory_stats?.usage || 0;
      const cache =
        data.memory_stats?.stats?.inactive_file ??
        data.memory_stats?.stats?.cache ??
        0;
      const memUsedBytes = Math.max(0, memUsageRaw - cache);
      const memLimitBytes = data.memory_stats?.limit || 0;
      const memPercent = memLimitBytes > 0 ? (memUsedBytes / memLimitBytes) * 100 : 0;

      // Rede
      let rxBytes = 0;
      let txBytes = 0;
      if (data.networks && typeof data.networks === 'object') {
        for (const iface of Object.values(data.networks)) {
          rxBytes += iface.rx_bytes || 0;
          txBytes += iface.tx_bytes || 0;
        }
      }

      return {
        cpuPercent: Number(cpuPercent.toFixed(1)),
        cpuCoresUsed,
        onlineCpus,
        memUsedBytes,
        memLimitBytes,
        memPercent: Number(memPercent.toFixed(1)),
        rxBytes,
        txBytes,
      };
    } catch {
      return null;
    }
  }

  async function controlContainer(name, action) {
    const allowed = new Set(['start', 'stop', 'restart', 'kill']);
    if (!allowed.has(action)) {
      throw new Error(`Ação inválida: ${action}`);
    }
    const query = action === 'stop' || action === 'restart' ? '?t=60' : '';
    try {
      await request('POST', `/containers/${encodeURIComponent(name)}/${action}${query}`, null, 75000);
      return { ok: true };
    } catch (err) {
      // HTTP 304 = container já estava iniciado/parado
      if (err.statusCode === 304) {
        return { ok: true, note: 'already_in_state' };
      }
      throw err;
    }
  }

  async function execInContainer(name, cmdArray) {
    const createRes = await request(
      'POST',
      `/containers/${encodeURIComponent(name)}/exec`,
      {
        AttachStdout: true,
        AttachStderr: true,
        Cmd: cmdArray,
      },
      15000
    );
    const execId = createRes.data?.Id;
    if (!execId) {
      throw new Error('Falha ao criar comando exec no container.');
    }

    return new Promise((resolve, reject) => {
      const payload = JSON.stringify({ Detach: false, Tty: false });
      const req = http.request(
        {
          socketPath,
          path: `/exec/${encodeURIComponent(execId)}/start`,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(payload),
          },
          timeout: 180000,
        },
        (res) => {
          const chunks = [];
          res.on('data', (c) => chunks.push(c));
          res.on('end', () => {
            const raw = Buffer.concat(chunks);
            const cleaned = demuxDockerBuffer(raw);
            resolve({ ok: true, output: cleaned });
          });
        }
      );
      req.on('error', reject);
      req.on('timeout', () => req.destroy(new Error('Timeout ao executar comando no container.')));
      req.write(payload);
      req.end();
    });
  }

  async function streamContainerLogs(name, { tail = 150, onLine, onEnd, onError }) {
    if (!isAvailable()) {
      onError?.(new Error('Docker socket indisponível.'));
      return () => {};
    }

    const info = await inspectContainer(name);
    const isTty = Boolean(info.tty);
    const tailCount = Math.min(Math.max(Number(tail) || 150, 10), 1000);

    let closed = false;
    let lineRemainder = '';
    let muxBuffer = Buffer.alloc(0);

    function emitText(text) {
      lineRemainder += text;
      const lines = lineRemainder.split(/\r?\n/);
      lineRemainder = lines.pop() ?? '';
      for (const line of lines) {
        if (line.length > 0) onLine?.(line);
      }
    }

    const req = http.request(
      {
        socketPath,
        path: `/containers/${encodeURIComponent(name)}/logs?follow=1&stdout=1&stderr=1&tail=${tailCount}&timestamps=0`,
        method: 'GET',
      },
      (res) => {
        if (res.statusCode !== 200) {
          onError?.(new Error(`Falha ao abrir logs do container (HTTP ${res.statusCode}).`));
          return;
        }

        res.on('data', (chunk) => {
          if (closed) return;
          if (isTty) {
            emitText(chunk.toString('utf8'));
          } else {
            muxBuffer = Buffer.concat([muxBuffer, chunk]);
            while (muxBuffer.length >= 8) {
              const streamType = muxBuffer[0];
              const zeroPad = muxBuffer[1] === 0 && muxBuffer[2] === 0 && muxBuffer[3] === 0;
              if (!zeroPad || (streamType !== 1 && streamType !== 2 && streamType !== 0)) {
                // Fallback para texto puro caso não esteja multiplexado
                emitText(muxBuffer.toString('utf8'));
                muxBuffer = Buffer.alloc(0);
                break;
              }
              const frameLen = muxBuffer.readUInt32BE(4);
              if (muxBuffer.length < 8 + frameLen) break;
              const payload = muxBuffer.subarray(8, 8 + frameLen).toString('utf8');
              muxBuffer = muxBuffer.subarray(8 + frameLen);
              emitText(payload);
            }
          }
        });

        res.on('end', () => {
          if (lineRemainder) {
            onLine?.(lineRemainder);
            lineRemainder = '';
          }
          onEnd?.();
        });
      }
    );

    req.on('error', (err) => {
      if (!closed) onError?.(err);
    });
    req.end();

    return () => {
      closed = true;
      req.destroy();
    };
  }

  async function getContainerLogsTail(name, lines = 40) {
    if (!isAvailable()) {
      return [];
    }
    const tailCount = Math.min(Math.max(Number(lines) || 40, 5), 200);
    return new Promise((resolve, reject) => {
      const req = http.request(
        {
          socketPath,
          path: `/containers/${encodeURIComponent(name)}/logs?stdout=1&stderr=1&tail=${tailCount}&timestamps=0`,
          method: 'GET',
          timeout: 8000,
        },
        (res) => {
          const chunks = [];
          res.on('data', (c) => chunks.push(c));
          res.on('end', () => {
            if (res.statusCode !== 200) {
              resolve([]);
              return;
            }
            const raw = Buffer.concat(chunks);
            const text = demuxDockerBuffer(raw);
            const cleaned = text
              .replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '')
              .split(/\r?\n/)
              .map((l) => l.trimEnd())
              .filter(Boolean);
            resolve(cleaned.slice(-tailCount));
          });
        }
      );
      req.on('timeout', () => req.destroy(new Error('Timeout ao ler logs do container.')));
      req.on('error', reject);
      req.end();
    });
  }

  return {
    isAvailable,
    inspectContainer,
    getContainerStats,
    controlContainer,
    execInContainer,
    streamContainerLogs,
    getContainerLogsTail,
  };
}

function demuxDockerBuffer(buf) {
  let offset = 0;
  let out = '';
  while (offset + 8 <= buf.length) {
    const streamType = buf[offset];
    const zeroPad = buf[offset + 1] === 0 && buf[offset + 2] === 0 && buf[offset + 3] === 0;
    if (!zeroPad || (streamType !== 1 && streamType !== 2)) {
      return buf.toString('utf8');
    }
    const len = buf.readUInt32BE(offset + 4);
    if (offset + 8 + len > buf.length) break;
    out += buf.subarray(offset + 8, offset + 8 + len).toString('utf8');
    offset += 8 + len;
  }
  return out || buf.toString('utf8');
}
