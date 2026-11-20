import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

// ============================================================================
// Leitor leve de NBT (Java Edition .dat) e Estatísticas de Jogadores (Zero-deps)
// ============================================================================

const TAG_END = 0;
const TAG_BYTE = 1;
const TAG_SHORT = 2;
const TAG_INT = 3;
const TAG_LONG = 4;
const TAG_FLOAT = 5;
const TAG_DOUBLE = 6;
const TAG_BYTE_ARRAY = 7;
const TAG_STRING = 8;
const TAG_LIST = 9;
const TAG_COMPOUND = 10;
const TAG_INT_ARRAY = 11;
const TAG_LONG_ARRAY = 12;

const GAMEMODE_NAMES = {
  0: 'Survival',
  1: 'Creative',
  2: 'Adventure',
  3: 'Spectator',
};

const DIFFICULTY_NAMES = {
  0: 'Peaceful',
  1: 'Easy',
  2: 'Normal',
  3: 'Hard',
};

export function parseNbtBuffer(rawBuffer) {
  let buf = rawBuffer;
  // Detecta gzip magic bytes (0x1f 0x8b)
  if (buf.length >= 2 && buf[0] === 0x1f && buf[1] === 0x8b) {
    buf = zlib.gunzipSync(buf);
  }
  let offset = 0;

  function ensure(n) {
    if (offset + n > buf.length) {
      throw new Error('Buffer NBT truncado.');
    }
  }

  function readByte() {
    ensure(1);
    const v = buf.readInt8(offset);
    offset += 1;
    return v;
  }

  function readUShort() {
    ensure(2);
    const v = buf.readUInt16BE(offset);
    offset += 2;
    return v;
  }

  function readShort() {
    ensure(2);
    const v = buf.readInt16BE(offset);
    offset += 2;
    return v;
  }

  function readInt() {
    ensure(4);
    const v = buf.readInt32BE(offset);
    offset += 4;
    return v;
  }

  function readLong() {
    ensure(8);
    const v = buf.readBigInt64BE(offset);
    offset += 8;
    if (v > BigInt(Number.MAX_SAFE_INTEGER) || v < BigInt(Number.MIN_SAFE_INTEGER)) {
      return v.toString();
    }
    return Number(v);
  }

  function readFloat() {
    ensure(4);
    const v = buf.readFloatBE(offset);
    offset += 4;
    return v;
  }

  function readDouble() {
    ensure(8);
    const v = buf.readDoubleBE(offset);
    offset += 8;
    return v;
  }

  function readString() {
    const len = readUShort();
    ensure(len);
    const s = buf.toString('utf8', offset, offset + len);
    offset += len;
    return s;
  }

  function readPayload(tagType, depth = 0) {
    if (depth > 32) throw new Error('Profundidade NBT excedida.');
    switch (tagType) {
      case TAG_BYTE:
        return readByte();
      case TAG_SHORT:
        return readShort();
      case TAG_INT:
        return readInt();
      case TAG_LONG:
        return readLong();
      case TAG_FLOAT:
        return readFloat();
      case TAG_DOUBLE:
        return readDouble();
      case TAG_BYTE_ARRAY: {
        const len = readInt();
        ensure(len);
        offset += len;
        return `[ByteArray(${len})]`;
      }
      case TAG_STRING:
        return readString();
      case TAG_LIST: {
        const itemType = readByte();
        const len = readInt();
        const arr = [];
        for (let i = 0; i < len; i += 1) {
          arr.push(readPayload(itemType, depth + 1));
        }
        return arr;
      }
      case TAG_COMPOUND: {
        const obj = {};
        while (offset < buf.length) {
          const t = readByte();
          if (t === TAG_END) break;
          const name = readString();
          obj[name] = readPayload(t, depth + 1);
        }
        return obj;
      }
      case TAG_INT_ARRAY: {
        const len = readInt();
        const arr = [];
        for (let i = 0; i < len; i += 1) arr.push(readInt());
        return arr;
      }
      case TAG_LONG_ARRAY: {
        const len = readInt();
        ensure(len * 8);
        offset += len * 8;
        return `[LongArray(${len})]`;
      }
      default:
        throw new Error(`Tag NBT desconhecida: ${tagType}`);
    }
  }

  const rootType = readByte();
  if (rootType !== TAG_COMPOUND) {
    throw new Error('Raiz NBT não é Compound.');
  }
  readString(); // root name
  return readPayload(TAG_COMPOUND, 0);
}

