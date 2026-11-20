import net from 'node:net';

const TYPE_AUTH = 3;
const TYPE_AUTH_RESPONSE = 2;
const TYPE_EXEC = 2;
const TYPE_RESPONSE = 0;

function encodePacket(id, type, body) {
  const bodyBuf = Buffer.from(body, 'utf8');
  const length = 4 + 4 + bodyBuf.length + 2;
  const buf = Buffer.alloc(4 + length);
  buf.writeInt32LE(length, 0);
  buf.writeInt32LE(id, 4);
  buf.writeInt32LE(type, 8);
  bodyBuf.copy(buf, 12);
  buf.writeUInt16LE(0, 12 + bodyBuf.length);
  return buf;
}

function parsePackets(buffer) {
  const packets = [];
  let offset = 0;
  while (offset + 4 <= buffer.length) {
    const len = buffer.readInt32LE(offset);
    if (len < 10 || len > 1024 * 1024) {
      throw new Error('Pacote RCON corrompido ou fora do limite.');
    }
    if (offset + 4 + len > buffer.length) {
      break;
    }
    const id = buffer.readInt32LE(offset + 4);
    const type = buffer.readInt32LE(offset + 8);
    const body = buffer.toString('utf8', offset + 12, offset + 4 + len - 2);
    packets.push({ id, type, body });
    offset += 4 + len;
  }
  return { packets, remaining: buffer.subarray(offset) };
}

export function stripMinecraftColors(text) {
  return String(text || '').replace(/\u00A7[0-9a-fk-or]/gi, '');
}

export function createRconClient({ host, port, password, timeoutMs = 5000 }) {
  async function send(command) {
    if (!password) {
      throw new Error('RCON_PASSWORD não configurado.');
    }
    const cmd = String(command || '').trim();
    if (!cmd) {
      throw new Error('Comando vazio.');
    }

    return new Promise((resolve, reject) => {
      const socket = new net.Socket();
      let settled = false;
      let authenticated = false;
      let recvBuf = Buffer.alloc(0);
      const chunks = [];

      const authId = 101;
      const cmdId = 102;
      const endSentinelId = 103;

      const timer = setTimeout(() => {
        finish(new Error('Tempo esgotado ao conectar no RCON do Minecraft.'));
      }, timeoutMs);

      function finish(err, result) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        socket.destroy();
        if (err) reject(err);
        else resolve(result);
      }

      socket.on('error', (err) => {
        finish(new Error(`Falha RCON: ${err.code || err.message}`));
      });

      socket.on('close', () => {
        if (!settled) {
          if (authenticated && chunks.length > 0) {
            finish(null, chunks.join(''));
          } else {
            finish(new Error('Conexão RCON encerrada inesperadamente.'));
          }
        }
      });

      socket.on('data', (data) => {
        recvBuf = Buffer.concat([recvBuf, data]);
        let parsed;
        try {
          parsed = parsePackets(recvBuf);
        } catch (err) {
          finish(err);
          return;
        }
        recvBuf = parsed.remaining;

        for (const pkt of parsed.packets) {
          if (!authenticated) {
            if (pkt.type === TYPE_AUTH_RESPONSE) {
              if (pkt.id === -1 || pkt.id !== authId) {
                finish(new Error('Autenticação RCON recusada (verifique RCON_PASSWORD).'));
                return;
              }
              authenticated = true;
              // Envia comando + pacote sentinela para detectar fim de resposta multi-pacote
              socket.write(encodePacket(cmdId, TYPE_EXEC, cmd));
              socket.write(encodePacket(endSentinelId, TYPE_RESPONSE, ''));
            }
          } else {
            if (pkt.id === cmdId) {
              chunks.push(pkt.body);
            } else if (pkt.id === endSentinelId) {
              finish(null, chunks.join(''));
              return;
            }
          }
        }
      });

      socket.connect(Number(port) || 25575, host, () => {
        socket.write(encodePacket(authId, TYPE_AUTH, password));
      });
    });
  }

  return { send };
}
