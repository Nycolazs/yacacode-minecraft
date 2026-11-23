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
  onPlayerEvent = null,
  saveSettleDelayMs = 600,
  // false = só rastreia entradas/saídas (eventos, analytics, backups). Com Paper + Geyser offline,
  // Java e Bedrock com o mesmo nick já são o mesmo jogador, então não há bloqueio nem cópia de perfis.
  syncEnabled = true,
  onRawLine = null,
  saveStableMs = 800,
  saveMaxWaitMs = 6000,
  firstSyncSettleMs = 2000,
  maxHistoryPerAccount = 40,
}) {
  const playersRoot = path.join(dataDir, 'world/players');
  const canonicalRoot = path.join(playersRoot, '.crossplay-canonical');

  // canonicalKey -> { name, edition, joinedAt }
  const activeSessions = new Map();
  // lowerName -> timestamp até quando ignorar o evento "left" (sessão kickada por duplicata/1st-sync)
  const suppressedLeaves = new Map();
  // lowerName -> { key, uuid, edition, done } — 1ª sincronização aguardando o kick/salvamento terminar.
  // A cópia do perfil canônico SÓ acontece depois que o servidor salvou a sessão kickada; caso contrário
  // o save do disconnect sobrescreve a cópia com o inventário vazio do jogador recém-criado.
  const pendingFirstSyncs = new Map();

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

  // Guarda a versão anterior de um arquivo antes de sobrescrevê-lo (rede de segurança contra perda de itens)
  function snapshotBeforeOverwrite(key, filePath, label) {
    try {
      if (!fs.existsSync(filePath)) return;
      const historyDir = path.join(getCanonicalPaths(key).dir, 'history');
      fs.mkdirSync(historyDir, { recursive: true });
      const ts = new Date().toISOString().replace(/[:.]/g, '-');
      const ext = path.extname(filePath) || '.dat';
      fs.copyFileSync(filePath, path.join(historyDir, `${ts}_${label}${ext}`));
      const entries = fs.readdirSync(historyDir).sort();
      for (const old of entries.slice(0, Math.max(0, entries.length - maxHistoryPerAccount))) {
        fs.rmSync(path.join(historyDir, old), { force: true });
      }
    } catch {
      // ignore
    }
  }

  function copyPlayerFilesWithHistory(key, src, dst, label) {
    if (!fs.existsSync(src.dat)) return false;
    snapshotBeforeOverwrite(key, dst.dat, label);
    atomicCopyFile(src.dat, dst.dat);
    atomicCopyFile(src.stats, dst.stats);
    atomicCopyFile(src.advancements, dst.advancements);
    return true;
  }

  function filesEqual(a, b) {
    try {
      return fs.readFileSync(a).equals(fs.readFileSync(b));
    } catch {
      return false;
    }
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
    copyPlayerFilesWithHistory(key, src, canon, 'canonical');

    const syncedUuids = new Set([sourceUuid]);
    const copiedTo = [];

    // 2. Espelha para todos os UUIDs conhecidos da outra edição
    for (const targetUuid of targetUuids) {
      const dst = getPlayerPaths(targetUuid);
      if (copyPlayerFilesWithHistory(key, src, dst, targetUuid)) {
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
    const lowerName = playerName.toLowerCase();

    if (!syncEnabled) {
      activeSessions.set(key, { name: playerName, edition, joinedAt: Date.now() });
      if (typeof onPlayerEvent === 'function') {
        Promise.resolve(onPlayerEvent({ name: playerName, edition, event: 'join' })).catch(() => {});
      }
      return { action: 'joined', player: playerName, edition };
    }

    // Reconectou antes de a cópia da 1ª sincronização terminar: o servidor já carregou o perfil vazio.
    const pendingFs = pendingFirstSyncs.get(lowerName);
    if (pendingFs && !pendingFs.done) {
      suppressedLeaves.set(lowerName, Date.now() + 15000);
      try {
        await sendMcCommand(`kick ${playerName} Ainda sincronizando seus itens... aguarde 5 segundos e entre novamente.`);
      } catch {
        // ignore
      }
      return { action: 'first_sync_still_pending', player: playerName };
    }
    if (pendingFs?.done) pendingFirstSyncs.delete(lowerName);

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
        // Kicka PRIMEIRO; a cópia do perfil canônico acontece no evento "left" (depois do save do servidor)
        suppressedLeaves.set(lowerName, Date.now() + 15000);
        pendingFirstSyncs.set(lowerName, { key, uuid: currentUuid, edition, done: false });

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
    if (typeof onPlayerEvent === 'function') {
      try {
        Promise.resolve(onPlayerEvent({ name: playerName, edition, event: 'join' })).catch(() => {});
      } catch {
        // ignore
      }
    }
    return { action: 'joined', player: playerName, edition };
  }

  async function waitForStableFile(filePath, sinceMs) {
    const deadline = Date.now() + saveMaxWaitMs;
    let last = null;
    let stableSince = 0;
    while (Date.now() < deadline) {
      let sig = null;
      try {
        const st = fs.statSync(filePath);
        sig = `${st.size}:${st.mtimeMs}`;
        // Salvo depois (ou logo antes) do "left" e sem mudanças há saveStableMs: pronto
        if (sig === last && st.mtimeMs >= sinceMs - 2000 && Date.now() - stableSince >= saveStableMs) return true;
      } catch {
        // ainda não existe
      }
      if (sig !== last) {
        last = sig;
        stableSince = Date.now();
      }
      await new Promise((r) => setTimeout(r, 200));
    }
    return false;
  }

  async function completeFirstSync(playerName, pending) {
    // Espera o servidor terminar de gravar o .dat da sessão kickada antes de copiar por cima
    const settle = Math.max(saveSettleDelayMs, firstSyncSettleMs);
    if (settle > 0) await new Promise((r) => setTimeout(r, settle));

    const canon = getCanonicalPaths(pending.key);
    const dst = getPlayerPaths(pending.uuid);
    copyPlayerFilesWithHistory(pending.key, canon, dst, `${pending.uuid}-firstsync`);

    // Confere se nenhum save atrasado sobrescreveu a cópia; se sim, copia de novo
    if (settle > 0) await new Promise((r) => setTimeout(r, settle));
    if (!filesEqual(canon.dat, dst.dat) && !activeSessions.has(pending.key)) {
      atomicCopyFile(canon.dat, dst.dat);
      atomicCopyFile(canon.stats, dst.stats);
      atomicCopyFile(canon.advancements, dst.advancements);
    }

    const meta = safeReadJson(canon.meta, null);
    if (meta && Array.isArray(meta.syncedUuids) && !meta.syncedUuids.includes(pending.uuid)) {
      meta.syncedUuids.push(pending.uuid);
      fs.writeFileSync(canon.meta, JSON.stringify(meta, null, 2), 'utf8');
    }
    pending.done = true;
    console.log(`[YacaCode Crossplay] Perfil canônico copiado para ${playerName} (${pending.uuid}) após o kick.`);
  }

  async function handleLeave(playerName) {
    const lower = playerName.toLowerCase();
    const key = normalizeCrossplayKey(playerName);

    if (!syncEnabled) {
      const existing = activeSessions.get(key);
      if (existing && existing.name.toLowerCase() === lower) activeSessions.delete(key);
      if (typeof onPlayerEvent === 'function') {
        Promise.resolve(onPlayerEvent({ name: playerName, edition: detectEdition(playerName), event: 'leave' })).catch(() => {});
      }
      return { action: 'left', player: playerName };
    }

    // Sessão kickada da 1ª sincronização: NUNCA propaga (é um perfil vazio); só agora copia o canônico.
    const pendingFs = pendingFirstSyncs.get(lower);
    if (pendingFs && !pendingFs.done) {
      suppressedLeaves.delete(lower);
      if (!pendingFs.promise) {
        pendingFs.promise = completeFirstSync(playerName, pendingFs).catch((err) => {
          pendingFs.done = true;
          console.error(`[YacaCode Crossplay] Falha na 1ª sincronização de ${playerName}: ${err.message}`);
        });
      }
      await pendingFs.promise;
      return { action: 'first_sync_completed', player: playerName, uuid: pendingFs.uuid };
    }

    const suppressUntil = suppressedLeaves.get(lower) || 0;
    if (Date.now() < suppressUntil) {
      suppressedLeaves.delete(lower);
      return { action: 'leave_suppressed', player: playerName };
    }

    const existing = activeSessions.get(key);
    // Sessão bloqueada (outra edição online) cujo "left" chegou atrasado: não sobrescreve nada
    if (existing && existing.name.toLowerCase() !== lower) {
      return { action: 'leave_other_edition_active', player: playerName, active: existing.name };
    }
    if (existing && existing.name.toLowerCase() === lower) {
      activeSessions.delete(key);
    }
    if (typeof onPlayerEvent === 'function') {
      try {
        Promise.resolve(
          onPlayerEvent({ name: playerName, edition: detectEdition(playerName), event: 'leave' })
        ).catch(() => {});
      } catch {
        // ignore
      }
    }

    // Aguarda o servidor finalizar a escrita do .dat ao desconectar: espera o tempo mínimo e depois
    // até o arquivo ficar estável (sem mudar de tamanho/mtime) por um intervalo, com limite máximo.
    const leftAtMs = Date.now();
    if (saveSettleDelayMs > 0) {
      await new Promise((r) => setTimeout(r, saveSettleDelayMs));
    }
    let sourceUuid = resolveUuidForExactName(playerName);
    if (!sourceUuid) return { action: 'leave_no_uuid', player: playerName };
    if (saveSettleDelayMs > 0) {
      await waitForStableFile(getPlayerPaths(sourceUuid).dat, leftAtMs);
      sourceUuid = resolveUuidForExactName(playerName) || sourceUuid;
    }

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
    if (typeof onRawLine === 'function') {
      try {
        onRawLine(line);
      } catch {
        // ignore
      }
    }
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