function safeReadJson(filePath, fallback = null) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function summarizePlayerNbt(nbt, mtimeIso = null) {
  if (!nbt || typeof nbt !== 'object') return null;
  const pos = Array.isArray(nbt.Pos) && nbt.Pos.length === 3
    ? {
        x: Math.round(Number(nbt.Pos[0])),
        y: Math.round(Number(nbt.Pos[1])),
        z: Math.round(Number(nbt.Pos[2])),
      }
    : null;
  const rawDim = nbt.Dimension;
  let dimension = 'unknown';
  if (typeof rawDim === 'string') {
    dimension = rawDim.replace(/^minecraft:/, '');
  } else if (typeof rawDim === 'number') {
    dimension = rawDim === 0 ? 'overworld' : rawDim === -1 ? 'the_nether' : rawDim === 1 ? 'the_end' : String(rawDim);
  }
  const gameTypeNum = typeof nbt.playerGameType === 'number' ? nbt.playerGameType : null;

  return {
    xpLevel: typeof nbt.XpLevel === 'number' ? nbt.XpLevel : null,
    xpTotal: typeof nbt.XpTotal === 'number' ? nbt.XpTotal : null,
    xpProgress: typeof nbt.XpP === 'number' ? Number((nbt.XpP * 100).toFixed(0)) : null,
    health: typeof nbt.Health === 'number' ? Number(nbt.Health.toFixed(1)) : null,
    foodLevel: typeof nbt.foodLevel === 'number' ? nbt.foodLevel : null,
    gamemode: gameTypeNum !== null ? GAMEMODE_NAMES[gameTypeNum] || String(gameTypeNum) : null,
    dimension,
    position: pos,
    inventoryItemCount: Array.isArray(nbt.Inventory) ? nbt.Inventory.length : null,
    lastSavedAt: mtimeIso,
  };
}

function summarizePlayerStats(statsJson) {
  const custom = statsJson?.stats?.['minecraft:custom'];
  if (!custom || typeof custom !== 'object') return null;
  const playTicks = custom['minecraft:play_time'] ?? custom['minecraft:play_one_minute'] ?? 0;
  const playMinutes = Math.round(playTicks / 20 / 60);
  const minedObj = statsJson?.stats?.['minecraft:mined'] || {};
  const totalMined = Object.values(minedObj).reduce((acc, v) => acc + (Number(v) || 0), 0);
  const killedObj = statsJson?.stats?.['minecraft:killed'] || {};
  const totalMobKills = Object.values(killedObj).reduce((acc, v) => acc + (Number(v) || 0), 0);

  return {
    playTimeMinutes: playMinutes,
    deaths: Number(custom['minecraft:deaths'] || 0),
    mobKills: Number(custom['minecraft:mob_kills'] || totalMobKills || 0),
    playerKills: Number(custom['minecraft:player_kills'] || 0),
    blocksMined: totalMined,
    jumps: Number(custom['minecraft:jump'] || 0),
  };
}

