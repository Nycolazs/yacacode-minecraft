import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createAuthManager, hasRole } from './lib/auth.js';
import { createDockerClient } from './lib/docker.js';
import { createRconClient, stripMinecraftColors } from './lib/rcon.js';
import { pingMinecraftServer } from './lib/mcping.js';
import { createSystemMonitor } from './lib/system.js';
import { createFileManager } from './lib/files.js';
import { createPlayerDataReader } from './lib/playerdata.js';
import { createAiAssistant } from './lib/ai.js';
import { createAiHistoryStore } from './lib/ai-history.js';
import { createGoogleDriveBackupManager } from './lib/gdrive.js';
import { createInGameChatBridge } from './lib/ingame-chat.js';
import { configurePersona, DEFAULT_BOT_NAME } from './lib/persona.js';
import { createJvmArgsStore, JVM_ARGS_FILENAME } from './lib/jvm-args.js';
import { createMaintenanceManager } from './lib/maintenance.js';
import { createCrossplaySyncManager } from './lib/crossplay-sync.js';
import { createAnalyticsManager } from './lib/analytics.js';
import { createWhatsAppManager } from './lib/whatsapp.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PUBLIC_DIR = path.join(__dirname, 'public');

const CONFIG = {
  port: Number(process.env.PORT) || 8080,
  serverName: process.env.SERVER_NAME || 'YacaCode',
  mcVersion: process.env.MC_VERSION || '26.3',
  mcDomain: process.env.MC_DOMAIN || 'mc.yacacode.com',
  panelDomain: process.env.PANEL_DOMAIN || 'painel.yacacode.com',
  mcJavaPort: Number(process.env.MC_JAVA_PORT) || 25565,
  mcBedrockPort: Number(process.env.MC_BEDROCK_PORT) || 19132,
  mcContainerName: process.env.MC_CONTAINER_NAME || 'yacacode-mc',
  backupContainerName: process.env.BACKUP_CONTAINER_NAME || 'yacacode-backup',
  cloudflaredContainerName: process.env.CLOUDFLARED_CONTAINER_NAME || 'yacacode-cloudflared',
  ddnsContainerName: process.env.DDNS_CONTAINER_NAME || 'yacacode-ddns',
  rconHost: process.env.RCON_HOST || 'minecraft',
  rconPort: Number(process.env.RCON_PORT) || 25575,
  rconPassword: process.env.RCON_PASSWORD || '',
  dataDir: process.env.MC_DATA_DIR || path.resolve(__dirname, '../minecraft/data'),
  backupsDir: process.env.MC_BACKUPS_DIR || path.resolve(__dirname, '../backups'),
  presetsFile:
    process.env.MC_PRESETS_FILE || path.resolve(__dirname, '../minecraft/config/presets.json'),
  adminUser: process.env.ADMIN_USER || 'admin',
  adminPasswordHash: process.env.ADMIN_PASSWORD_HASH || '',
  adminPassword: process.env.ADMIN_PASSWORD || '',
  sessionSecret: process.env.SESSION_SECRET || '',
  cfAccessEnabled: process.env.CF_ACCESS_ENABLED || 'false',
  geminiApiKey: process.env.GEMINI_API_KEY || '',
  geminiModel: process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite',
  gdriveClientId: process.env.GDRIVE_CLIENT_ID || '',
  gdriveClientSecret: process.env.GDRIVE_CLIENT_SECRET || '',
  whatsappServiceUrl: process.env.WHATSAPP_SERVICE_URL || 'http://whatsapp:3001',
  whatsappInternalToken: process.env.WHATSAPP_INTERNAL_TOKEN || process.env.SESSION_SECRET || '',
};

const auth = createAuthManager({
  ...CONFIG,
  usersFile: path.join(CONFIG.dataDir, '.yacacode-panel-users.json'),
});
const docker = createDockerClient();
const rcon = createRconClient({
  host: CONFIG.rconHost,
  port: CONFIG.rconPort,
  password: CONFIG.rconPassword,
});
const system = createSystemMonitor({
  dataDir: CONFIG.dataDir,
  backupsDir: CONFIG.backupsDir,
  mcDomain: CONFIG.mcDomain,
});
const files = createFileManager({
  dataDir: CONFIG.dataDir,
  backupsDir: CONFIG.backupsDir,
  presetsFile: CONFIG.presetsFile,
});
const playerData = createPlayerDataReader(CONFIG.dataDir);
const analytics = createAnalyticsManager({ dataDir: CONFIG.dataDir });
let whatsapp = null;

const gdrive = createGoogleDriveBackupManager({
  configFile: path.join(CONFIG.dataDir, '.yacacode-gdrive-config.json'),
  sessionSecret: CONFIG.sessionSecret,
  panelDomain: CONFIG.panelDomain,
  envClientId: CONFIG.gdriveClientId,
  envClientSecret: CONFIG.gdriveClientSecret,
  createLocalBackup: ({ onProgress, prefix } = {}) =>
    files.createWorldBackupArchive({ destDir: os.tmpdir(), maxLocalBackups: 0, onProgress, ...(prefix ? { prefix } : {}) }),
  getOnlinePlayerCount: () => crossplaySync.getStats().activeSessions.length,
  // Força o servidor a gravar os chunks antes de compactar o mundo
  beforeBackup: async () => {
    await sendMcCommand('save-all flush').catch(() => {});
    await new Promise((r) => setTimeout(r, 8000));
  },
  getBackupFilePath: (name) => files.getBackupFilePath(name),
  getWorldLastModifiedMs: () => files.getWorldLastModifiedMs(),
  onBackupFinished: (evt) => {
    analytics.recordBackupEvent(evt);
    // Backups pós-logout só notificam no WhatsApp quando falham
    if (whatsapp && !(evt.live && evt.ok)) {
      whatsapp.notifyBackupResult(evt).catch(() => {});
    }
  },
});
gdrive.startScheduler();

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.txt': 'text/plain; charset=utf-8',
};

function setSecurityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: https://mc-heads.net; connect-src 'self'; frame-ancestors 'none'; base-uri 'self';"
  );
}

function sendJson(res, status, data, extraHeaders = {}) {
  setSecurityHeaders(res);
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body),
    ...extraHeaders,
  });
  res.end(body);
}

