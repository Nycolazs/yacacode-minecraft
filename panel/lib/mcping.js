import net from 'node:net';

function writeVarInt(value) {
  const bytes = [];
  let v = value >>> 0;
  do {
    let temp = v & 0x7f;
    v >>>= 7;
    if (v !== 0) temp |= 0x80;
    bytes.push(temp);
  } while (v !== 0);
  return Buffer.from(bytes);
}

function readVarInt(buffer, offset = 0) {
  let numRead = 0;
  let result = 0;
  let byte;
  do {
    if (offset + numRead >= buffer.length) return null;
    byte = buffer[offset + numRead];
    result |= (byte & 0x7f) << (7 * numRead);
    numRead += 1;
    if (numRead > 5) throw new Error('VarInt muito grande');
  } while ((byte & 0x80) !== 0);
  return { value: result, length: numRead };
}

function packData(buf) {
  return Buffer.concat([writeVarInt(buf.length), buf]);
}

function flattenMotd(desc) {
  if (!desc) return '';
  if (typeof desc === 'string') return desc;
  let out = desc.text || '';
  if (Array.isArray(desc.extra)) {
    for (const part of desc.extra) {
      out += flattenMotd(part);
    }
  }
  return out;
}

export async function pingMinecraftServer(host, port = 25565, timeoutMs = 3000) {
  const startTime = Date.now();
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let settled = false;
    let recvBuf = Buffer.alloc(0);

    const timer = setTimeout(() => {
      done({ online: false, error: 'timeout' });
    }, timeoutMs);

    function done(result) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      resolve(result);
    }

    socket.on('error', (err) => {
      done({ online: false, error: err.code || err.message });
    });

    socket.on('data', (chunk) => {
      recvBuf = Buffer.concat([recvBuf, chunk]);
      try {
        const pktLen = readVarInt(recvBuf, 0);
        if (!pktLen) return;
        const totalSize = pktLen.length + pktLen.value;
        if (recvBuf.length < totalSize) return;

        let pos = pktLen.length;
        const pktId = readVarInt(recvBuf, pos);
        if (!pktId || pktId.value !== 0x00) {
          done({ online: false, error: 'invalid_packet' });
          return;
        }
        pos += pktId.length;

        const strLen = readVarInt(recvBuf, pos);
        if (!strLen) return;
        pos += strLen.length;

        const jsonStr = recvBuf.toString('utf8', pos, pos + strLen.value);
        const data = JSON.parse(jsonStr);
        const latencyMs = Date.now() - startTime;

        done({
          online: true,
          latencyMs,
          version: data.version?.name || 'Desconhecida',
          protocol: data.version?.protocol ?? null,
          players: {
            online: data.players?.online ?? 0,
            max: data.players?.max ?? 0,
            sample: Array.isArray(data.players?.sample)
              ? data.players.sample.map((p) => ({
                  name: p.name,
                  id: p.id,
                  edition: p.name?.startsWith('.') ? 'bedrock' : 'java',
                }))
              : [],
          },
          motd: flattenMotd(data.description).replace(/\u00A7[0-9a-fk-or]/gi, ''),
          hasFavicon: Boolean(data.favicon),
        });
      } catch (err) {
        done({ online: false, error: err.message });
      }
    });

    socket.connect(Number(port) || 25565, host, () => {
      const hostBuf = Buffer.from(host, 'utf8');
      const portBuf = Buffer.alloc(2);
      portBuf.writeUInt16BE(Number(port) || 25565, 0);

      const handshake = Buffer.concat([
        writeVarInt(0x00), // Packet ID
        writeVarInt(769), // Protocol version (aceito para SLP em versões recentes)
        writeVarInt(hostBuf.length),
        hostBuf,
        portBuf,
        writeVarInt(1), // Next state: Status
      ]);

      socket.write(packData(handshake));
      socket.write(packData(writeVarInt(0x00))); // Status Request
    });
  });
}