export function createPlayerDataReader(dataDir) {
  function findPlayerFile(subPaths) {
    for (const rel of subPaths) {
      const full = path.join(dataDir, rel);
      if (fs.existsSync(full)) return full;
    }
    return null;
  }

  function getKnownPlayersMap() {
    const byUuid = new Map();
    const register = (uuid, name, extra = {}) => {
      if (!uuid && !name) return;
      const key = uuid ? String(uuid).toLowerCase() : `name:${String(name).toLowerCase()}`;
      const existing = byUuid.get(key) || { uuid: uuid || null, name: name || null };
      byUuid.set(key, {
        ...existing,
        uuid: existing.uuid || uuid || null,
        name: existing.name || name || null,
        ...extra,
      });
    };

    const usercache = safeReadJson(path.join(dataDir, 'usercache.json'), []);
    if (Array.isArray(usercache)) {
      for (const u of usercache) register(u.uuid, u.name);
    }

    const ops = safeReadJson(path.join(dataDir, 'ops.json'), []);
    const opUuids = new Set();
    const opNames = new Set();
    if (Array.isArray(ops)) {
      for (const o of ops) {
        if (o.uuid) opUuids.add(String(o.uuid).toLowerCase());
        if (o.name) opNames.add(String(o.name).toLowerCase());
        register(o.uuid, o.name, { isOp: true, opLevel: o.level || 4 });
      }
    }

    const whitelist = safeReadJson(path.join(dataDir, 'whitelist.json'), []);
    const wlNames = new Set();
    if (Array.isArray(whitelist)) {
      for (const w of whitelist) {
        if (w.name) wlNames.add(String(w.name).toLowerCase());
        register(w.uuid, w.name, { whitelisted: true });
      }
    }

    const banned = safeReadJson(path.join(dataDir, 'banned-players.json'), []);
    const bannedNames = new Set();
    if (Array.isArray(banned)) {
      for (const b of banned) {
        if (b.name) bannedNames.add(String(b.name).toLowerCase());
        register(b.uuid, b.name, { banned: true, banReason: b.reason || null });
      }
    }

    // Descobre arquivos .dat mesmo se ainda não estiverem no usercache
    const datDirs = [
      path.join(dataDir, 'world/players/data'),
      path.join(dataDir, 'world/playerdata'),
    ];
    for (const dir of datDirs) {
      if (!fs.existsSync(dir)) continue;
      try {
        for (const entry of fs.readdirSync(dir)) {
          if (!entry.endsWith('.dat')) continue;
          const uuid = entry.slice(0, -4).toLowerCase();
          if (!byUuid.has(uuid)) {
            register(uuid, null);
          }
        }
      } catch {
        // ignore
      }
    }

    return { byUuid, opUuids, opNames, wlNames, bannedNames };
  }

  function readPlayerProfile(uuid, nameHint = null) {
    const cleanUuid = uuid ? String(uuid).toLowerCase() : null;
    let nbtSummary = null;
    let statsSummary = null;

    if (cleanUuid) {
      const datFile = findPlayerFile([
        `world/players/data/${cleanUuid}.dat`,
        `world/playerdata/${cleanUuid}.dat`,
      ]);
      if (datFile) {
        try {
          const st = fs.statSync(datFile);
          const nbt = parseNbtBuffer(fs.readFileSync(datFile));
          nbtSummary = summarizePlayerNbt(nbt, st.mtime.toISOString());
        } catch {
          // ignore corrupted/locked .dat
        }
      }

      const statsFile = findPlayerFile([
        `world/players/stats/${cleanUuid}.json`,
        `world/stats/${cleanUuid}.json`,
      ]);
      if (statsFile) {
        statsSummary = summarizePlayerStats(safeReadJson(statsFile, null));
      }
    }

    return {
      uuid: cleanUuid,
      name: nameHint,
      nbt: nbtSummary,
      stats: statsSummary,
    };
  }

  function getAllPlayerProfiles(onlineNames = []) {
    const { byUuid, opNames, wlNames, bannedNames } = getKnownPlayersMap();
    const onlineSet = new Set(onlineNames.map((n) => String(n).toLowerCase()));
    const profiles = [];

    for (const item of byUuid.values()) {
      const prof = readPlayerProfile(item.uuid, item.name);
      const lowerName = (item.name || '').toLowerCase();
      profiles.push({
        name: item.name || item.uuid,
        uuid: item.uuid,
        online: lowerName ? onlineSet.has(lowerName) : false,
        isOp: Boolean(item.isOp || (lowerName && opNames.has(lowerName))),
        whitelisted: Boolean(item.whitelisted || (lowerName && wlNames.has(lowerName))),
        banned: Boolean(item.banned || (lowerName && bannedNames.has(lowerName))),
        ...(prof.nbt || {}),
        stats: prof.stats,
      });
    }

    // Inclui jogadores online que porventura ainda não estejam no usercache/.dat
    const knownNames = new Set(profiles.map((p) => String(p.name || '').toLowerCase()));
    for (const name of onlineNames) {
      if (!knownNames.has(String(name).toLowerCase())) {
        profiles.push({
          name,
          uuid: null,
          online: true,
          isOp: opNames.has(String(name).toLowerCase()),
          whitelisted: wlNames.has(String(name).toLowerCase()),
          banned: bannedNames.has(String(name).toLowerCase()),
          stats: null,
        });
      }
    }

    return profiles.sort((a, b) => {
      if (a.online !== b.online) return a.online ? -1 : 1;
      return String(a.name).localeCompare(String(b.name));
    });
  }

  function findPlayerProfileByName(queryName, onlineNames = []) {
    const clean = String(queryName || '').trim().toLowerCase();
    if (!clean) return null;
    const all = getAllPlayerProfiles(onlineNames);
    return (
      all.find((p) => String(p.name || '').toLowerCase() === clean) ||
      all.find((p) => String(p.name || '').toLowerCase().includes(clean)) ||
      null
    );
  }

  function getWorldOverview() {
    const levelFile = path.join(dataDir, 'world/level.dat');
    if (!fs.existsSync(levelFile)) {
      return null;
    }
    try {
      const parsed = parseNbtBuffer(fs.readFileSync(levelFile));
      const d = parsed?.Data && typeof parsed.Data === 'object' ? parsed.Data : parsed;
      if (!d || typeof d !== 'object') return null;

      const spawnPos = Array.isArray(d.spawn?.pos) && d.spawn.pos.length === 3
        ? { x: Math.round(d.spawn.pos[0]), y: Math.round(d.spawn.pos[1]), z: Math.round(d.spawn.pos[2]) }
        : typeof d.SpawnX === 'number'
        ? { x: d.SpawnX, y: d.SpawnY ?? 64, z: d.SpawnZ ?? 0 }
        : null;

      const spawnDimension =
        typeof d.spawn?.dimension === 'string'
          ? d.spawn.dimension.replace(/^minecraft:/, '')
          : 'overworld';

      const rawSeed = d.WorldGenSettings?.seed ?? d.RandomSeed ?? null;
      const timeTicks = typeof d.Time === 'number' ? d.Time : Number(d.Time) || 0;
      const dayTimeTicks = typeof d.DayTime === 'number' ? d.DayTime : Number(d.DayTime) || timeTicks;

      return {
        levelName: d.LevelName || 'world',
        version: d.Version?.Name || null,
        seed: rawSeed !== null && rawSeed !== undefined ? String(rawSeed) : null,
        spawn: spawnPos ? { ...spawnPos, dimension: spawnDimension } : null,
        difficulty: DIFFICULTY_NAMES[d.Difficulty] || (typeof d.Difficulty === 'string' ? d.Difficulty : 'Normal'),
        defaultGamemode: GAMEMODE_NAMES[d.GameType] || 'Survival',
        hardcore: Boolean(d.hardcore),
        timeTicks,
        dayCount: Math.floor(Math.max(0, dayTimeTicks) / 24000),
        raining: Boolean(d.raining),
        thundering: Boolean(d.thundering),
      };
    } catch {
      return null;
    }
  }

  return {
    getAllPlayerProfiles,
    findPlayerProfileByName,
    getWorldOverview,
  };
}