function readJsonBody(req, maxBytes = 3 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on('data', (chunk) => {
      total += chunk.length;
      if (total > maxBytes) {
        reject(Object.assign(new Error('Corpo da requisição excede o limite permitido.'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (chunks.length === 0) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(Object.assign(new Error('JSON inválido.'), { status: 400 }));
      }
    });
    req.on('error', reject);
  });
}

function readRawBody(req, maxBytes = 100 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on('data', (chunk) => {
      total += chunk.length;
      if (total > maxBytes) {
        reject(Object.assign(new Error('Arquivo excede o limite de 100 MB.'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function sanitizePlayerName(name) {
  const clean = String(name || '').trim();
  // Permite letras, números, underscore, ponto inicial (Floodgate Bedrock) e hífen
  if (!/^\.?[a-zA-Z0-9_-]{2,32}$/.test(clean)) {
    throw Object.assign(new Error('Nome de jogador inválido.'), { status: 400 });
  }
  return clean;
}

function sanitizeSingleLine(text, maxLen = 160) {
  return String(text || '')
    .replace(/[\r\n\0]/g, ' ')
    .trim()
    .slice(0, maxLen);
}

async function sendMcCommand(command) {
  const clean = sanitizeSingleLine(command, 512).replace(/^\/+/, '');
  if (!clean) {
    throw Object.assign(new Error('Digite um comando válido.'), { status: 400 });
  }
  if (docker.isAvailable()) {
    try {
      const beforeLogs = await docker.getContainerLogsTail(CONFIG.mcContainerName, 8).catch(() => []);
      const res = await docker.execInContainer(CONFIG.mcContainerName, ['rcon-cli', clean]);
      const directOut = stripMinecraftColors(res.output || '').trim();
      if (directOut) return directOut;

      // Fallback para containers Pumpkin ainda sem /tmp/pumpkin.out: captura linhas novas de docker logs
      const afterLogs = await docker.getContainerLogsTail(CONFIG.mcContainerName, 20).catch(() => []);
      if (afterLogs.length > 0) {
        const lastBefore = beforeLogs[beforeLogs.length - 1];
        const idx = lastBefore ? afterLogs.lastIndexOf(lastBefore) : -1;
        const diff = idx >= 0 ? afterLogs.slice(idx + 1) : afterLogs.slice(-3);
        const diffText = stripMinecraftColors(diff.join('\n')).trim();
        if (diffText) return diffText;
      }
      return '';
    } catch {
      // Fallback para RCON TCP
    }
  }
  const raw = await rcon.send(clean);
  return stripMinecraftColors(raw).trim();
}

let cachedTps = { ts: 0, value: null };
// Linhas que só poluem o console (cada comando RCON abre/fecha uma thread no Paper)
const CONSOLE_NOISE_RE = /Thread RCON Client .* (started|shutting down)|RCON Listener|\[Rcon: (Unmarked|Marked|Spread)/;
function isConsoleNoise(line) {
  return CONSOLE_NOISE_RE.test(String(line || ''));
}

const jvmArgs = createJvmArgsStore(CONFIG.dataDir);
try {
  jvmArgs.ensureFile();
} catch (err) {
  console.error(`[YacaCode Panel] Não foi possível criar ${JVM_ARGS_FILENAME}: ${err.message}`);
}

// Métricas para a lateral do console (cache curto para não abrir RCON a cada requisição)
let consoleMetricsCache = { ts: 0, value: null };
async function getConsoleMetrics() {
  if (consoleMetricsCache.value && Date.now() - consoleMetricsCache.ts < 4000) return consoleMetricsCache.value;
  const inspect = await docker.inspectContainer(CONFIG.mcContainerName).catch(() => ({ running: false }));
  const value = { running: Boolean(inspect.running), updatedAt: new Date().toISOString() };
  if (inspect.running) {
    const [stats, tpsRaw, msptRaw, listRaw] = await Promise.all([
      docker.getContainerStats(CONFIG.mcContainerName).catch(() => null),
      sendMcCommand('tps').catch(() => ''),
      sendMcCommand('mspt').catch(() => ''),
      sendMcCommand('list').catch(() => ''),
    ]);
    const plain = (s) => stripMinecraftColors(String(s || '')).replace(/\x1b\[[0-9;]*m/g, '');
    const tps = plain(tpsRaw).match(/(\d+(?:\.\d+)?)\*?,\s*(\d+(?:\.\d+)?)\*?,\s*(\d+(?:\.\d+)?)/);
    const mspt = [...plain(msptRaw).matchAll(/(\d+(?:\.\d+)?)\/(\d+(?:\.\d+)?)\/(\d+(?:\.\d+)?)/g)];
    const list = plain(listRaw).match(/There are (\d+) of a max of (\d+) players online:?\s*(.*)/);
    value.tps = tps ? { m1: Number(tps[1]), m5: Number(tps[2]), m15: Number(tps[3]) } : null;
    // mspt: [5s, 10s, 1m] -> usa a janela de 10s (média e pior)
    value.mspt = mspt[1] ? { avg: Number(mspt[1][1]), max: Number(mspt[1][3]) } : null;
    value.players = list
      ? { online: Number(list[1]), max: Number(list[2]), names: list[3] ? list[3].split(/,\s*/).filter(Boolean) : [] }
      : null;
    value.cpuPercent = stats?.cpuPercent ?? null;
    value.cpuCoresUsed = stats?.cpuCoresUsed ?? null;
    value.memUsedBytes = stats?.memUsedBytes ?? null;
    value.memLimitBytes = stats?.memLimitBytes ?? null;
    value.startedAt = inspect.startedAt || inspect.state?.StartedAt || null;
  }
  try {
    value.tempC = system.getSnapshot()?.temperature?.celsius ?? null;
  } catch {
    value.tempC = null;
  }
  consoleMetricsCache = { ts: Date.now(), value };
  return value;
}

async function fetchTpsViaRcon(playersOnline = 0) {
  const now = Date.now();
  // Se não há jogadores online, evita abrir conexões RCON
  if (playersOnline === 0) {
    return { tps1m: 20.0, tps5m: 20.0, tps15m: 20.0, raw: '20.0 (server vazio)' };
  }
  if (cachedTps.value && now - cachedTps.ts < 45000) {
    return cachedTps.value;
  }
  try {
    const raw = await sendMcCommand('tps');
    const match = raw.match(/(\d+(?:\.\d+)?)\*?,\s*(\d+(?:\.\d+)?)\*?,\s*(\d+(?:\.\d+)?)\*?/);
    if (match) {
      cachedTps = {
        ts: now,
        value: {
          tps1m: Number(match[1]),
          tps5m: Number(match[2]),
          tps15m: Number(match[3]),
          raw: raw.trim(),
        },
      };
      return cachedTps.value;
    }
  } catch {
    // ignore
  }
  return cachedTps.value || { tps1m: 20.0, tps5m: 20.0, tps15m: 20.0, raw: '20.0 (Rust Native)' };
}

async function fetchOnlinePlayersViaRcon() {
  try {
    const raw = await sendMcCommand('list');
    const m = raw.match(/There are (\d+) of a max(?:imum)? of (\d+) players online:?(.*)/i);
    if (!m) return null;
    const online = Number(m[1]);
    const max = Number(m[2]);
    const names = m[3]
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((name) => ({
        name,
        edition: name.startsWith('.') ? 'bedrock' : 'java',
      }));
    return { online, max, players: names };
  } catch {
    return null;
  }
}

async function collectStackStatus() {
  const names = [
    {
      key: 'minecraft',
      container: CONFIG.mcContainerName,
      label: IS_PUMPKIN_ENGINE ? 'Minecraft Pumpkin (Rust)' : 'Minecraft Paper 26.3 + Geyser',
    },
    { key: 'panel', container: 'yacacode-panel', label: 'Painel Admin YacaCode' },
    { key: 'cloudflared', container: CONFIG.cloudflaredContainerName, label: 'Cloudflare Tunnel' },
    { key: 'ddns', container: CONFIG.ddnsContainerName, label: 'Cloudflare DDNS' },
  ];

  const results = await Promise.all(
    names.map(async (item) => {
      const info = await docker.inspectContainer(item.container);
      return {
        key: item.key,
        label: item.label,
        container: item.container,
        exists: info.exists,
        running: info.running,
        state: info.state,
        health: info.health,
        startedAt: info.startedAt,
        restartCount: info.restartCount || 0,
      };
    })
  );
  return results;
}

async function queryLiveXpLevel(playerName) {
  try {
    const clean = sanitizePlayerName(playerName);
    const out = await sendMcCommand(`experience query ${clean} levels`);
    const m = out.match(/has\s+(\d+)\s+experience\s+level/i) || out.match(/(\d+)\s+level/i);
    if (m) return Number(m[1]);
  } catch {
    // fallback para NBT
  }
  return null;
}

const aiHistory = createAiHistoryStore({
  historyFile: path.join(CONFIG.dataDir, '.yacacode-ai-chats.json'),
});

configurePersona({
  memoryFile: path.join(CONFIG.dataDir, '.yacacode-ai-shared-memory.json'),
  getBotName: () => whatsapp?.getBotName?.() || DEFAULT_BOT_NAME,
});

const ai = createAiAssistant({
  configFile: path.join(CONFIG.dataDir, '.yacacode-ai-config.json'),
  envApiKey: CONFIG.geminiApiKey,
  envModel: CONFIG.geminiModel,
  serverName: CONFIG.serverName,
  mcDomain: CONFIG.mcDomain,
  mcVersion: CONFIG.mcVersion,
  handlers: {
    async getServerStatus() {
      const [mcInspect, mcPing] = await Promise.all([
        docker.inspectContainer(CONFIG.mcContainerName),
        pingMinecraftServer(CONFIG.rconHost, 25565, 2500),
      ]);
      const [mcStats, rconList] = await Promise.all([
        mcInspect.running ? docker.getContainerStats(CONFIG.mcContainerName) : Promise.resolve(null),
        mcInspect.running ? fetchOnlinePlayersViaRcon() : Promise.resolve(null),
      ]);
      const host = system.getSnapshot();
      const onlineList = rconList?.players || mcPing.players?.sample || [];
      return {
        serverName: CONFIG.serverName,
        mcDomain: CONFIG.mcDomain,
        javaPort: CONFIG.mcJavaPort,
        bedrockPort: CONFIG.mcBedrockPort,
        running: Boolean(mcInspect.running),
        health: mcInspect.health || mcInspect.state,
        startedAt: mcInspect.startedAt,
        version: mcPing.version || CONFIG.mcVersion,
        pingOnline: Boolean(mcPing.online),
        latencyMs: mcPing.latencyMs ?? null,
        playersOnlineCount: rconList?.online ?? mcPing.players?.online ?? onlineList.length,
        playersMax: rconList?.max ?? mcPing.players?.max ?? 6,
        playersOnline: onlineList.map((p) => p.name),
        containerRamMB: mcStats ? Math.round(mcStats.memUsedBytes / (1024 * 1024)) : null,
        containerCpuPercent: mcStats ? mcStats.cpuPercent : null,
        hostTempC: host.temperatureC,
        hostRamUsedPercent: host.memory.usedPercent,
        hostLoad1m: host.loadAvg?.[0] ?? null,
        diskUsedPercent: host.disk?.usedPercent ?? null,
      };
    },

    async listPlayers() {
      const [rconList, mcPing] = await Promise.all([
        fetchOnlinePlayersViaRcon(),
        pingMinecraftServer(CONFIG.rconHost, 25565, 2500),
      ]);
      const onlineObjs = rconList?.players || mcPing.players?.sample || [];
      const onlineNames = onlineObjs.map((p) => p.name);
      const profiles = playerData.getAllPlayerProfiles(onlineNames);

      // Para jogadores online (até 6), consulta o nível de XP ao vivo no console
      for (const prof of profiles) {
        if (prof.online && onlineNames.length <= 6) {
          const liveLevel = await queryLiveXpLevel(prof.name);
          if (liveLevel !== null) {
            prof.xpLevel = liveLevel;
            prof.xpLevelSource = 'live_console';
          }
        }
      }

      return {
        onlineCount: rconList?.online ?? mcPing.players?.online ?? onlineNames.length,
        maxPlayers: rconList?.max ?? mcPing.players?.max ?? 6,
        onlinePlayers: profiles.filter((p) => p.online),
        knownPlayers: profiles,
        ops: files.readJsonList('ops.json').map((o) => o.name).filter(Boolean),
        whitelist: files.readJsonList('whitelist.json').map((w) => w.name).filter(Boolean),
        bannedPlayers: files.readJsonList('banned-players.json').map((b) => b.name).filter(Boolean),
      };
    },

    async getPlayerDetails(playerName) {
      const [rconList, mcPing] = await Promise.all([
        fetchOnlinePlayersViaRcon(),
        pingMinecraftServer(CONFIG.rconHost, 25565, 2500),
      ]);
      const onlineObjs = rconList?.players || mcPing.players?.sample || [];
      const onlineNames = onlineObjs.map((p) => p.name);
      const profile = playerData.findPlayerProfileByName(playerName, onlineNames);
      const targetName = profile?.name || playerName;
      const isOnline = onlineNames.some((n) => n.toLowerCase() === targetName.toLowerCase());

      let liveXpLevel = null;
      if (isOnline) {
        liveXpLevel = await queryLiveXpLevel(targetName);
      }

      if (!profile && !isOnline) {
        return {
          found: false,
          playerName,
          message: `Nenhum jogador chamado "${playerName}" encontrado entre os jogadores online ou no histórico do mundo.`,
        };
      }

      return {
        found: true,
        ...(profile || { name: targetName }),
        online: isOnline,
        xpLevel: liveXpLevel !== null ? liveXpLevel : (profile?.xpLevel ?? null),
        xpLevelSource: liveXpLevel !== null ? 'live_console' : 'saved_nbt',
      };
    },

    async getRecentLogs(lines = 40) {
      let entries = [];
      try {
        entries = await docker.getContainerLogsTail(CONFIG.mcContainerName, lines);
      } catch {
        // fallback arquivo latest.log
      }
      if (entries.length === 0) {
        const logFile = path.join(CONFIG.dataDir, 'logs/latest.log');
        if (fs.existsSync(logFile)) {
          entries = fs
            .readFileSync(logFile, 'utf8')
            .split(/\r?\n/)
            .filter(Boolean)
            .slice(-lines);
        }
      }
      return { count: entries.length, lines: entries };
    },

    async listBackups() {
      const local = files.listBackups();
      const gdStatus = gdrive.getPublicStatus('viewer');
      return {
        ...local,
        googleDrive: {
          connected: gdStatus.connected,
          enabled: gdStatus.enabled,
          accountEmail: gdStatus.accountEmail,
          folderName: gdStatus.folderName,
          lastBackupAt: gdStatus.lastBackupAt,
          lastUploadFile: gdStatus.lastUploadFile,
          lastUploadStatus: gdStatus.lastUploadStatus,
        },
      };
    },

    async runMinecraftCommand(command) {
      return sendMcCommand(command);
    },

    async serverPowerAction(action) {
      if (action === 'stop' || action === 'restart') {
        try {
          const msg =
            action === 'restart'
              ? '[YacaCode IA] Servidor reiniciando em instantes. Salvando o mundo...'
              : '[YacaCode IA] Servidor sendo desligado pelo painel. Salvando o mundo...';
          await sendMcCommand(`say ${msg}`);
        } catch {
          // segue com Docker
        }
      }
      return docker.controlContainer(CONFIG.mcContainerName, action);
    },

    async createBackupNow() {
      const res = gdrive.startSyncInBackground({ createNew: true });
      return {
        output: res.alreadyRunning
          ? 'Já existe um backup para o Google Drive em andamento — acompanhe a barra de progresso na aba Backups.'
          : 'Backup iniciado em segundo plano! Acompanhe o progresso em tempo real na aba Backups.',
        started: res.started,
        alreadyRunning: res.alreadyRunning,
        progress: res.progress,
      };
    },
  },
});

async function queryWorldDaytimeTicks() {
  try {
    const out = await sendMcCommand('time query daytime');
    const m = out.match(/time is\s+(\d+)/i);
    if (m) return Number(m[1]);
  } catch {
    // ignore
  }
  return null;
}

function describeDayPhase(daytimeTicks) {
  if (daytimeTicks === null || daytimeTicks === undefined) return null;
  const t = ((Number(daytimeTicks) % 24000) + 24000) % 24000;
  if (t < 3000) return 'manhã';
  if (t < 9000) return 'meio-dia / dia';
  if (t < 12000) return 'fim de tarde';
  if (t < 13500) return 'pôr do sol';
  if (t < 22000) return 'noite';
  return 'amanhecendo';
}

function distanceBetween(posA, posB) {
  if (!posA || !posB) return null;
  const dx = posA.x - posB.x;
  const dy = posA.y - posB.y;
  const dz = posA.z - posB.z;
  return Math.round(Math.sqrt(dx * dx + dy * dy + dz * dz));
}

async function buildInGameWorldContext(askingPlayerName) {
  const [mcPing, rconList, daytimeTicks] = await Promise.all([
    pingMinecraftServer(CONFIG.rconHost, 25565, 2000).catch(() => ({ online: false })),
    fetchOnlinePlayersViaRcon().catch(() => null),
    queryWorldDaytimeTicks(),
  ]);

  const world = playerData.getWorldOverview();
  const onlineObjs = rconList?.players || mcPing.players?.sample || [];
  const onlineNames = onlineObjs.map((p) => p.name);
  const profiles = playerData.getAllPlayerProfiles(onlineNames);

  // Tenta obter XP ao vivo de quem perguntou
  const asker = profiles.find(
    (p) => String(p.name || '').toLowerCase() === String(askingPlayerName || '').toLowerCase()
  );
  if (asker && asker.online) {
    const liveXp = await queryLiveXpLevel(asker.name);
    if (liveXp !== null) asker.xpLevel = liveXp;
  }

  const compactPlayers = profiles.slice(0, 12).map((p) => ({
    name: p.name,
    online: p.online,
    isOp: p.isOp,
    gamemode: p.gamemode || null,
    xpLevel: p.xpLevel ?? null,
    health: p.health ?? null,
    foodLevel: p.foodLevel ?? null,
    dimension: p.dimension || null,
    pos: p.position || null,
    distToSpawnBlocks:
      p.position && world?.spawn && p.dimension === world.spawn.dimension
        ? distanceBetween(p.position, world.spawn)
        : null,
    playTimeMinutes: p.stats?.playTimeMinutes ?? null,
    deaths: p.stats?.deaths ?? null,
    mobKills: p.stats?.mobKills ?? null,
    blocksMined: p.stats?.blocksMined ?? null,
  }));

  return {
    server: {
      name: CONFIG.serverName,
      domain: CONFIG.mcDomain,
      version: mcPing.version || CONFIG.mcVersion,
      onlineCount: rconList?.online ?? mcPing.players?.online ?? onlineNames.length,
      maxPlayers: rconList?.max ?? mcPing.players?.max ?? 6,
    },
    world: world
      ? {
          ...world,
          daytimeTicks: daytimeTicks ?? null,
          dayPhase: describeDayPhase(daytimeTicks),
        }
      : null,
    askingPlayer:
      compactPlayers.find(
        (p) => String(p.name || '').toLowerCase() === String(askingPlayerName || '').toLowerCase()
      ) || { name: askingPlayerName, online: true },
    players: compactPlayers,
  };
}

const inGameChat = createInGameChatBridge({
  docker,
  containerName: CONFIG.mcContainerName,
  ai,
  sendMcCommand,
  getWorldContext: buildInGameWorldContext,
});
inGameChat.start();

const IS_PUMPKIN_ENGINE = fs.existsSync(path.join(CONFIG.dataDir, 'pumpkin.toml'));

// Pré-geração do mapa (só com server vazio) + reinício diário às 5h se vazio
const maintenance = createMaintenanceManager({
  configFile: path.join(CONFIG.dataDir, '.yacacode-maintenance.json'),
  sendCommand: (cmd) => sendMcCommand(cmd),
  getOnlineCount: () => crossplaySync.getStats().activeSessions.length,
  getUptimeMs: async () => {
    const info = await docker.inspectContainer(CONFIG.mcContainerName);
    return info.running && info.startedAt ? Date.now() - new Date(info.startedAt).getTime() : 0;
  },
  restartServer: () => docker.controlContainer(CONFIG.mcContainerName, 'restart'),
});
const crossplaySync = createCrossplaySyncManager({
  dataDir: CONFIG.dataDir,
  syncEnabled: IS_PUMPKIN_ENGINE,
  onRawLine: (line) => maintenance.onLogLine(line),
  docker,
  containerName: CONFIG.mcContainerName,
  sendMcCommand,
  fetchOnlinePlayers: async () => {
    const rconList = await fetchOnlinePlayersViaRcon().catch(() => null);
    if (rconList?.players) return rconList.players;
    const ping = await pingMinecraftServer(CONFIG.rconHost, 25565, 2000).catch(() => null);
    return ping?.players?.sample || [];
  },
  onPlayerEvent: (evt) => {
    analytics.recordPlayerEvent(evt);
    if (evt.event === 'leave') gdrive.notifyPlayerLeft();
    if (evt.event === 'join') maintenance.onPlayerJoin().catch(() => {});
    if (evt.event === 'leave' && crossplaySync.getStats().activeSessions.length === 0) maintenance.onPlayerLeave();
    if (whatsapp) {
      whatsapp.notifyPlayerEvent(evt).catch(() => {});
    }
  },
});
crossplaySync.start();
maintenance.start();

async function getCurrentOnlinePlayerNames() {
  const rconList = await fetchOnlinePlayersViaRcon().catch(() => null);
  if (rconList?.players) return rconList.players.map((p) => p.name);
  const ping = await pingMinecraftServer(CONFIG.rconHost, 25565, 2000).catch(() => null);
  return (ping?.players?.sample || []).map((p) => p.name);
}

async function getWhatsAppServerStatus() {
  const [mcInfo, mcPing, rconList] = await Promise.all([
    docker.isAvailable()
      ? docker.inspectContainer(CONFIG.mcContainerName).catch(() => ({ running: false }))
      : Promise.resolve({ running: false }),
    pingMinecraftServer(CONFIG.rconHost, 25565, 2000).catch(() => ({ online: false })),
    fetchOnlinePlayersViaRcon().catch(() => null),
  ]);
  const snap = system.getSnapshot();
  const onlinePlayers = (rconList?.players || mcPing.players?.sample || []).map((p) => ({
    name: p.name,
    edition: String(p.name || '').startsWith('.') ? 'Bedrock' : 'Java',
  }));
  return {
    serverName: CONFIG.serverName,
    address: CONFIG.mcDomain,
    javaPort: CONFIG.mcJavaPort,
    bedrockPort: CONFIG.mcBedrockPort,
    online: Boolean(mcInfo.running && (mcPing.online || rconList)),
    containerRunning: Boolean(mcInfo.running),
    startedAt: mcInfo.startedAt || null,
    version: mcPing.version || CONFIG.mcVersion,
    playersOnlineCount: rconList?.online ?? mcPing.players?.online ?? onlinePlayers.length,
    maxPlayers: rconList?.max ?? mcPing.players?.max ?? 6,
    onlinePlayers,
    latencyMs: mcPing.latencyMs ?? null,
    cpuPercent: lastMcStats?.cpuPercent ?? null,
    ramUsedMB: lastMcStats?.memUsedBytes ? Math.round(lastMcStats.memUsedBytes / (1024 * 1024)) : null,
    hostRamPercent: snap?.memory?.percent ?? null,
    temperatureC: snap?.temperature?.celsius ?? null,
  };
}

whatsapp = createWhatsAppManager({
  dataDir: CONFIG.dataDir,
  serviceUrl: CONFIG.whatsappServiceUrl,
  internalToken: CONFIG.whatsappInternalToken,
  serverName: CONFIG.serverName,
  mcDomain: CONFIG.mcDomain,
  getGeminiConfig: () => ai.getActiveGeminiConfig(),
  getLiveSnapshot: getWhatsAppServerStatus,
  toolHandlers: {
    get_server_status: getWhatsAppServerStatus,
    get_server_report: async ({ days = 7 } = {}) => analytics.getReport(days),
    get_player_rankings: async ({ metric = 'all' } = {}) => {
      const onlineNames = await getCurrentOnlinePlayerNames();
      return analytics.getRankings(playerData, onlineNames, metric);
    },
    get_player_stats: async ({ name = '' } = {}) => {
      const clean = String(name || '').trim().toLowerCase().replace(/^\.+/, '');
      const onlineNames = await getCurrentOnlinePlayerNames();
      const all = analytics.getConsolidatedPlayerStats(playerData, onlineNames);
      const found =
        all.find((p) => p.key === clean) ||
        all.find((p) => p.key.includes(clean) || p.name.toLowerCase().includes(clean));
      if (!found) {
        return {
          found: false,
          message: `Jogador "${name}" não encontrado nos registros do servidor.`,
          knownPlayers: all.map((p) => p.name).slice(0, 15),
        };
      }
      return { found: true, player: found };
    },
    get_backup_status: async () => {
      const st = gdrive.getPublicStatus('admin');
      return {
        connected: st.connected,
        folderName: st.folderName,
        scheduleHours: st.scheduleHours,
        lastBackupAt: st.lastBackupAt,
        lastUploadFile: st.lastUploadFile,
        lastUploadSizeMB: st.lastUploadSize ? Math.round((st.lastUploadSize / (1024 * 1024)) * 10) / 10 : null,
        lastUploadStatus: st.lastUploadStatus,
        lastError: st.lastError,
        inProgress: Boolean(st.progress?.active),
        progressMessage: st.progress?.active ? st.progress.message : null,
      };
    },
    get_world_info: async () => {
      const [world, daytimeTicks] = await Promise.all([
        Promise.resolve(playerData.getWorldOverview()),
        queryWorldDaytimeTicks().catch(() => null),
      ]);
      if (!world) {
        return { available: false, message: 'Dados do mundo (level.dat) indisponíveis no momento.' };
      }
      return {
        available: true,
        ...world,
        daytimeTicks: daytimeTicks ?? null,
        dayPhase: describeDayPhase(daytimeTicks),
      };
    },
    get_recent_events: async () => {
      if (!docker.isAvailable()) {
        return { events: [], note: 'Docker indisponível.' };
      }
      const rawLogs = await docker.getContainerLogs(CONFIG.mcContainerName, 160).catch(() => '');
      const cleanLines = stripMinecraftColors(rawLogs)
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean);
      const interesting = cleanLines.filter((l) =>
        /(joined the game|left the game|has made the advancement|has completed the challenge|was slain|fell from|drowned|burned|blew up|tried to swim in lava|hit the ground|starved|suffocated|withered|died)/i.test(
          l
        )
      );
      return {
        eventsCount: interesting.length,
        recentEvents: interesting.slice(-20),
      };
    },
  },
});
whatsapp.startScheduler();

// Coletor leve em segundo plano para gráficos de telemetria (a cada 15s)
let lastMcStats = null;
let lastAnalyticsSampleAt = Date.now() - 14 * 60 * 1000;
let lastObservedMcOnline = null;
async function pollTelemetry() {
  try {
    let mcRunning = false;
    if (docker.isAvailable()) {
      const mcInfo = await docker.inspectContainer(CONFIG.mcContainerName);
      mcRunning = Boolean(mcInfo.running);
      lastMcStats = mcRunning ? await docker.getContainerStats(CONFIG.mcContainerName) : null;
    }
    system.recordHistoryPoint(lastMcStats);

    if (lastObservedMcOnline !== null && lastObservedMcOnline !== mcRunning) {
      analytics.recordServerStateChange(mcRunning, mcRunning ? 'Container iniciado' : 'Container parado');
      if (whatsapp) {
        whatsapp.notifyServerStateChange({
          online: mcRunning,
          reason: mcRunning ? 'Servidor voltou a ficar acessível.' : 'O container do Minecraft foi interrompido.',
        }).catch(() => {});
      }
    } else if (lastObservedMcOnline === null && whatsapp) {
      whatsapp.notifyServerStateChange({ online: mcRunning }).catch(() => {});
    }
    lastObservedMcOnline = mcRunning;

    // Grava amostra consolidada no histórico de 30 dias a cada 15 minutos
    if (Date.now() - lastAnalyticsSampleAt >= 15 * 60 * 1000) {
      lastAnalyticsSampleAt = Date.now();
      const snap = system.getSnapshot();
      const ping = mcRunning ? await pingMinecraftServer(CONFIG.rconHost, 25565, 1500).catch(() => null) : null;
      analytics.recordSample({
        online: mcRunning && Boolean(ping?.online ?? true),
        players: ping?.players?.online ?? 0,
        cpu: lastMcStats?.cpuPercent ?? null,
        ram: snap?.memory?.percent ?? null,
        temp: snap?.temperature?.celsius ?? null,
      });
    }
  } catch {
    // silencioso
  }
}
pollTelemetry();
const telemetryTimer = setInterval(pollTelemetry, 15000);
telemetryTimer.unref();

function serveStatic(req, res, pathname) {
  let rel = pathname === '/' ? '/index.html' : pathname;
  // Bloqueia traversal nos assets públicos
  const safePath = path.resolve(PUBLIC_DIR, `.${rel}`);
  if (!safePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  let fileToServe = safePath;
  if (!fs.existsSync(fileToServe) || fs.statSync(fileToServe).isDirectory()) {
    fileToServe = path.join(PUBLIC_DIR, 'index.html');
  }

  const ext = path.extname(fileToServe).toLowerCase();
  const mime = MIME_TYPES[ext] || 'application/octet-stream';
  const isAsset = pathname.startsWith('/assets/');

  setSecurityHeaders(res);
  res.writeHead(200, {
    'Content-Type': mime,
    'Cache-Control': isAsset ? 'public, max-age=86400' : 'no-cache',
  });
  fs.createReadStream(fileToServe).pipe(res);
}

async function handleApi(req, res, url) {
  const pathname = url.pathname;
  const method = req.method;

  // Healthcheck público para Docker
  if (pathname === '/api/health' && method === 'GET') {
    return sendJson(res, 200, { status: 'ok', service: 'yacacode-panel' });
  }

  // Webhook interno do micro-serviço WhatsApp (autenticado por X-Internal-Token)
  if (pathname === '/api/internal/whatsapp/incoming' && method === 'POST') {
    const providedToken = String(req.headers['x-internal-token'] || '').trim();
    if (CONFIG.whatsappInternalToken && providedToken !== CONFIG.whatsappInternalToken) {
      return sendJson(res, 401, { error: 'Token interno inválido.' });
    }
    const body = await readJsonBody(req, 64 * 1024);
    const result = await whatsapp.handleIncomingMessage(body);
    return sendJson(res, 200, { ok: true, ...result });
  }

  // Status de sessão / branding
  if (pathname === '/api/auth/me' && method === 'GET') {
    const session = auth.getSession(req);
    return sendJson(res, 200, {
      ...session,
      brand: {
        name: CONFIG.serverName,
        mcVersion: CONFIG.mcVersion,
        mcDomain: CONFIG.mcDomain,
        panelDomain: CONFIG.panelDomain,
        javaPort: CONFIG.mcJavaPort,
        bedrockPort: CONFIG.mcBedrockPort,
      },
    });
  }

  // Login
  if (pathname === '/api/auth/login' && method === 'POST') {
    if (!auth.validateCsrf(req)) {
      return sendJson(res, 403, { error: 'Origem da requisição não autorizada.' });
    }
    const body = await readJsonBody(req, 16 * 1024);
    const ip = auth.getClientIp(req);
    const result = auth.authenticate(body.username, body.password, ip);
    if (!result.ok) {
      return sendJson(res, result.status, { error: result.error });
    }
    return sendJson(
      res,
      200,
      { ok: true, username: result.username },
      { 'Set-Cookie': auth.buildSessionCookie(result.token, req) }
    );
  }

  // Logout
  if (pathname === '/api/auth/logout' && method === 'POST') {
    return sendJson(res, 200, { ok: true }, { 'Set-Cookie': auth.buildClearCookie(req) });
  }

  // Gate de autenticação para todas as demais rotas /api/*
  const session = auth.getSession(req);
  if (!session.authenticated) {
    return sendJson(res, 401, { error: 'Sessão expirada ou não autenticada.' });
  }

  if (!auth.validateCsrf(req)) {
    return sendJson(res, 403, { error: 'Falha na validação CSRF.' });
  }

  const requireRole = (minRole) => {
    if (!hasRole(session.role, minRole)) {
      sendJson(res, 403, {
        error: `Permissão insuficiente. Esta ação requer cargo "${minRole}" (seu cargo: "${session.role}").`,
      });
      return false;
    }
    return true;
  };

  // Alterar própria senha (qualquer usuário autenticado)
  if (pathname === '/api/auth/password' && method === 'POST') {
    const body = await readJsonBody(req, 16 * 1024);
    const result = auth.changeOwnPassword(session.username, body.currentPassword, body.newPassword);
    return sendJson(res, 200, result);
  }

  // ---------------------------------------------------------------------------
  // 0. GERENCIAMENTO DE USUÁRIOS DO PAINEL (ADMIN ONLY)
  // ---------------------------------------------------------------------------
  if (pathname === '/api/users' && method === 'GET') {
    if (!requireRole('admin')) return;
    return sendJson(res, 200, { users: auth.listUsers() });
  }

  if (pathname === '/api/users' && method === 'POST') {
    if (!requireRole('admin')) return;
    const body = await readJsonBody(req, 16 * 1024);
    const result = auth.createUser(body);
    return sendJson(res, 201, result);
  }

  if (pathname === '/api/users' && method === 'PATCH') {
    if (!requireRole('admin')) return;
    const body = await readJsonBody(req, 16 * 1024);
    const result = auth.updateUser(body.username, body);
    return sendJson(res, 200, result);
  }

  if (pathname === '/api/users' && method === 'DELETE') {
    if (!requireRole('admin')) return;
    const username = url.searchParams.get('username');
    const result = auth.deleteUser(username, session.username);
    return sendJson(res, 200, result);
  }

  // ---------------------------------------------------------------------------
  // 1. OVERVIEW / TELEMETRIA
  // ---------------------------------------------------------------------------
  if (pathname === '/api/overview' && method === 'GET') {
    const [mcInspect, stack, network, mcPing] = await Promise.all([
      docker.inspectContainer(CONFIG.mcContainerName),
      collectStackStatus(),
      system.checkPublicNetwork(false),
      pingMinecraftServer(CONFIG.rconHost, 25565, 2500),
    ]);

    const onlineCountFromPing = mcPing.players?.online ?? 0;
    const [mcStats, rconTps, rconList] = await Promise.all([
      mcInspect.running ? docker.getContainerStats(CONFIG.mcContainerName) : Promise.resolve(null),
      mcInspect.running ? fetchTpsViaRcon(onlineCountFromPing) : Promise.resolve(null),
      mcInspect.running && onlineCountFromPing > 0 && !(mcPing.players?.sample?.length)
        ? fetchOnlinePlayersViaRcon()
        : Promise.resolve(null),
    ]);

    if (mcStats) lastMcStats = mcStats;
    const host = system.getSnapshot();
    const backupsInfo = files.listBackups();
    const pluginsInfo = files.listPlugins();

    const playersOnline = rconList?.players || mcPing.players?.sample || [];
    const playersCount = rconList?.online ?? mcPing.players?.online ?? 0;
    const playersMax = rconList?.max ?? mcPing.players?.max ?? 20;

    return sendJson(res, 200, {
      server: {
        name: CONFIG.serverName,
        configuredVersion: CONFIG.mcVersion,
        runningVersion: mcPing.version || `Paper ${CONFIG.mcVersion}`,
        container: mcInspect,
        stats: mcStats,
        ping: mcPing,
        tps: rconTps,
        players: {
          online: playersCount,
          max: playersMax,
          list: playersOnline,
          javaCount: playersOnline.filter((p) => p.edition === 'java').length,
          bedrockCount: playersOnline.filter((p) => p.edition === 'bedrock').length,
        },
        crossplay: {
          geyserInstalled: pluginsInfo.plugins.some((p) => /geyser/i.test(p.fileName) && p.enabled),
          floodgateInstalled: pluginsInfo.floodgateInstalled,
          geyserConfigured: pluginsInfo.geyserConfigured,
        },
        backupCount: backupsInfo.backups.length,
        latestBackup: backupsInfo.backups[0] || null,
      },
      connection: {
        mcDomain: CONFIG.mcDomain,
        panelDomain: CONFIG.panelDomain,
        javaPort: CONFIG.mcJavaPort,
        bedrockPort: CONFIG.mcBedrockPort,
        viaCloudflare: session.viaCloudflare,
        cfEmail: session.cfEmail,
      },
      host,
      stack,
      network,
      history: system.getHistory(),
      dockerAvailable: docker.isAvailable(),
    });
  }

  // ---------------------------------------------------------------------------
  // 2. ENERGIA DO SERVIDOR (START / STOP / RESTART / KILL)
  // ---------------------------------------------------------------------------
  if (pathname === '/api/server/power' && method === 'POST') {
    const { action } = await readJsonBody(req, 8 * 1024);
    if (!['start', 'stop', 'restart', 'kill'].includes(action)) {
      return sendJson(res, 400, { error: 'Ação de energia inválida.' });
    }
    const needed = action === 'stop' || action === 'kill' ? 'admin' : 'moderator';
    if (!requireRole(needed)) return;

    // Salvamento gracioso antes de parar ou reiniciar
    if (action === 'stop' || action === 'restart') {
      try {
        const msg =
          action === 'restart'
            ? '[YacaCode] Servidor reiniciando em instantes. Salvando o mundo...'
            : '[YacaCode] Servidor sendo desligado pelo painel. Salvando o mundo...';
        await sendMcCommand(`say ${msg}`);
      } catch {
        // segue com Docker
      }
    }

    const result = await docker.controlContainer(CONFIG.mcContainerName, action);
    return sendJson(res, 200, { ok: true, action, ...result });
  }

  // ---------------------------------------------------------------------------
  // 3. CONSOLE RCON & LIVE LOGS (SSE)
  // ---------------------------------------------------------------------------
  if (pathname === '/api/console/command' && method === 'POST') {
    if (!requireRole('moderator')) return;
    const { command } = await readJsonBody(req, 16 * 1024);
    const clean = sanitizeSingleLine(command, 512).replace(/^\/+/, '');
    if (!clean) {
      return sendJson(res, 400, { error: 'Digite um comando válido.' });
    }
    const output = await sendMcCommand(clean);
    return sendJson(res, 200, {
      ok: true,
      command: clean,
      output,
    });
  }

  if (pathname === '/api/console/metrics' && method === 'GET') {
    if (!requireRole('moderator')) return;
    return sendJson(res, 200, await getConsoleMetrics());
  }

  if (pathname === '/api/maintenance' && method === 'GET') {
    if (!requireRole('admin')) return;
    return sendJson(res, 200, maintenance.getStatus());
  }

  if (pathname === '/api/maintenance/pregen' && method === 'PUT') {
    if (!requireRole('admin')) return;
    const body = await readJsonBody(req, 16 * 1024);
    const radius = body?.radius !== undefined ? Math.max(100, Math.min(5000, Number(body.radius) || 1500)) : undefined;
    const pregen = maintenance.configurePregen({ enabled: body?.enabled, radius, reset: Boolean(body?.reset) });
    if (pregen.enabled) maintenance.startOrResumePregen().catch(() => {});
    else await maintenance.pausePregen('desligada no painel').catch(() => {});
    return sendJson(res, 200, { ok: true, pregen });
  }

  if (pathname === '/api/config/jvm' && method === 'GET') {
    if (!requireRole('admin')) return;
    return sendJson(res, 200, { args: jvmArgs.read(), maxHeapMb: 2048, containerLimitMb: 2560 });
  }

  if (pathname === '/api/config/jvm' && method === 'PUT') {
    if (!requireRole('admin')) return;
    const body = await readJsonBody(req, 16 * 1024);
    const args = jvmArgs.write(body?.args ?? '');
    return sendJson(res, 200, { ok: true, args, restartRequired: true });
  }

  if (pathname === '/api/console/stream' && method === 'GET') {
    if (!requireRole('moderator')) return;
    const tail = Number(url.searchParams.get('tail')) || 200;
    setSecurityHeaders(res);
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    const writeEvent = (event, data) => {
      if (res.writableEnded) return;
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    // Keepalive a cada 20s para manter o stream vivo pelo Cloudflare Tunnel
    const keepalive = setInterval(() => {
      if (!res.writableEnded) res.write(': keepalive\n\n');
    }, 20000);

    // Reconecta sozinho quando o container do Minecraft reinicia (antes o console "congelava").
    let stopStream = () => {};
    let closed = false;
    let retryTimer = null;
    const attach = async (tailLines) => {
      if (closed) return;
      const scheduleRetry = () => {
        if (closed || retryTimer) return;
        writeEvent('meta', { reconnecting: true });
        retryTimer = setTimeout(() => {
          retryTimer = null;
          attach(0);
        }, 3000);
      };
      try {
        stopStream = await docker.streamContainerLogs(CONFIG.mcContainerName, {
          tail: tailLines,
          onLine: (line) => {
            if (!isConsoleNoise(line)) writeEvent('log', { line, ts: Date.now() });
          },
          onEnd: scheduleRetry,
          onError: scheduleRetry,
        });
        writeEvent('meta', { connected: true, container: CONFIG.mcContainerName });
      } catch {
        scheduleRetry();
      }
    };
    await attach(tail);

    req.on('close', () => {
      closed = true;
      clearInterval(keepalive);
      if (retryTimer) clearTimeout(retryTimer);
      stopStream();
    });
    return;
  }

  // ---------------------------------------------------------------------------
  // 4. JOGADORES (JAVA + BEDROCK / WHITELIST / OPS / BANS)
  // ---------------------------------------------------------------------------
  if (pathname === '/api/players' && method === 'GET') {
    const [rconList, ping] = await Promise.all([
      fetchOnlinePlayersViaRcon(),
      pingMinecraftServer(CONFIG.rconHost, 25565, 2500),
    ]);
    const props = files.getServerProperties().properties;
    const online = rconList?.players || ping.players?.sample || [];

    return sendJson(res, 200, {
      online,
      max: rconList?.max ?? ping.players?.max ?? Number(props['max-players'] || 20),
      whitelistEnabled: String(props['white-list'] || 'false') === 'true',
      whitelist: files.readJsonList('whitelist.json'),
      ops: files.readJsonList('ops.json'),
      bannedPlayers: files.readJsonList('banned-players.json'),
      bannedIps: files.readJsonList('banned-ips.json'),
    });
  }

  if (pathname === '/api/players/action' && method === 'POST') {
    if (!requireRole('moderator')) return;
    const body = await readJsonBody(req, 16 * 1024);
    const { action, player, reason, message } = body;
    let cmd = '';

    switch (action) {
      case 'kick': {
        const p = sanitizePlayerName(player);
        const r = sanitizeSingleLine(reason || 'Removido pelo administrador YacaCode');
        cmd = `kick ${p} ${r}`;
        break;
      }
      case 'ban': {
        const p = sanitizePlayerName(player);
        const r = sanitizeSingleLine(reason || 'Banido pelo administrador YacaCode');
        cmd = `ban ${p} ${r}`;
        break;
      }
      case 'pardon': {
        const p = sanitizePlayerName(player);
        cmd = `pardon ${p}`;
        break;
      }
      case 'op': {
        const p = sanitizePlayerName(player);
        cmd = `op ${p}`;
        break;
      }
      case 'deop': {
        const p = sanitizePlayerName(player);
        cmd = `deop ${p}`;
        break;
      }
      case 'whitelist-add': {
        const p = sanitizePlayerName(player);
        // Jogadores Bedrock (Floodgate) usam fwhitelist add quando prefixo "." ou fwhitelist
        cmd = p.startsWith('.') ? `fwhitelist add ${p.slice(1)}` : `whitelist add ${p}`;
        break;
      }
      case 'whitelist-remove': {
        const p = sanitizePlayerName(player);
        cmd = p.startsWith('.') ? `fwhitelist remove ${p.slice(1)}` : `whitelist remove ${p}`;
        break;
      }
      case 'whitelist-on':
        cmd = 'whitelist on';
        break;
      case 'whitelist-off':
        cmd = 'whitelist off';
        break;
      case 'say': {
        const m = sanitizeSingleLine(message, 240);
        if (!m) return sendJson(res, 400, { error: 'Mensagem vazia.' });
        cmd = `say ${m}`;
        break;
      }
      case 'whisper': {
        const p = sanitizePlayerName(player);
        const m = sanitizeSingleLine(message, 240);
        if (!m) return sendJson(res, 400, { error: 'Mensagem vazia.' });
        cmd = `tell ${p} ${m}`;
        break;
      }
      default:
        return sendJson(res, 400, { error: 'Ação de jogador inválida.' });
    }

    const output = await sendMcCommand(cmd);
    return sendJson(res, 200, { ok: true, command: cmd, output });
  }

  // ---------------------------------------------------------------------------
  // 5. SERVER.PROPERTIES & PRESETS ORANGE PI / GEYSER
  // ---------------------------------------------------------------------------
  if (pathname === '/api/properties' && method === 'GET') {
    return sendJson(res, 200, files.getServerProperties());
  }

  if (pathname === '/api/properties' && method === 'PUT') {
    if (!requireRole('admin')) return;
    const body = await readJsonBody(req, 64 * 1024);
    if (!body || typeof body.properties !== 'object') {
      return sendJson(res, 400, { error: 'Objeto properties obrigatório.' });
    }
    const result = files.saveServerProperties(body.properties);
    return sendJson(res, 200, result);
  }

  if (pathname === '/api/presets/apply' && method === 'POST') {
    if (!requireRole('admin')) return;
    const result = files.applyPresets();
    return sendJson(res, 200, result);
  }

  // ---------------------------------------------------------------------------
  // 6. PLUGINS
  // ---------------------------------------------------------------------------
  if (pathname === '/api/plugins' && method === 'GET') {
    return sendJson(res, 200, files.listPlugins());
  }

  if (pathname === '/api/plugins/toggle' && method === 'POST') {
    if (!requireRole('admin')) return;
    const { fileName } = await readJsonBody(req, 8 * 1024);
    return sendJson(res, 200, files.togglePlugin(fileName));
  }

  if (pathname === '/api/plugins/upload' && method === 'POST') {
    if (!requireRole('admin')) return;
    const name = url.searchParams.get('name');
    if (!name) return sendJson(res, 400, { error: 'Parâmetro ?name=arquivo.jar obrigatório.' });
    const raw = await readRawBody(req, 100 * 1024 * 1024);
    return sendJson(res, 200, files.saveUploadedPlugin(name, raw));
  }

  if (pathname === '/api/plugins' && method === 'DELETE') {
    if (!requireRole('admin')) return;
    const name = url.searchParams.get('name');
    return sendJson(res, 200, files.deletePlugin(name));
  }

  // ---------------------------------------------------------------------------
  // 7. GERENCIADOR DE ARQUIVOS (ADMIN ONLY)
  // ---------------------------------------------------------------------------
  if (pathname === '/api/files' && method === 'GET') {
    if (!requireRole('admin')) return;
    const rel = url.searchParams.get('path') || '';
    return sendJson(res, 200, files.listDirectory(rel));
  }

  if (pathname === '/api/files/content' && method === 'GET') {
    if (!requireRole('admin')) return;
    const rel = url.searchParams.get('path') || '';
    return sendJson(res, 200, files.readTextFile(rel));
  }

  if (pathname === '/api/files/content' && method === 'PUT') {
    if (!requireRole('admin')) return;
    const { path: rel, content } = await readJsonBody(req, 3 * 1024 * 1024);
    return sendJson(res, 200, files.writeTextFile(rel, content));
  }

  if (pathname === '/api/files/mkdir' && method === 'POST') {
    if (!requireRole('admin')) return;
    const { path: rel } = await readJsonBody(req, 8 * 1024);
    return sendJson(res, 200, files.createFolder(rel));
  }

  if (pathname === '/api/files' && method === 'DELETE') {
    if (!requireRole('admin')) return;
    const rel = url.searchParams.get('path') || '';
    return sendJson(res, 200, files.deleteItem(rel));
  }

  if (pathname === '/api/files/download' && method === 'GET') {
    if (!requireRole('admin')) return;
    const rel = url.searchParams.get('path') || '';
    const fullPath = files.resolveDataDownload(rel);
    const st = fs.statSync(fullPath);
    if (st.isDirectory()) return sendJson(res, 400, { error: 'Não é possível baixar uma pasta.' });
    const dlName = path.basename(fullPath).replace(/["\r\n]/g, '_');
    setSecurityHeaders(res);
    res.writeHead(200, {
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${dlName}"`,
      'Content-Length': st.size,
    });
    fs.createReadStream(fullPath).pipe(res);
    return;
  }

  // ---------------------------------------------------------------------------
  // 8. BACKUPS
  // ---------------------------------------------------------------------------
  if (pathname === '/api/backups' && method === 'GET') {
    return sendJson(res, 200, files.listBackups());
  }

  if (pathname === '/api/backups/now' && method === 'POST') {
    if (!requireRole('admin')) return;
    const result = gdrive.startSyncInBackground({ createNew: true });
    return sendJson(res, result.started ? 202 : 200, {
      ...result,
      output: result.alreadyRunning
        ? 'Backup para o Google Drive já está em andamento.'
        : 'Backup iniciado! Acompanhe o progresso abaixo.',
    });
  }

  // ---------------------------------------------------------------------------
  // 8B. GOOGLE DRIVE BACKUP (OAUTH 2.0 + RESUMABLE UPLOAD + AGENDAMENTO)
  // ---------------------------------------------------------------------------
  if (pathname === '/api/backups/gdrive/status' && method === 'GET') {
    const status = gdrive.getPublicStatus(session.role, req);
    let remoteFiles = null;
    if (url.searchParams.get('files') === '1' && status.connected) {
      try {
        const listed = await gdrive.listRemoteBackups();
        remoteFiles = listed.files;
      } catch (err) {
        status.remoteListError = err.message;
      }
    }
    return sendJson(res, 200, { ...status, remoteFiles });
  }

  if (pathname === '/api/backups/gdrive/config' && method === 'PUT') {
    if (!requireRole('admin')) return;
    const body = await readJsonBody(req, 32 * 1024);
    const updated = gdrive.updateConfig(body || {});
    return sendJson(res, 200, { ok: true, ...updated });
  }

  if (pathname === '/api/backups/gdrive/auth-url' && method === 'GET') {
    if (!requireRole('admin')) return;
    const authInfo = gdrive.buildAuthUrl({ req, username: session.username });
    return sendJson(res, 200, authInfo);
  }

  if (pathname === '/api/backups/gdrive/callback' && method === 'GET') {
    if (!requireRole('admin')) return;
    const errParam = url.searchParams.get('error');
    const code = url.searchParams.get('code');
    const stateParam = url.searchParams.get('state');
    const redirectBack = (statusKey, msg = '') => {
      const qs = new URLSearchParams({ tab: 'backups', gdrive: statusKey });
      if (msg) qs.set('msg', msg.slice(0, 180));
      setSecurityHeaders(res);
      res.writeHead(302, { Location: `/?${qs.toString()}` });
      res.end();
    };
    if (errParam) {
      return redirectBack('error', `Autorização cancelada no Google (${errParam}).`);
    }
    if (!code || !stateParam) {
      return redirectBack('error', 'Parâmetros OAuth ausentes no retorno do Google.');
    }
    try {
      await gdrive.handleOAuthCallback({
        code,
        state: stateParam,
        expectedUsername: session.username,
      });
      return redirectBack('connected');
    } catch (err) {
      return redirectBack('error', err.message || 'Falha ao conectar Google Drive.');
    }
  }

  if (pathname === '/api/backups/gdrive/disconnect' && method === 'POST') {
    if (!requireRole('admin')) return;
    const body = await readJsonBody(req, 8 * 1024);
    const updated = gdrive.disconnect({ clearCredentials: Boolean(body?.clearCredentials) });
    return sendJson(res, 200, { ok: true, ...updated });
  }

  if (pathname === '/api/backups/gdrive/test' && method === 'POST') {
    if (!requireRole('admin')) return;
    const result = await gdrive.testConnection();
    return sendJson(res, 200, result);
  }

  if (pathname === '/api/backups/gdrive/sync' && method === 'POST') {
    if (!requireRole('admin')) return;
    const body = await readJsonBody(req, 16 * 1024);
    const fileName = body?.fileName ? String(body.fileName) : null;
    const createNew = fileName ? false : true;
    const result = gdrive.startSyncInBackground({ fileName, createNew });
    return sendJson(res, result.started ? 202 : 200, {
      ...result,
      output: result.alreadyRunning
        ? 'Backup para o Google Drive já está em andamento.'
        : 'Envio iniciado em segundo plano! Acompanhe o progresso abaixo.',
    });
  }

  if (pathname === '/api/backups/gdrive/files' && method === 'DELETE') {
    if (!requireRole('admin')) return;
    const fileId = url.searchParams.get('id');
    const result = await gdrive.deleteRemoteBackup(fileId);
    return sendJson(res, 200, result);
  }

  if (pathname === '/api/backups/download' && method === 'GET') {
    if (!requireRole('admin')) return;
    const name = url.searchParams.get('name');
    const { fullPath, safeName } = files.getBackupFilePath(name);
    const st = fs.statSync(fullPath);
    setSecurityHeaders(res);
    res.writeHead(200, {
      'Content-Type': 'application/gzip',
      'Content-Disposition': `attachment; filename="${safeName}"`,
      'Content-Length': st.size,
    });
    fs.createReadStream(fullPath).pipe(res);
    return;
  }

  if (pathname === '/api/backups' && method === 'DELETE') {
    if (!requireRole('admin')) return;
    const name = url.searchParams.get('name');
    return sendJson(res, 200, files.deleteBackup(name));
  }

  // ---------------------------------------------------------------------------
  // 9. REDE, DOMÍNIO & CLOUDFLARE
  // ---------------------------------------------------------------------------
  if (pathname === '/api/network' && method === 'GET') {
    const force = url.searchParams.get('refresh') === '1';
    const [network, cfInfo, ddnsInfo] = await Promise.all([
      system.checkPublicNetwork(force),
      docker.inspectContainer(CONFIG.cloudflaredContainerName),
      docker.inspectContainer(CONFIG.ddnsContainerName),
    ]);

    return sendJson(res, 200, {
      network,
      mcDomain: CONFIG.mcDomain,
      panelDomain: CONFIG.panelDomain,
      javaPort: CONFIG.mcJavaPort,
      bedrockPort: CONFIG.mcBedrockPort,
      cloudflared: cfInfo,
      ddns: ddnsInfo,
      viaCloudflare: session.viaCloudflare,
      cfEmail: session.cfEmail,
      cfAccessEnabled: session.cfAccessEnabled,
    });
  }

  // ---------------------------------------------------------------------------
  // 10. ASSISTENTE IA GEMINI (CHAT + HISTÓRICO POR USUÁRIO + SYNC REAL-TIME)
  // ---------------------------------------------------------------------------
  if (pathname === '/api/ai/status' && method === 'GET') {
    return sendJson(res, 200, {
      ...ai.getPublicStatus(session.role),
      inGameChat: inGameChat.getStats(),
    });
  }

  if (pathname === '/api/ai/config' && method === 'PUT') {
    if (!requireRole('admin')) return;
    const body = await readJsonBody(req, 16 * 1024);
    const updated = ai.updateConfig({
      apiKey: body.apiKey,
      model: body.model,
      clearApiKey: Boolean(body.clearApiKey),
      inGameChatEnabled: body.inGameChatEnabled,
    });
    return sendJson(res, 200, {
      ok: true,
      ...updated,
      inGameChat: inGameChat.getStats(),
    });
  }

  if (pathname === '/api/ai/conversations' && method === 'GET') {
    return sendJson(res, 200, aiHistory.listConversations(session.username));
  }

  if (pathname === '/api/ai/conversations' && method === 'POST') {
    const body = await readJsonBody(req, 8 * 1024);
    const created = aiHistory.createConversation(session.username, {
      title: body?.title || '',
      select: true,
    });
    return sendJson(res, 201, created);
  }

  const aiConvMatch = pathname.match(/^\/api\/ai\/conversations\/([a-zA-Z0-9_-]{3,80})$/);
  if (aiConvMatch) {
    const convId = aiConvMatch[1];
    if (method === 'GET') {
      const select = url.searchParams.get('select') === '1';
      const conv = aiHistory.getConversation(session.username, convId, { select });
      if (!conv) return sendJson(res, 404, { error: 'Conversa não encontrada.' });
      return sendJson(res, 200, { conversation: conv });
    }
    if (method === 'PATCH') {
      const body = await readJsonBody(req, 8 * 1024);
      const updated = aiHistory.renameConversation(session.username, convId, body?.title || '');
      if (!updated) return sendJson(res, 404, { error: 'Conversa não encontrada.' });
      return sendJson(res, 200, { conversation: updated });
    }
    if (method === 'DELETE') {
      const deleted = aiHistory.deleteConversation(session.username, convId);
      if (!deleted) return sendJson(res, 404, { error: 'Conversa não encontrada.' });
      return sendJson(res, 200, deleted);
    }
  }

  if (pathname === '/api/ai/events' && method === 'GET') {
    setSecurityHeaders(res);
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    const writeEvent = (event, data) => {
      if (res.writableEnded) return;
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    writeEvent('connected', { user: session.username, ts: Date.now() });

    const keepalive = setInterval(() => {
      if (!res.writableEnded) res.write(': keepalive\n\n');
    }, 20000);

    const unsubscribe = aiHistory.subscribe(session.username, (payload) => {
      writeEvent('sync', payload);
    });

    req.on('close', () => {
      clearInterval(keepalive);
      unsubscribe();
    });
    return;
  }

  if (pathname === '/api/ai/chat' && method === 'POST') {
    const body = await readJsonBody(req, 128 * 1024);
    const cleanMsg = String(body?.message || '').trim();
    if (!cleanMsg) {
      return sendJson(res, 400, { error: 'Digite uma mensagem para o assistente.' });
    }
    if (!ai.getPublicStatus(session.role).configured) {
      return sendJson(res, 400, { error: 'API Key do Gemini ainda não configurada.' });
    }

    const reqConvId = typeof body?.conversationId === 'string' && body.conversationId.trim()
      ? body.conversationId.trim()
      : null;

    // Usa o histórico salvo no servidor (garante contexto unificado entre celular e PC)
    const serverHistory = reqConvId
      ? aiHistory.getHistoryForPrompt(session.username, reqConvId, 16)
      : [];
    const promptHistory = serverHistory.length > 0 ? serverHistory : body.history;

    const userSaved = aiHistory.appendUserMessage(session.username, {
      conversationId: reqConvId,
      text: cleanMsg,
    });
    const convId = userSaved.conversation.id;

    const result = await ai.chat({
      message: cleanMsg,
      history: promptHistory,
      session,
    });

    const modelSaved = aiHistory.appendModelMessage(session.username, {
      conversationId: convId,
      text: result.reply,
      model: result.model,
      actions: result.actions || [],
      pendingActions: result.pendingActions || [],
    });

    return sendJson(res, 200, {
      ...result,
      conversationId: convId,
      conversationTitle: modelSaved?.conversation?.title || userSaved.conversation.title,
      userMessage: userSaved.message,
      assistantMessage: modelSaved?.message || null,
      updatedAt: modelSaved?.conversation?.updatedAt || userSaved.conversation.updatedAt,
    });
  }

  if (pathname === '/api/ai/confirm' && method === 'POST') {
    const body = await readJsonBody(req, 16 * 1024);
    const result = await ai.resolvePendingAction({
      actionId: body.actionId,
      decision: body.decision,
      session,
    });
    aiHistory.resolvePendingActionInHistory(session.username, {
      actionId: body.actionId,
      status: result.status,
      output: result.output || result.summary,
    });
    return sendJson(res, 200, result);
  }

  // --- WHATSAPP IA (QR Code + Notificações + Consultas Gemini Read-Only) ---
  if (pathname === '/api/whatsapp/status' && method === 'GET') {
    if (!requireRole('admin')) return;
    const status = await whatsapp.getPublicStatus();
    return sendJson(res, 200, status);
  }

  if (pathname === '/api/whatsapp/connect' && method === 'POST') {
    if (!requireRole('admin')) return;
    const data = await whatsapp.connect();
    return sendJson(res, 200, data);
  }

  if (pathname === '/api/whatsapp/disconnect' && method === 'POST') {
    if (!requireRole('admin')) return;
    const body = await readJsonBody(req, 8 * 1024).catch(() => ({}));
    const data = await whatsapp.disconnect({ logout: Boolean(body.logout) });
    return sendJson(res, 200, data);
  }

  if (pathname === '/api/whatsapp/groups' && method === 'GET') {
    if (!requireRole('admin')) return;
    const data = await whatsapp.listGroups();
    return sendJson(res, 200, data);
  }

  if (pathname === '/api/whatsapp/config' && method === 'PUT') {
    if (!requireRole('admin')) return;
    const body = await readJsonBody(req, 32 * 1024);
    const saved = whatsapp.updateConfig(body);
    return sendJson(res, 200, { ok: true, config: saved });
  }

  if (pathname === '/api/whatsapp/test' && method === 'POST') {
    if (!requireRole('admin')) return;
    const result = await whatsapp.sendTestMessage();
    return sendJson(res, 200, result);
  }

  if (pathname === '/api/whatsapp/daily-report' && method === 'POST') {
    if (!requireRole('admin')) return;
    const result = await whatsapp.sendDailyReportNow({ markSent: false });
    return sendJson(res, 200, result);
  }

  return sendJson(res, 404, { error: 'Rota da API não encontrada.' });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    if (url.pathname.startsWith('/api/')) {
      await handleApi(req, res, url);
    } else {
      serveStatic(req, res, url.pathname);
    }
  } catch (err) {
    const status = err.status || err.statusCode || 500;
    if (!res.headersSent) {
      sendJson(res, status, { error: err.message || 'Erro interno no servidor.' });
    } else if (!res.writableEnded) {
      res.end();
    }
  }
});

server.listen(CONFIG.port, '0.0.0.0', () => {
  console.log(
    `[YacaCode Panel] Online na porta ${CONFIG.port} | Servidor: ${CONFIG.serverName} (${CONFIG.mcDomain})`
  );
});

process.on('SIGTERM', () => {
  clearInterval(telemetryTimer);
  gdrive.stopScheduler();
  inGameChat.stop();
  crossplaySync.stop();
  analytics.stop();
  whatsapp.stopScheduler();
  server.close(() => process.exit(0));
});
process.on('SIGINT', () => {
  clearInterval(telemetryTimer);
  gdrive.stopScheduler();
  inGameChat.stop();
  crossplaySync.stop();
  analytics.stop();
  whatsapp.stopScheduler();
  server.close(() => process.exit(0));
});
