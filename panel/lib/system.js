import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import dns from 'node:dns/promises';

const MAX_HISTORY = 60;

export function createSystemMonitor({ dataDir, backupsDir, mcDomain }) {
  const history = [];
  let cachedNetwork = {
    checkedAt: 0,
    publicIp: null,
    domainIps: [],
    dnsSynced: null,
    error: null,
  };

  function readHostTemperature() {
    const thermalRoots = ['/host/thermal', '/sys/class/thermal'];
    for (const root of thermalRoots) {
      if (!fs.existsSync(root)) continue;
      try {
        const entries = fs.readdirSync(root).filter((e) => e.startsWith('thermal_zone'));
        let maxTemp = null;
        const sensors = [];
        for (const entry of entries) {
          const tempPath = path.join(root, entry, 'temp');
          const typePath = path.join(root, entry, 'type');
          if (!fs.existsSync(tempPath)) continue;
          const raw = Number(fs.readFileSync(tempPath, 'utf8').trim());
          if (!Number.isFinite(raw) || raw <= 0) continue;
          const celsius = raw > 1000 ? raw / 1000 : raw;
          if (celsius > 130) continue;
          let type = entry;
          try {
            type = fs.readFileSync(typePath, 'utf8').trim() || entry;
          } catch {
            // ignore
          }
          sensors.push({ name: type, celsius: Number(celsius.toFixed(1)) });
          if (maxTemp === null || celsius > maxTemp) maxTemp = celsius;
        }
        if (maxTemp !== null) {
          return {
            celsius: Number(maxTemp.toFixed(1)),
            status: maxTemp >= 78 ? 'critical' : maxTemp >= 65 ? 'warm' : 'ok',
            sensors,
          };
        }
      } catch {
        // ignore
      }
    }
    return { celsius: null, status: 'unavailable', sensors: [] };
  }

  function readHostMemory() {
    const meminfoPaths = ['/host/meminfo', '/proc/meminfo'];
    for (const p of meminfoPaths) {
      if (!fs.existsSync(p)) continue;
      try {
        const content = fs.readFileSync(p, 'utf8');
        const map = {};
        for (const line of content.split('\n')) {
          const m = line.match(/^([^:]+):\s+(\d+)\s+kB/);
          if (m) map[m[1]] = Number(m[2]) * 1024;
        }
        if (map.MemTotal) {
          const totalBytes = map.MemTotal;
          const availableBytes = map.MemAvailable ?? map.MemFree ?? 0;
          const usedBytes = Math.max(0, totalBytes - availableBytes);
          const swapTotalBytes = map.SwapTotal || 0;
          const swapFreeBytes = map.SwapFree || 0;
          const swapUsedBytes = Math.max(0, swapTotalBytes - swapFreeBytes);
          return {
            totalBytes,
            usedBytes,
            availableBytes,
            percent: Number(((usedBytes / totalBytes) * 100).toFixed(1)),
            swapTotalBytes,
            swapUsedBytes,
            swapPercent:
              swapTotalBytes > 0 ? Number(((swapUsedBytes / swapTotalBytes) * 100).toFixed(1)) : 0,
          };
        }
      } catch {
        // fallback below
      }
    }

    const totalBytes = os.totalmem();
    const availableBytes = os.freemem();
    const usedBytes = Math.max(0, totalBytes - availableBytes);
    return {
      totalBytes,
      usedBytes,
      availableBytes,
      percent: totalBytes > 0 ? Number(((usedBytes / totalBytes) * 100).toFixed(1)) : 0,
      swapTotalBytes: 0,
      swapUsedBytes: 0,
      swapPercent: 0,
    };
  }

  function readHostLoad() {
    const loadPaths = ['/host/loadavg', '/proc/loadavg'];
    for (const p of loadPaths) {
      if (!fs.existsSync(p)) continue;
      try {
        const parts = fs.readFileSync(p, 'utf8').trim().split(/\s+/);
        if (parts.length >= 3) {
          return [Number(parts[0]), Number(parts[1]), Number(parts[2])];
        }
      } catch {
        // ignore
      }
    }
    return os.loadavg().map((n) => Number(n.toFixed(2)));
  }

  function readDiskUsage(targetDir) {
    try {
      const existing = fs.existsSync(targetDir) ? targetDir : path.dirname(targetDir);
      const stats = fs.statfsSync(existing);
      const totalBytes = Number(stats.blocks) * Number(stats.bsize);
      const freeBytes = Number(stats.bavail) * Number(stats.bsize);
      const usedBytes = Math.max(0, totalBytes - freeBytes);
      return {
        totalBytes,
        usedBytes,
        freeBytes,
        percent: totalBytes > 0 ? Number(((usedBytes / totalBytes) * 100).toFixed(1)) : 0,
      };
    } catch {
      return null;
    }
  }

  function getSnapshot() {
    const memory = readHostMemory();
    const temp = readHostTemperature();
    const load = readHostLoad();
    const cpus = os.cpus();
    const diskData = readDiskUsage(dataDir);
    const diskBackups = readDiskUsage(backupsDir);

    return {
      arch: os.arch(),
      platform: os.platform(),
      hostname: os.hostname(),
      cpuCores: cpus.length || 1,
      cpuModel: cpus[0]?.model || 'ARM64 SBC',
      loadAvg: load,
      uptimeSeconds: Math.floor(os.uptime()),
      memory,
      temperature: temp,
      disk: diskData || diskBackups,
    };
  }

  function recordHistoryPoint(mcStats) {
    const snap = getSnapshot();
    const point = {
      ts: Date.now(),
      hostMemPercent: snap.memory.percent,
      mcMemMB: mcStats ? Math.round(mcStats.memUsedBytes / (1024 * 1024)) : 0,
      mcCpuPercent: mcStats ? mcStats.cpuPercent : 0,
      tempC: snap.temperature.celsius,
    };
    history.push(point);
    if (history.length > MAX_HISTORY) {
      history.shift();
    }
    return point;
  }

  function getHistory() {
    return history;
  }

  async function checkPublicNetwork(force = false) {
    const now = Date.now();
    if (!force && now - cachedNetwork.checkedAt < 5 * 60 * 1000 && cachedNetwork.publicIp) {
      return cachedNetwork;
    }

    let publicIp = null;
    let error = null;

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 4000);
      const res = await fetch('https://1.1.1.1/cdn-cgi/trace', { signal: controller.signal });
      clearTimeout(timeout);
      if (res.ok) {
        const text = await res.text();
        const match = text.match(/^ip=(.+)$/m);
        if (match) publicIp = match[1].trim();
      }
    } catch (err) {
      error = err.message;
    }

    let domainIps = [];
    if (mcDomain) {
      try {
        domainIps = await dns.resolve4(mcDomain);
      } catch {
        domainIps = [];
      }
    }

    const dnsSynced =
      publicIp && domainIps.length > 0 ? domainIps.includes(publicIp) : null;

    cachedNetwork = {
      checkedAt: now,
      publicIp,
      domainIps,
      dnsSynced,
      error,
    };
    return cachedNetwork;
  }

  return {
    getSnapshot,
    recordHistoryPoint,
    getHistory,
    checkPublicNetwork,
  };
}
