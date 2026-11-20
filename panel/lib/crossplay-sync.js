import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { stripAnsi } from './ingame-chat.js';

// ============================================================================
// YacaCode Crossplay Sync Manager (Java <-> Bedrock)
// ============================================================================
// 1. Bloqueia login simultâneo do mesmo nick entre Java ("Nick") e Bedrock (".Nick")
//    — só permite entrar se a outra edição já desconectou.
// 2. Sincroniza automaticamente playerdata (.dat: inventário, armaduras, offhand,
//    Ender Chest, posição X/Y/Z, dimensão, vida, fome, XP, gamemode), stats e
//    advancements entre os UUIDs Java e Bedrock da mesma conta ao desconectar.
// 3. No 1º login de uma edição cujo UUID ainda não era conhecido, copia o perfil
//    canônico salvo da outra edição e solicita 1 reconexão rápida para carregar.
// ============================================================================

const JOIN_RE = /INFO\s+([A-Za-z0-9_.-]{2,32})\s+joined the game\b/i;
const LEAVE_RE = /INFO\s+([A-Za-z0-9_.-]{2,32})\s+left the game\b/i;
const VANILLA_JOIN_RE = /INFO\]:\s+([A-Za-z0-9_.-]{2,32})\s+joined the game\b/i;
const VANILLA_LEAVE_RE = /INFO\]:\s+([A-Za-z0-9_.-]{2,32})\s+left the game\b/i;

export function normalizeCrossplayKey(playerName) {
  return String(playerName || '')
    .trim()
    .replace(/^\.+/, '')
    .toLowerCase();
}

export function detectEdition(playerName) {
  return String(playerName || '').trim().startsWith('.') ? 'bedrock' : 'java';
}

