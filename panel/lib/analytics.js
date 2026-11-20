import fs from 'node:fs';
import path from 'node:path';
import { normalizeCrossplayKey } from './crossplay-sync.js';

// ============================================================================
// YacaCode Analytics & Histórico de Relatórios (Zero Dependências)
// Mantém métricas dos últimos 30 dias em /mc-data/.yacacode-analytics.json
// ============================================================================

const ANALYTICS_FILENAME = '.yacacode-analytics.json';
const RETENTION_MS = 30 * 24 * 60 * 60 * 1000; // 30 dias
const MAX_SAMPLES = 3000; // ~31 dias a cada 15min
const MAX_SESSIONS = 2000;
const MAX_EVENTS = 1000;

function defaultStore() {
  return {
    version: 1,
    samples: [], // { ts, online, players, cpu, ram, temp }
    sessions: [], // { key, name, joinedAt, leftAt, durationMin }
    statusEvents: [], // { ts, online, reason }
    backupEvents: [], // { ts, ok, fileName, sizeBytes, error }
    updatedAt: null,
  };
}

export function createAnalyticsManager({ dataDir }) {
  const filePath = path.join(dataDir, ANALYTICS_FILENAME);
  let store = loadFromDisk();
  const activeSessions = new Map(); // canonicalKey -> { name, joinedAt }
  let dirty = false;
  let flushTimer = null;

  function loadFromDisk() {
    try {
      if (!fs.existsSync(filePath)) return defaultStore();
      const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      if (!parsed || typeof parsed !== 'object') return defaultStore();
      return {
        version: 1,
        samples: Array.isArray(parsed.samples) ? parsed.samples : [],
        sessions: Array.isArray(parsed.sessions) ? parsed.sessions : [],
        statusEvents: Array.isArray(parsed.statusEvents) ? parsed.statusEvents : [],
        backupEvents: Array.isArray(parsed.backupEvents) ? parsed.backupEvents : [],
        updatedAt: parsed.updatedAt || null,
      };
    } catch {
      return defaultStore();
    }
  }

  function pruneOldData(nowMs = Date.now()) {
    const cutoff = nowMs - RETENTION_MS;
    store.samples = store.samples.filter((s) => s.ts >= cutoff).slice(-MAX_SAMPLES);
    store.sessions = store.sessions.filter((s) => (s.leftAt || s.joinedAt) >= cutoff).slice(-MAX_SESSIONS);
    store.statusEvents = store.statusEvents.filter((e) => e.ts >= cutoff).slice(-MAX_EVENTS);
    store.backupEvents = store.backupEvents.filter((e) => e.ts >= cutoff).slice(-MAX_EVENTS);
  }

  function flushNow() {
    if (!dirty) return;
    dirty = false;
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    try {
      pruneOldData();
      store.updatedAt = new Date().toISOString();
      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const tmp = `${filePath}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(store), { mode: 0o600 });
      fs.renameSync(tmp, filePath);
    } catch {
      // silencioso
    }
  }

  function scheduleFlush() {
    dirty = true;
    if (flushTimer) return;
    flushTimer = setTimeout(() => {
      flushTimer = null;
      flushNow();
    }, 5000);
    if (typeof flushTimer.unref === 'function') flushTimer.unref();
  }

  function recordSample({ online, players = 0, cpu = null, ram = null, temp = null, ts = Date.now() }) {
    store.samples.push({
      ts,
      online: Boolean(online),
      players: Math.max(0, Number(players) || 0),
      cpu: cpu !== null && Number.isFinite(Number(cpu)) ? Math.round(Number(cpu) * 10) / 10 : null,
      ram: ram !== null && Number.isFinite(Number(ram)) ? Math.round(Number(ram) * 10) / 10 : null,
      temp: temp !== null && Number.isFinite(Number(temp)) ? Math.round(Number(temp) * 10) / 10 : null,
    });
    scheduleFlush();
  }

  function recordServerStateChange(online, reason = '', ts = Date.now()) {
    store.statusEvents.push({
      ts,
      online: Boolean(online),
      reason: String(reason || '').slice(0, 120),
    });
    scheduleFlush();
  }

  function recordPlayerEvent({ name, event, ts = Date.now() }) {
    const cleanName = String(name || '').trim();
    const key = normalizeCrossplayKey(cleanName);
    if (!key) return;

    if (event === 'join') {
      if (!activeSessions.has(key)) {
        activeSessions.set(key, { name: cleanName.replace(/^\./, '') || cleanName, joinedAt: ts });
      }
      return;
    }

    if (event === 'leave') {
      const open = activeSessions.get(key);
      activeSessions.delete(key);
      const joinedAt = open ? open.joinedAt : ts;
      const durationMin = Math.max(0, Math.round(((ts - joinedAt) / 60000) * 10) / 10);
      store.sessions.push({
        key,
        name: open?.name || cleanName.replace(/^\./, '') || cleanName,
        joinedAt,
        leftAt: ts,
        durationMin,
      });
      scheduleFlush();
    }
  }

  function recordBackupEvent({ ok, fileName = null, sizeBytes = 0, error = null, ts = Date.now() }) {
    store.backupEvents.push({
      ts,
      ok: Boolean(ok),
      fileName: fileName || null,
      sizeBytes: Number(sizeBytes) || 0,
      error: error ? String(error).slice(0, 200) : null,
    });
    scheduleFlush();
  }

  function getReport(daysInput = 7) {
    const days = Math.max(1, Math.min(30, Math.round(Number(daysInput) || 7)));
    const now = Date.now();
    const cutoff = now - days * 24 * 60 * 60 * 1000;

    const samples = store.samples.filter((s) => s.ts >= cutoff);
    const sessions = store.sessions.filter((s) => (s.leftAt || s.joinedAt) >= cutoff);
    const statusEvents = store.statusEvents.filter((e) => e.ts >= cutoff);
    const backupEvents = store.backupEvents.filter((e) => e.ts >= cutoff);

    // Inclui sessões abertas atualmente no período
    const liveSessions = [];
    for (const [key, open] of activeSessions.entries()) {
      const durationMin = Math.max(0, Math.round(((now - open.joinedAt) / 60000) * 10) / 10);
      liveSessions.push({ key, name: open.name, joinedAt: open.joinedAt, leftAt: now, durationMin });
    }
    const allSessions = [...sessions, ...liveSessions];

    const onlineSamples = samples.filter((s) => s.online);
    const uptimePercent = samples.length
      ? Math.round((onlineSamples.length / samples.length) * 1000) / 10
      : null;

    const avg = (arr) => (arr.length ? Math.round((arr.reduce((a, b) => a + b, 0) / arr.length) * 10) / 10 : null);
    const cpuVals = samples.map((s) => s.cpu).filter((v) => v !== null);
    const ramVals = samples.map((s) => s.ram).filter((v) => v !== null);
    const tempVals = samples.map((s) => s.temp).filter((v) => v !== null);

    let peakOnline = 0;
    for (const s of samples) {
      if (s.players > peakOnline) peakOnline = s.players;
    }
    if (activeSessions.size > peakOnline) peakOnline = activeSessions.size;

    const byPlayer = new Map();
    for (const s of allSessions) {
      const prev = byPlayer.get(s.key) || { name: s.name, sessions: 0, minutes: 0 };
      prev.sessions += 1;
      prev.minutes = Math.round((prev.minutes + (s.durationMin || 0)) * 10) / 10;
      byPlayer.set(s.key, prev);
    }

    const mostActivePlayers = [...byPlayer.values()]
      .sort((a, b) => b.minutes - a.minutes || b.sessions - a.sessions)
      .slice(0, 8);

    const totalPlayMinutes = Math.round(
      allSessions.reduce((acc, s) => acc + (s.durationMin || 0), 0) * 10
    ) / 10;

    const outagesCount = statusEvents.filter((e) => !e.online).length;
    const backupsOk = backupEvents.filter((b) => b.ok);
    const backupsFail = backupEvents.filter((b) => !b.ok);
    const lastBackup = backupEvents.length ? backupEvents[backupEvents.length - 1] : null;

    return {
      periodDays: days,
      from: new Date(cutoff).toISOString(),
      to: new Date(now).toISOString(),
      server: {
        samplesCount: samples.length,
        uptimePercent,
        outagesCount,
        avgCpuPercent: avg(cpuVals),
        avgRamPercent: avg(ramVals),
        avgTempC: avg(tempVals),
        maxTempC: tempVals.length ? Math.max(...tempVals) : null,
      },
      players: {
        peakOnline,
        uniquePlayersCount: byPlayer.size,
        uniquePlayers: [...byPlayer.values()].map((p) => p.name),
        totalSessions: allSessions.length,
        totalPlayMinutes,
        mostActivePlayers,
      },
      backups: {
        total: backupEvents.length,
        succeeded: backupsOk.length,
        failed: backupsFail.length,
        lastBackup: lastBackup
          ? {
              ok: lastBackup.ok,
              fileName: lastBackup.fileName,
              sizeMB: lastBackup.sizeBytes ? Math.round((lastBackup.sizeBytes / (1024 * 1024)) * 10) / 10 : null,
              at: new Date(lastBackup.ts).toISOString(),
              error: lastBackup.error,
            }
          : null,
      },
    };
  }

  function countPlayerAdvancements(uuid) {
    if (!uuid) return 0;
    const clean = String(uuid).toLowerCase();
    for (const rel of [`world/players/advancements/${clean}.json`, `world/advancements/${clean}.json`]) {
      const full = path.join(dataDir, rel);
      if (!fs.existsSync(full)) continue;
      try {
        const obj = JSON.parse(fs.readFileSync(full, 'utf8'));
        if (!obj || typeof obj !== 'object') return 0;
        let count = 0;
        for (const [key, val] of Object.entries(obj)) {
          if (key === 'DataVersion' || key.startsWith('minecraft:recipes/')) continue;
          if (val && val.done === true) count += 1;
        }
        return count;
      } catch {
        return 0;
      }
    }
    return 0;
  }

  /**
   * Consolida perfis de jogadores unificando contas Java + Bedrock (ex: Nycolazs e .Nycolazs)
   * para evitar duplicidade nos rankings de mortes, tempo jogado, mobs, blocos, conquistas e XP.
   */
  function getConsolidatedPlayerStats(playerData, onlineNames = []) {
    const rawProfiles = playerData.getAllPlayerProfiles(onlineNames);
    const grouped = new Map();

    for (const p of rawProfiles) {
      const key = normalizeCrossplayKey(p.name);
      if (!key) continue;
      const displayName = String(p.name || '').replace(/^\./, '') || p.name;
      const existing = grouped.get(key);

      const deaths = Number(p.stats?.deaths || 0);
      const playTimeMinutes = Number(p.stats?.playTimeMinutes || 0);
      const mobKills = Number(p.stats?.mobKills || 0);
      const blocksMined = Number(p.stats?.blocksMined || 0);
      const xpLevel = p.xpLevel !== undefined && p.xpLevel !== null ? Number(p.xpLevel) : 0;
      const advancements = countPlayerAdvancements(p.uuid);

      if (!existing) {
        grouped.set(key, {
          key,
          name: displayName,
          online: Boolean(p.online),
          onlineEdition: p.online ? (String(p.name).startsWith('.') ? 'Bedrock' : 'Java') : null,
          isOp: Boolean(p.isOp),
          gamemode: p.gamemode || null,
          dimension: p.dimension || null,
          health: p.health ?? null,
          foodLevel: p.foodLevel ?? null,
          xpLevel,
          deaths,
          playTimeMinutes,
          mobKills,
          blocksMined,
          advancements,
          lastSeen: p.lastSeen || null,
        });
      } else {
        // Consolida usando o maior valor (contas sincronizadas têm stats espelhados)
        existing.online = existing.online || Boolean(p.online);
        if (p.online) {
          existing.onlineEdition = String(p.name).startsWith('.') ? 'Bedrock' : 'Java';
        }
        existing.isOp = existing.isOp || Boolean(p.isOp);
        existing.deaths = Math.max(existing.deaths, deaths);
        existing.playTimeMinutes = Math.max(existing.playTimeMinutes, playTimeMinutes);
        existing.mobKills = Math.max(existing.mobKills, mobKills);
        existing.blocksMined = Math.max(existing.blocksMined, blocksMined);
        existing.xpLevel = Math.max(existing.xpLevel, xpLevel);
        existing.advancements = Math.max(existing.advancements, advancements);
        if (p.lastSeen && (!existing.lastSeen || p.lastSeen > existing.lastSeen)) {
          existing.lastSeen = p.lastSeen;
          if (p.dimension) existing.dimension = p.dimension;
          if (p.gamemode) existing.gamemode = p.gamemode;
          if (p.health !== undefined && p.health !== null) existing.health = p.health;
          if (p.foodLevel !== undefined && p.foodLevel !== null) existing.foodLevel = p.foodLevel;
        }
      }
    }

    return [...grouped.values()];
  }

  function getRankings(playerData, onlineNames = [], metric = 'all') {
    const players = getConsolidatedPlayerStats(playerData, onlineNames);
    const topBy = (field) =>
      [...players]
        .sort((a, b) => (b[field] || 0) - (a[field] || 0) || a.name.localeCompare(b.name))
        .slice(0, 10)
        .map((p, idx) => ({
          rank: idx + 1,
          name: p.name,
          value: p[field] || 0,
          online: p.online,
        }));

    const m = String(metric || 'all').toLowerCase();
    if (m === 'deaths') return { metric: 'deaths', ranking: topBy('deaths') };
    if (m === 'play_time' || m === 'playtime') return { metric: 'play_time_minutes', ranking: topBy('playTimeMinutes') };
    if (m === 'mob_kills' || m === 'mobs') return { metric: 'mob_kills', ranking: topBy('mobKills') };
    if (m === 'blocks_mined' || m === 'mined') return { metric: 'blocks_mined', ranking: topBy('blocksMined') };
    if (m === 'xp' || m === 'xp_level') return { metric: 'xp_level', ranking: topBy('xpLevel') };
    if (m === 'advancements' || m === 'conquistas') return { metric: 'advancements', ranking: topBy('advancements') };

    return {
      totalPlayersTracked: players.length,
      mostDeaths: topBy('deaths').slice(0, 5),
      mostPlayTimeMinutes: topBy('playTimeMinutes').slice(0, 5),
      mostMobKills: topBy('mobKills').slice(0, 5),
      mostBlocksMined: topBy('blocksMined').slice(0, 5),
      highestXpLevel: topBy('xpLevel').slice(0, 5),
      mostAdvancements: topBy('advancements').slice(0, 5),
    };
  }

  function stop() {
    flushNow();
  }

  return {
    recordSample,
    recordServerStateChange,
    recordPlayerEvent,
    recordBackupEvent,
    getReport,
    getConsolidatedPlayerStats,
    getRankings,
    flushNow,
    stop,
  };
}