export function computeOfflineJavaUuid(playerName) {
  const clean = String(playerName || '').trim().replace(/^\.+/, '');
  const md5 = crypto.createHash('md5').update(`OfflinePlayer:${clean}`).digest();
  md5[6] = (md5[6] & 0x0f) | 0x30; // UUID v3
  md5[8] = (md5[8] & 0x3f) | 0x80; // RFC 4122 variant
  const h = md5.toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export function parseJoinLeaveLine(rawLine) {
  const line = stripAnsi(rawLine).trim();
  if (!line || line.includes('<chat>')) return null;

  let m = line.match(JOIN_RE) || line.match(VANILLA_JOIN_RE);
  if (m) return { type: 'join', player: m[1].trim() };

  m = line.match(LEAVE_RE) || line.match(VANILLA_LEAVE_RE);
  if (m) return { type: 'leave', player: m[1].trim() };

  return null;
}

function safeReadJson(filePath, fallback = []) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function atomicCopyFile(src, dst) {
  if (!fs.existsSync(src)) return false;
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  const tmp = `${dst}.sync.tmp`;
  fs.copyFileSync(src, tmp);
  fs.renameSync(tmp, dst);
  return true;
}

export function createCrossplaySyncManager({
  dataDir,
  docker,
  containerName,
  sendMcCommand,
  fetchOnlinePlayers = null,
  saveSettleDelayMs = 600,
}) {
  const playersRoot = path.join(dataDir, 'world/players');
  const canonicalRoot = path.join(playersRoot, '.crossplay-canonical');

  // canonicalKey -> { name, edition, joinedAt }
  const activeSessions = new Map();
  // lowerName -> timestamp até quando ignorar o evento "left" (sessão kickada por duplicata/1st-sync)
  const suppressedLeaves = new Map();

  let stopStreamFn = null;
  let reconnectTimer = null;
  let stopped = false;
  let startedAtMs = Date.now();
  let stats = {
    connected: false,
    blockedDuplicates: 0,
    syncedTransfers: 0,
    lastEvent: null,
  };

  function getPlayerPaths(uuid) {
    const u = String(uuid).toLowerCase();
    return {
      dat: path.join(playersRoot, 'data', `${u}.dat`),
      stats: path.join(playersRoot, 'stats', `${u}.json`),
      advancements: path.join(playersRoot, 'advancements', `${u}.json`),
    };
  }

  function getCanonicalPaths(key) {
    const dir = path.join(canonicalRoot, key.replace(/[^a-z0-9_-]/g, '_'));
    return {
      dir,
      dat: path.join(dir, 'player.dat'),
      stats: path.join(dir, 'stats.json'),
      advancements: path.join(dir, 'advancements.json'),
      meta: path.join(dir, 'meta.json'),
    };
  }

  function readAllUsercacheEntries() {
    const list = [
      ...safeReadJson(path.join(dataDir, 'data/usercache.json'), []),
      ...safeReadJson(path.join(dataDir, 'usercache.json'), []),
    ];
    return Array.isArray(list) ? list : [];
  }

  // Encontra o UUID mais provável (e mais recentemente salvo) de um nick exato (ex: "Nycolazs" ou ".Nycolazs")
  function resolveUuidForExactName(exactName) {
    const lower = String(exactName || '').trim().toLowerCase();
    const candidates = new Set();

    for (const entry of readAllUsercacheEntries()) {
      if (entry?.uuid && String(entry.name || '').trim().toLowerCase() === lower) {
        candidates.add(String(entry.uuid).toLowerCase());
      }
    }

    // Para Java (sem ponto), também inclui o UUID offline padrão Velocity
    if (!lower.startsWith('.')) {
      candidates.add(computeOfflineJavaUuid(exactName));
    }

    let bestUuid = null;
    let bestMtime = -1;
    for (const uuid of candidates) {
      const p = getPlayerPaths(uuid);
      if (fs.existsSync(p.dat)) {
        try {
          const mtime = fs.statSync(p.dat).mtimeMs;
          if (mtime > bestMtime) {
            bestMtime = mtime;
            bestUuid = uuid;
          }
        } catch {
          // ignore
        }
      } else if (!bestUuid) {
        bestUuid = uuid;
      }
    }
    return bestUuid;
  }

  // Encontra TODOS os UUIDs da outra edição para a mesma conta (ex: se saiu Java "Nycolazs", retorna UUIDs de ".Nycolazs")
  function resolveCounterpartUuids(exactName, sourceUuid) {
    const key = normalizeCrossplayKey(exactName);
    const sourceEdition = detectEdition(exactName);
    const targets = new Set();

    for (const entry of readAllUsercacheEntries()) {
      if (!entry?.uuid || !entry?.name) continue;
      const eKey = normalizeCrossplayKey(entry.name);
      const eEd = detectEdition(entry.name);
      const eUuid = String(entry.uuid).toLowerCase();
      if (eKey === key && eEd !== sourceEdition && eUuid !== sourceUuid) {
        targets.add(eUuid);
      }
    }

    // Se quem saiu foi Bedrock (".Nycolazs"), sempre garante espelhar para o UUID offline Java padrão ("Nycolazs")
    if (sourceEdition === 'bedrock') {
      const javaBaseName = exactName.replace(/^\.+/, '');
      const javaOffUuid = computeOfflineJavaUuid(javaBaseName);
      if (javaOffUuid !== sourceUuid) {
        targets.add(javaOffUuid);
      }
    }

    return Array.from(targets);
  }

  function syncFilesBetweenUuids(sourceUuid, targetUuids, sourceName) {
    const key = normalizeCrossplayKey(sourceName);
    const src = getPlayerPaths(sourceUuid);
    if (!fs.existsSync(src.dat)) return { synced: false, targets: [] };

    // 1. Atualiza cópia canônica da conta
    const canon = getCanonicalPaths(key);
    fs.mkdirSync(canon.dir, { recursive: true });
    atomicCopyFile(src.dat, canon.dat);
    atomicCopyFile(src.stats, canon.stats);
    atomicCopyFile(src.advancements, canon.advancements);

    const syncedUuids = new Set([sourceUuid]);
    const copiedTo = [];

    // 2. Espelha para todos os UUIDs conhecidos da outra edição
    for (const targetUuid of targetUuids) {
      const dst = getPlayerPaths(targetUuid);
      if (atomicCopyFile(src.dat, dst.dat)) {
        atomicCopyFile(src.stats, dst.stats);
        atomicCopyFile(src.advancements, dst.advancements);
        syncedUuids.add(targetUuid);
        copiedTo.push(targetUuid);
      }
    }

    const meta = {
      key,
      lastSourceName: sourceName,
      lastSourceEdition: detectEdition(sourceName),
      lastSourceUuid: sourceUuid,
      syncedUuids: Array.from(syncedUuids),
      syncedAt: new Date().toISOString(),
    };
    fs.writeFileSync(canon.meta, JSON.stringify(meta, null, 2), 'utf8');

    return { synced: true, targets: copiedTo };
  }

  async function handleJoin(playerName) {
    const key = normalizeCrossplayKey(playerName);
    const edition = detectEdition(playerName);
    const existing = activeSessions.get(key);

    // REGRA 1: Bloquear login simultâneo entre Java e Bedrock para a mesma conta/nick
    if (existing && existing.name.toLowerCase() !== playerName.toLowerCase()) {
      suppressedLeaves.set(playerName.toLowerCase(), Date.now() + 15000);
      stats.blockedDuplicates += 1;
      stats.lastEvent = `Bloqueado login simultâneo de ${playerName} (${edition}) — ${existing.name} (${existing.edition}) já está online.`;
      const otherLabel = existing.edition === 'java' ? 'Java' : 'Bedrock';
      try {
        await sendMcCommand(
          `kick ${playerName} Esta conta ja esta jogando no ${otherLabel} (${existing.name}). Desconecte la primeiro!`
        );
      } catch {
        // ignore
      }
      console.log(`[YacaCode Crossplay] ${stats.lastEvent}`);
      return { action: 'blocked_duplicate', active: existing.name, blocked: playerName };
    }

    // Verifica se existe um perfil canônico da outra edição que ainda NÃO foi copiado para o UUID desta edição (1ª vez na outra plataforma)
    const canon = getCanonicalPaths(key);
    if (fs.existsSync(canon.meta) && fs.existsSync(canon.dat)) {
      const meta = safeReadJson(canon.meta, null);
      const currentUuid = resolveUuidForExactName(playerName);
      if (
        meta &&
        currentUuid &&
        meta.lastSourceEdition !== edition &&
        Array.isArray(meta.syncedUuids) &&
        !meta.syncedUuids.includes(currentUuid)
      ) {
        // Copia perfil canônico para o UUID recém-descoberto e solicita 1 reconexão rápida
        suppressedLeaves.set(playerName.toLowerCase(), Date.now() + 15000);
        const dst = getPlayerPaths(currentUuid);
        atomicCopyFile(canon.dat, dst.dat);
        atomicCopyFile(canon.stats, dst.stats);
        atomicCopyFile(canon.advancements, dst.advancements);
        meta.syncedUuids.push(currentUuid);
        fs.writeFileSync(canon.meta, JSON.stringify(meta, null, 2), 'utf8');

        stats.syncedTransfers += 1;
        stats.lastEvent = `Primeira sincronização de ${playerName} (${edition}) a partir de ${meta.lastSourceName}.`;
        try {
          await sendMcCommand(
            `kick ${playerName} Conta sincronizada com seus itens e posicao! Entre novamente agora para carregar.`
          );
        } catch {
          // ignore
        }
        console.log(`[YacaCode Crossplay] ${stats.lastEvent}`);
        return { action: 'first_sync_relog', player: playerName, uuid: currentUuid };
      }
    }

    activeSessions.set(key, {
      name: playerName,
      edition,
      joinedAt: Date.now(),
    });
    return { action: 'joined', player: playerName, edition };
  }

  async function handleLeave(playerName) {
    const lower = playerName.toLowerCase();
    const suppressUntil = suppressedLeaves.get(lower) || 0;
    if (Date.now() < suppressUntil) {
      suppressedLeaves.delete(lower);
      return { action: 'leave_suppressed', player: playerName };
    }

    const key = normalizeCrossplayKey(playerName);
    const existing = activeSessions.get(key);
    if (existing && existing.name.toLowerCase() === lower) {
      activeSessions.delete(key);
    }

    // Aguarda o servidor finalizar a escrita do arquivo .dat ao desconectar
    if (saveSettleDelayMs > 0) {
      await new Promise((r) => setTimeout(r, saveSettleDelayMs));
    }

    const sourceUuid = resolveUuidForExactName(playerName);
    if (!sourceUuid) return { action: 'leave_no_uuid', player: playerName };

    const counterparts = resolveCounterpartUuids(playerName, sourceUuid);
    const res = syncFilesBetweenUuids(sourceUuid, counterparts, playerName);
    if (res.synced) {
      stats.syncedTransfers += 1;
      stats.lastEvent = `Perfil de ${playerName} (${detectEdition(playerName)}) sincronizado para ${res.targets.length} UUID(s) da outra edição.`;
      console.log(`[YacaCode Crossplay] ${stats.lastEvent}`);
    }
    return { action: 'synced_on_leave', player: playerName, sourceUuid, targets: res.targets };
  }

  async function handleLine(line) {
    if (Date.now() - startedAtMs < 1500) return null;
    const evt = parseJoinLeaveLine(line);
    if (!evt) return null;
    if (evt.type === 'join') return handleJoin(evt.player);
    if (evt.type === 'leave') return handleLeave(evt.player);
    return null;
  }

  async function seedActivePlayers() {
    if (typeof fetchOnlinePlayers !== 'function') return;
    try {
      const online = await fetchOnlinePlayers();
      if (Array.isArray(online)) {
        for (const p of online) {
          const name = typeof p === 'string' ? p : p?.name;
          if (!name) continue;
          const key = normalizeCrossplayKey(name);
          if (!activeSessions.has(key)) {
            activeSessions.set(key, {
              name,
              edition: detectEdition(name),
              joinedAt: Date.now(),
            });
          }
        }
      }
    } catch {
      // ignore
    }
  }

  function scheduleReconnect() {
    if (stopped || reconnectTimer) return;
    stats.connected = false;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, 5000);
    reconnectTimer.unref();
  }

  async function connect() {
    if (stopped || !docker?.isAvailable?.()) return;
    if (stopStreamFn) {
      try {
        stopStreamFn();
      } catch {
        // ignore
      }
      stopStreamFn = null;
    }

    startedAtMs = Date.now();
    try {
      const info = await docker.inspectContainer(containerName);
      if (!info.running) {
        scheduleReconnect();
        return;
      }
      await seedActivePlayers();
      stats.connected = true;
      stopStreamFn = await docker.streamContainerLogs(containerName, {
        tail: 1,
        onLine: (line) => {
          handleLine(line).catch((err) => {
            console.error(`[YacaCode Crossplay] Erro ao processar evento: ${err.message}`);
          });
        },
        onEnd: () => {
          stats.connected = false;
          scheduleReconnect();
        },
        onError: () => {
          stats.connected = false;
          scheduleReconnect();
        },
      });
    } catch {
      scheduleReconnect();
    }
  }

  function start() {
    stopped = false;
    connect();
  }

  function stop() {
    stopped = true;
    stats.connected = false;
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    if (stopStreamFn) {
      try {
        stopStreamFn();
      } catch {
        // ignore
      }
      stopStreamFn = null;
    }
  }

  function getStats() {
    return {
      ...stats,
      activeSessions: Array.from(activeSessions.values()),
    };
  }

  return {
    start,
    stop,
    getStats,
    // Expostos para testes unitários
    _handleJoinForTest: handleJoin,
    _handleLeaveForTest: handleLeave,
  };
}
