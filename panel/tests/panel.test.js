import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import zlib from 'node:zlib';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { createAuthManager, hashPassword, verifyPasswordHash } from '../lib/auth.js';
import { createRconClient, stripMinecraftColors } from '../lib/rcon.js';
import { parseNbtBuffer, createPlayerDataReader } from '../lib/playerdata.js';
import { classifyMinecraftCommand, createAiAssistant } from '../lib/ai.js';
import { createAiHistoryStore } from '../lib/ai-history.js';
import { createGoogleDriveBackupManager } from '../lib/gdrive.js';
import {
  parseMinecraftChatLine,
  formatChatReplyLines,
  buildTellrawCommand,
} from '../lib/ingame-chat.js';
import {
  normalizeCrossplayKey,
  computeOfflineJavaUuid,
  parseJoinLeaveLine,
  createCrossplaySyncManager,
} from '../lib/crossplay-sync.js';
import { createAnalyticsManager } from '../lib/analytics.js';
import { createWhatsAppManager, isBotCalledInGroup, normalizePhoneList } from '../lib/whatsapp.js';
import {
  resolveSafePath,
  parseServerProperties,
  updateServerProperties,
  applyYamlReplacements,
  createFileManager,
} from '../lib/files.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PRESETS_PATH = path.resolve(__dirname, '../../minecraft/config/presets.json');

test('Auth: hash scrypt, login, cookie HMAC, tamper protection e rate limit', () => {
  const hash = hashPassword('YacaCode@2026!');
  assert.equal(verifyPasswordHash('YacaCode@2026!', hash), true);
  assert.equal(verifyPasswordHash('SenhaErrada', hash), false);

  const auth = createAuthManager({
    adminUser: 'admin',
    adminPasswordHash: hash,
    sessionSecret: 'a'.repeat(64),
  });

  const ok = auth.authenticate('admin', 'YacaCode@2026!', '10.0.0.1');
  assert.equal(ok.ok, true);
  assert.ok(ok.token);

  // Sessão válida
  const validReq = {
    headers: {
      cookie: `yacacode_session=${encodeURIComponent(ok.token)}`,
      'cf-ray': 'abc123',
      'cf-access-authenticated-user-email': 'admin@yacacode.com',
    },
  };
  const session = auth.getSession(validReq);
  assert.equal(session.authenticated, true);
  assert.equal(session.username, 'admin');
  assert.equal(session.viaCloudflare, true);
  assert.equal(session.cfEmail, 'admin@yacacode.com');

  // Token adulterado deve falhar
  const tamperedReq = { headers: { cookie: `yacacode_session=${ok.token}X` } };
  assert.equal(auth.getSession(tamperedReq).authenticated, false);

  // Rate limit após 5 tentativas falhas
  for (let i = 0; i < 5; i += 1) {
    const fail = auth.authenticate('admin', 'wrong', '192.168.1.99');
    assert.equal(fail.status, 401);
  }
  const blocked = auth.authenticate('admin', 'YacaCode@2026!', '192.168.1.99');
  assert.equal(blocked.status, 429);
});

test('RCON: protocolo Source RCON TCP completo com servidor mock', async () => {
  assert.equal(stripMinecraftColors('§a§lYacaCode §626.3'), 'YacaCode 26.3');

  function makePkt(id, type, body) {
    const b = Buffer.from(body, 'utf8');
    const len = 4 + 4 + b.length + 2;
    const buf = Buffer.alloc(4 + len);
    buf.writeInt32LE(len, 0);
    buf.writeInt32LE(id, 4);
    buf.writeInt32LE(type, 8);
    b.copy(buf, 12);
    buf.writeUInt16LE(0, 12 + b.length);
    return buf;
  }

  const mockServer = net.createServer((socket) => {
    let acc = Buffer.alloc(0);
    socket.on('data', (chunk) => {
      acc = Buffer.concat([acc, chunk]);
      while (acc.length >= 4) {
        const len = acc.readInt32LE(0);
        if (acc.length < 4 + len) break;
        const id = acc.readInt32LE(4);
        const type = acc.readInt32LE(8);
        const body = acc.toString('utf8', 12, 4 + len - 2);
        acc = acc.subarray(4 + len);

        if (type === 3) {
          socket.write(makePkt(body === 'secret123' ? id : -1, 2, ''));
        } else if (type === 2) {
          socket.write(makePkt(id, 0, '§aTPS from last 1m, 5m, 15m: 20.0, 19.9, 20.0'));
        } else if (type === 0) {
          socket.write(makePkt(id, 0, ''));
        }
      }
    });
  });

  await new Promise((resolve) => mockServer.listen(0, '127.0.0.1', resolve));
  const { port } = mockServer.address();

  try {
    const rconOk = createRconClient({ host: '127.0.0.1', port, password: 'secret123' });
    const res = await rconOk.send('tps');
    assert.match(stripMinecraftColors(res), /20\.0/);

    const rconBad = createRconClient({ host: '127.0.0.1', port, password: 'wrong' });
    await assert.rejects(() => rconBad.send('tps'), /recusada/i);
  } finally {
    mockServer.close();
  }
});

test('Files: anti-path-traversal, server.properties, upload JAR e presets YAML', () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'yc-mc-test-'));
  const dataDir = path.join(tmpRoot, 'data');
  const backupsDir = path.join(tmpRoot, 'backups');
  fs.mkdirSync(path.join(dataDir, 'plugins/Geyser-Spigot'), { recursive: true });
  fs.mkdirSync(backupsDir, { recursive: true });

  try {
    // Bloqueio de path traversal
    assert.throws(() => resolveSafePath(dataDir, '../../etc/passwd'), /Acesso negado/);
    assert.throws(() => resolveSafePath(dataDir, 'ok\0bad'), /inválido/);

    // server.properties preservando comentários
    const initialProps = '# YacaCode config\nmotd=Old\nmax-players=10\nview-distance=10\n';
    const updatedProps = updateServerProperties(initialProps, {
      motd: 'YacaCode 26.3',
      'view-distance': '8',
      'allow-flight': 'true',
    });
    assert.match(updatedProps, /^# YacaCode config/m);
    const parsed = parseServerProperties(updatedProps);
    assert.equal(parsed.motd, 'YacaCode 26.3');
    assert.equal(parsed['view-distance'], '8');
    assert.equal(parsed['allow-flight'], 'true');

    // YAML presets em Geyser config.yml
    const sampleGeyser = [
      'bedrock:',
      '  address: 0.0.0.0',
      '  port: 19132',
      '  clone-remote-port: true',
      '  transport: raknet',
      '  motd1: "Geyser"',
      '  motd2: "Another Geyser server"',
      '  server-name: "Geyser"',
      'remote:',
      '  auth-type: online',
      'show-cooldown: title',
    ].join('\n');
    fs.writeFileSync(path.join(dataDir, 'plugins/Geyser-Spigot/config.yml'), sampleGeyser, 'utf8');

    const fm = createFileManager({ dataDir, backupsDir, presetsFile: PRESETS_PATH });
    const presetRes = fm.applyPresets();
    const geyserReport = presetRes.report.find((r) => r.preset === 'geyser');
    assert.equal(geyserReport.status, 'applied');
    assert.ok(geyserReport.changes >= 6);

    const newGeyser = fs.readFileSync(path.join(dataDir, 'plugins/Geyser-Spigot/config.yml'), 'utf8');
    assert.match(newGeyser, /clone-remote-port: false/);
    assert.match(newGeyser, /transport: nethernet/);
    assert.match(newGeyser, /server-name: "YacaCode"/);
    assert.match(newGeyser, /auth-type: floodgate/);
    assert.equal(fs.existsSync(path.join(dataDir, 'plugins/Geyser-Spigot/config.yml.bak')), true);

    // Upload de plugin JAR (valida magic bytes PK\x03\x04)
    const fakeJar = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x00, 0x00]);
    const up = fm.saveUploadedPlugin('TestPlugin.jar', fakeJar);
    assert.equal(up.ok, true);
    assert.throws(() => fm.saveUploadedPlugin('Malicious.jar', Buffer.from('not-a-zip')), /JAR\/ZIP válido/);

    // Toggle plugin
    const toggled = fm.togglePlugin('TestPlugin.jar');
    assert.equal(toggled.enabled, false);
    assert.equal(toggled.fileName, 'TestPlugin.jar.disabled');

    // YAML helper direct check
    const yamlCheck = applyYamlReplacements('spark:\n  enabled: false\n', [
      { section: 'spark', key: 'enabled', value: 'true' },
    ]);
    assert.match(yamlCheck.content, /enabled: true/);
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test('HTTP Server E2E: health, login, proteção 401, arquivos e static assets', async () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'yc-panel-e2e-'));
  const dataDir = path.join(tmpRoot, 'data');
  const backupsDir = path.join(tmpRoot, 'backups');
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(backupsDir, { recursive: true });
  fs.writeFileSync(path.join(dataDir, 'server.properties'), 'motd=YacaCode\nmax-players=20\n');

  const testPort = 18080 + Math.floor(Math.random() * 1000);
  const passHash = hashPassword('SenhaSuperSegura99');

  const proc = spawn(process.execPath, [path.resolve(__dirname, '../server.js')], {
    env: {
      ...process.env,
      PORT: String(testPort),
      ADMIN_USER: 'admin',
      ADMIN_PASSWORD_HASH: passHash,
      SESSION_SECRET: 's'.repeat(64),
      RCON_PASSWORD: 'rcon-test-password',
      MC_DATA_DIR: dataDir,
      MC_BACKUPS_DIR: backupsDir,
      MC_PRESETS_FILE: PRESETS_PATH,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const baseUrl = `http://127.0.0.1:${testPort}`;

  // Aguarda boot do servidor
  for (let i = 0; i < 40; i += 1) {
    try {
      const r = await fetch(`${baseUrl}/api/health`);
      if (r.ok) break;
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }

  try {
    const health = await fetch(`${baseUrl}/api/health`);
    assert.equal(health.status, 200);
    assert.equal((await health.json()).status, 'ok');

    // Static assets (incluindo logo YacaCode!)
    const htmlRes = await fetch(`${baseUrl}/`);
    assert.equal(htmlRes.status, 200);
    const html = await htmlRes.text();
    assert.match(html, /YacaCode/);

    const logoRes = await fetch(`${baseUrl}/assets/yacacode-logo-256.png`);
    assert.equal(logoRes.status, 200);
    assert.equal(logoRes.headers.get('content-type'), 'image/png');

    // Rota protegida bloqueada sem cookie
    const unauth = await fetch(`${baseUrl}/api/properties`);
    assert.equal(unauth.status, 401);

    // Login
    const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'YacaCodePanel',
      },
      body: JSON.stringify({ username: 'admin', password: 'SenhaSuperSegura99' }),
    });
    assert.equal(loginRes.status, 200);
    const setCookie = loginRes.headers.get('set-cookie');
    assert.ok(setCookie && setCookie.includes('yacacode_session='));
    const cookieHeader = setCookie.split(';')[0];

    // Leitura autenticada de server.properties
    const propsRes = await fetch(`${baseUrl}/api/properties`, {
      headers: { Cookie: cookieHeader },
    });
    assert.equal(propsRes.status, 200);
    const propsJson = await propsRes.json();
    assert.equal(propsJson.properties.motd, 'YacaCode');

    // Multi-usuário & RBAC: Admin cria um usuário viewer e testa bloqueio 403
    const createUserRes = await fetch(`${baseUrl}/api/users`, {
      method: 'POST',
      headers: {
        Cookie: cookieHeader,
        'Content-Type': 'application/json',
        'X-Requested-With': 'YacaCodePanel',
      },
      body: JSON.stringify({
        username: 'amigo1',
        displayName: 'Amigo Teste',
        password: 'Password123',
        role: 'viewer',
      }),
    });
    assert.equal(createUserRes.status, 201);
    const createdJson = await createUserRes.json();
    assert.equal(createdJson.users.length, 2);

    // Login como viewer
    const viewerLogin = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'YacaCodePanel' },
      body: JSON.stringify({ username: 'amigo1', password: 'Password123' }),
    });
    assert.equal(viewerLogin.status, 200);
    const viewerCookie = viewerLogin.headers.get('set-cookie').split(';')[0];

    // Viewer NÃO pode acessar /api/users (403) nem configurar IA (403)
    const viewerForbidden = await fetch(`${baseUrl}/api/users`, {
      headers: { Cookie: viewerCookie },
    });
    assert.equal(viewerForbidden.status, 403);

    const aiStatusRes = await fetch(`${baseUrl}/api/ai/status`, {
      headers: { Cookie: viewerCookie },
    });
    assert.equal(aiStatusRes.status, 200);
    const aiStatusJson = await aiStatusRes.json();
    assert.equal(aiStatusJson.permissions.canRunCommands, false);
    assert.equal(aiStatusJson.permissions.canConfigure, false);

    const viewerAiCfgForbidden = await fetch(`${baseUrl}/api/ai/config`, {
      method: 'PUT',
      headers: {
        Cookie: viewerCookie,
        'Content-Type': 'application/json',
        'X-Requested-With': 'YacaCodePanel',
      },
      body: JSON.stringify({ model: 'gemini-2.5-flash' }),
    });
    assert.equal(viewerAiCfgForbidden.status, 403);

    // Admin exclui o usuário amigo1 e sessão dele é revogada imediatamente
    const delUserRes = await fetch(`${baseUrl}/api/users?username=amigo1`, {
      method: 'DELETE',
      headers: { Cookie: cookieHeader, 'X-Requested-With': 'YacaCodePanel' },
    });
    assert.equal(delUserRes.status, 200);
    const revokedCheck = await fetch(`${baseUrl}/api/properties`, {
      headers: { Cookie: viewerCookie },
    });
    assert.equal(revokedCheck.status, 401);
  } finally {
    proc.kill('SIGTERM');
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test('PlayerData NBT: leitura gzipada de XpLevel, Health, Pos, Dimension e gamemode', () => {
  const chunks = [];
  const pushStr = (s) => {
    const b = Buffer.from(s, 'utf8');
    const l = Buffer.alloc(2);
    l.writeUInt16BE(b.length, 0);
    chunks.push(l, b);
  };
  // Root TAG_Compound("")
  chunks.push(Buffer.from([10]));
  pushStr('');
  // TAG_Int("XpLevel") = 27
  chunks.push(Buffer.from([3]));
  pushStr('XpLevel');
  const xpBuf = Buffer.alloc(4);
  xpBuf.writeInt32BE(27, 0);
  chunks.push(xpBuf);
  // TAG_Float("Health") = 18.5
  chunks.push(Buffer.from([5]));
  pushStr('Health');
  const hpBuf = Buffer.alloc(4);
  hpBuf.writeFloatBE(18.5, 0);
  chunks.push(hpBuf);
  // TAG_String("Dimension") = "minecraft:overworld"
  chunks.push(Buffer.from([8]));
  pushStr('Dimension');
  pushStr('minecraft:overworld');
  // TAG_List("Pos") of 3 TAG_Double
  chunks.push(Buffer.from([9]));
  pushStr('Pos');
  chunks.push(Buffer.from([6])); // element type = Double
  const listLen = Buffer.alloc(4);
  listLen.writeInt32BE(3, 0);
  chunks.push(listLen);
  for (const coord of [120.4, 64.0, -45.7]) {
    const d = Buffer.alloc(8);
    d.writeDoubleBE(coord, 0);
    chunks.push(d);
  }
  // TAG_End
  chunks.push(Buffer.from([0]));

  const gz = zlib.gzipSync(Buffer.concat(chunks));
  const parsed = parseNbtBuffer(gz);
  assert.equal(parsed.XpLevel, 27);
  assert.equal(parsed.Health, 18.5);
  assert.equal(parsed.Dimension, 'minecraft:overworld');
  assert.equal(Math.round(parsed.Pos[0]), 120);

  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'yc-nbt-test-'));
  try {
    fs.mkdirSync(path.join(tmpRoot, 'world/players/data'), { recursive: true });
    fs.writeFileSync(
      path.join(tmpRoot, 'usercache.json'),
      JSON.stringify([{ uuid: '11111111-1111-1111-1111-111111111111', name: 'Nycolazs' }])
    );
    fs.writeFileSync(path.join(tmpRoot, 'world/players/data/11111111-1111-1111-1111-111111111111.dat'), gz);

    const reader = createPlayerDataReader(tmpRoot);
    const prof = reader.findPlayerProfileByName('Nycolazs', ['Nycolazs']);
    assert.equal(prof.online, true);
    assert.equal(prof.xpLevel, 27);
    assert.equal(prof.health, 18.5);
    assert.equal(prof.dimension, 'overworld');
    assert.deepEqual(prof.position, { x: 120, y: 64, z: -46 });
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test('AI Assistant: RBAC, confirmação 1-clique para destrutivos e loop Function Calling mockado', async () => {
  // Classificação RBAC + destrutivos
  assert.equal(classifyMinecraftCommand('time set day', 'viewer').allowed, false);
  assert.equal(classifyMinecraftCommand('list', 'viewer').allowed, true);
  assert.equal(classifyMinecraftCommand('op Steve', 'moderator').allowed, false);
  assert.equal(classifyMinecraftCommand('op Steve', 'admin').allowed, true);
  assert.equal(classifyMinecraftCommand('op Steve', 'admin').requiresConfirmation, false);
  assert.equal(classifyMinecraftCommand('time set day', 'moderator').requiresConfirmation, false);
  assert.equal(classifyMinecraftCommand('ban Griefer', 'moderator').requiresConfirmation, true);

  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'yc-ai-test-'));
  const executedCmds = [];
  let apiCallCount = 0;

  // Mock Gemini API: 1ª chamada pede functionCalls (time set day + ban Griefer), 2ª retorna texto final
  const mockFetch = async () => {
    apiCallCount += 1;
    if (apiCallCount === 1) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          candidates: [
            {
              content: {
                role: 'model',
                parts: [
                  { functionCall: { name: 'run_minecraft_command', args: { command: 'time set day', reason: 'Deixar de dia' } } },
                  { functionCall: { name: 'run_minecraft_command', args: { command: 'ban Griefer', reason: 'Banir Griefer' } } },
                ],
              },
            },
          ],
        }),
      };
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({
        candidates: [
          {
            content: {
              role: 'model',
              parts: [{ text: 'Já deixei de dia! Para banir **Griefer**, clique em confirmar abaixo.' }],
            },
          },
        ],
      }),
    };
  };

  try {
    const ai = createAiAssistant({
      configFile: path.join(tmpRoot, '.ai.json'),
      envApiKey: 'AIzaSyTestFakeKeyForUnitTest12345',
      envModel: 'gemini-2.5-flash',
      fetchImpl: mockFetch,
      handlers: {
        getServerStatus: async () => ({ running: true }),
        listPlayers: async () => ({ onlineCount: 1, onlinePlayers: [{ name: 'Nycolazs', xpLevel: 12 }] }),
        getPlayerDetails: async () => ({ found: true, name: 'Nycolazs', xpLevel: 12 }),
        getRecentLogs: async () => ({ count: 0, lines: [] }),
        listBackups: async () => ({ backups: [] }),
        runMinecraftCommand: async (cmd) => {
          executedCmds.push(cmd);
          return `Executed: ${cmd}`;
        },
        serverPowerAction: async () => ({ ok: true }),
        createBackupNow: async () => ({ ok: true }),
      },
    });

    const session = { username: 'nycolas', displayName: 'Nycolas', role: 'admin' };
    const chatRes = await ai.chat({ message: 'deixa de dia e bane o Griefer', session });

    assert.equal(chatRes.ok, true);
    assert.match(chatRes.reply, /deixei de dia/i);
    // time set day executou imediatamente; ban Griefer ficou pendente!
    assert.deepEqual(executedCmds, ['time set day']);
    assert.equal(chatRes.pendingActions.length, 1);
    assert.equal(chatRes.pendingActions[0].command, 'ban Griefer');

    // Aprovar em 1 clique executa o ban
    const confirmRes = await ai.resolvePendingAction({
      actionId: chatRes.pendingActions[0].id,
      decision: 'approve',
      session,
    });
    assert.equal(confirmRes.status, 'executed');
    assert.deepEqual(executedCmds, ['time set day', 'ban Griefer']);
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test('Google Drive Backup: tar.gz sem segredos, OAuth state, upload resumable e prune na nuvem', async () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'yc-gdrive-test-'));
  const dataDir = path.join(tmpRoot, 'data');
  const backupsDir = path.join(tmpRoot, 'backups');
  fs.mkdirSync(path.join(dataDir, 'world'), { recursive: true });
  fs.mkdirSync(backupsDir, { recursive: true });
  fs.writeFileSync(path.join(dataDir, 'world/level.dat'), 'world-binary-data');
  fs.writeFileSync(path.join(dataDir, 'pumpkin.toml'), 'seed = ""\n');
  fs.writeFileSync(path.join(dataDir, '.yacacode-gdrive-config.json'), '{"clientSecret":"TOPSECRET"}');

  const remoteFiles = [
    { id: 'old-file-1', name: 'old-1.tar.gz', size: '100', createdTime: '2026-11-18T10:00:00Z' },
    { id: 'old-file-2', name: 'old-2.tar.gz', size: '100', createdTime: '2026-11-17T10:00:00Z' },
  ];
  const deletedRemoteIds = [];
  let uploadedBytesTotal = 0;

  const mockFetch = async (url, opts = {}) => {
    const u = String(url);
    const method = (opts.method || 'GET').toUpperCase();

    if (u.startsWith('https://oauth2.googleapis.com/token')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          access_token: 'ya29.mock_access_token',
          refresh_token: '1//mock_refresh_token_123456',
          expires_in: 3600,
        }),
      };
    }
    if (u.includes('/drive/v3/about')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          user: { emailAddress: 'nycolas@gmail.com', displayName: 'Nycolas' },
          storageQuota: { limit: '107374182400', usage: '5000000000', usageInDrive: '4000000000' },
        }),
      };
    }
    if (u.includes('uploadType=resumable')) {
      return {
        ok: true,
        status: 200,
        headers: { get: (k) => (k.toLowerCase() === 'location' ? 'https://mock-upload.googleapis.com/session1' : null) },
        json: async () => ({}),
      };
    }
    if (u === 'https://mock-upload.googleapis.com/session1' && method === 'PUT') {
      const buf = Buffer.from(opts.body);
      uploadedBytesTotal += buf.length;
      const range = opts.headers['Content-Range'];
      const m = range.match(/bytes \d+-(\d+)\/(\d+)/);
      const isLast = Number(m[1]) + 1 === Number(m[2]);
      if (!isLast) return { ok: false, status: 308, json: async () => ({}) };
      const created = {
        id: 'new-file-99',
        name: 'yacacode-world-test.tar.gz',
        size: String(uploadedBytesTotal),
        createdTime: '2026-11-19T23:00:00Z',
        webViewLink: 'https://drive.google.com/file/d/new-file-99/view',
      };
      remoteFiles.unshift(created);
      return { ok: true, status: 200, json: async () => created };
    }
    if (u.includes('/drive/v3/files') && method === 'POST') {
      return { ok: true, status: 200, json: async () => ({ id: 'folder-abc12345', name: 'YacaCode Minecraft Backups' }) };
    }
    if (u.includes('/drive/v3/files/folder-abc12345')) {
      return { ok: true, status: 200, json: async () => ({ id: 'folder-abc12345', name: 'YacaCode Minecraft Backups', trashed: false, mimeType: 'application/vnd.google-apps.folder' }) };
    }
    if (u.includes('/drive/v3/files/') && method === 'DELETE') {
      const id = decodeURIComponent(u.split('/drive/v3/files/')[1].split('?')[0]);
      deletedRemoteIds.push(id);
      return { ok: true, status: 204, json: async () => ({}) };
    }
    if (u.includes('/drive/v3/files?q=')) {
      if (decodeURIComponent(u).includes("mimeType='application/vnd.google-apps.folder'")) {
        return { ok: true, status: 200, json: async () => ({ files: [{ id: 'folder-abc12345', name: 'YacaCode Minecraft Backups' }] }) };
      }
      return { ok: true, status: 200, json: async () => ({ files: [...remoteFiles] }) };
    }
    throw new Error(`Unexpected fetch URL in mock: ${method} ${u}`);
  };

  try {
    const fm = createFileManager({ dataDir, backupsDir, presetsFile: PRESETS_PATH });
    const gd = createGoogleDriveBackupManager({
      configFile: path.join(dataDir, '.yacacode-gdrive-config.json'),
      sessionSecret: 'g'.repeat(64),
      panelDomain: 'painel.yacacode.com',
      fetchImpl: mockFetch,
      createLocalBackup: () =>
        fm.createWorldBackupArchive({ destDir: path.join(tmpRoot, 'tmp-upload'), maxLocalBackups: 0 }),
      getBackupFilePath: (n) => fm.getBackupFilePath(n),
      getWorldLastModifiedMs: () => fm.getWorldLastModifiedMs(),
    });

    // 1. Configura credenciais e verifica mascaramento
    const cfg = gd.updateConfig({
      clientId: '1234567890-test.apps.googleusercontent.com',
      clientSecret: 'GOCSPX-super-secret-value',
      maxBackups: 2,
      scheduleHours: 12,
      enabled: true,
    });
    assert.equal(cfg.hasCredentials, true);
    assert.equal(cfg.connected, false);
    assert.equal(cfg.hasClientSecret, true);
    assert.ok(!JSON.stringify(cfg).includes('super-secret-value'));

    // 2. OAuth flow (state válido e rejeição de state adulterado)
    const { url } = gd.buildAuthUrl({ username: 'nycolas' });
    const stateParam = new URL(url).searchParams.get('state');
    await assert.rejects(
      () => gd.handleOAuthCallback({ code: 'abc', state: `${stateParam}X`, expectedUsername: 'nycolas' }),
      /inválido/i
    );
    const connected = await gd.handleOAuthCallback({ code: 'valid-code', state: stateParam, expectedUsername: 'nycolas' });
    assert.equal(connected.connected, true);
    assert.equal(connected.accountEmail, 'nycolas@gmail.com');
    assert.equal(connected.folderId, 'folder-abc12345');

    // 3. Cria backup local + upload resumable + prune (maxBackups = 2 -> deve apagar old-file-2)
    const syncRes = await gd.syncNow({ createNew: true });
    assert.equal(syncRes.ok, true);
    assert.ok(uploadedBytesTotal > 0);
    assert.equal(syncRes.prunedCount, 1);
    assert.deepEqual(deletedRemoteIds, ['old-file-2']);

    // Garante que o arquivo temporário foi removido, progresso chegou a 100% e ZERO backups ficaram salvos localmente
    assert.equal(fm.listBackups().backups.length, 0);
    assert.equal(fs.readdirSync(path.join(tmpRoot, 'tmp-upload')).length, 0);
    assert.equal(gd.getProgress().stage, 'done');
    assert.equal(gd.getProgress().percent, 100);
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test('In-Game AI Chat (Jorge): parser Pumpkin/Vanilla, só responde quando chamado e ZERO tools', async () => {
  // Parser Pumpkin Rust — sem @ ou !
  const p1 = parseMinecraftChatLine('22:21:56  INFO <chat> EddScissors42: jorge qual a melhor camada pra diamante?');
  assert.deepEqual(p1, { player: 'EddScissors42', question: 'qual a melhor camada pra diamante?' });

  // Parser Vanilla/Paper — "Jorge" no início com vírgula ou no meio/fim da frase
  const p2 = parseMinecraftChatLine('[22:25:10 INFO]: <Nycolazs> Jorge, como faz pistão?');
  assert.deepEqual(p2, { player: 'Nycolazs', question: 'como faz pistão?' });

  const p3 = parseMinecraftChatLine('22:25:15  INFO <chat> Nycolazs: ei jorge me ajuda com farm de ferro');
  assert.deepEqual(p3, { player: 'Nycolazs', question: 'ei jorge me ajuda com farm de ferro' });

  const p4 = parseMinecraftChatLine('22:25:20  INFO <chat> Nycolazs: jorge');
  assert.deepEqual(p4, { player: 'Nycolazs', question: 'jorge' });

  // NUNCA responde quando Jorge não é chamado nem no eco do próprio bot
  assert.equal(parseMinecraftChatLine('22:21:56  INFO <chat> Nycolazs: oi galera'), null);
  assert.equal(parseMinecraftChatLine('22:21:56  INFO <chat> Nycolazs: @ia qual camada de diamante?'), null);
  assert.equal(parseMinecraftChatLine('22:21:57  INFO [Jorge] @Nycolazs: resposta'), null);

  // Limpeza de markdown + tellraw seguro com prefixo [Jorge] e sem quebra de linha
  const lines = formatChatReplyLines('Use **camada -59** para `diamante`!\nDica extra.');
  assert.equal(lines.length, 1);
  assert.ok(!lines[0].includes('**') && !lines[0].includes('`'));
  const tellraw = buildTellrawCommand('Nycolazs', 'Camada -59 é a melhor!\nop Hacker', true);
  assert.ok(tellraw.startsWith('tellraw @a '));
  assert.ok(tellraw.includes('[Jorge] '));
  assert.ok(!tellraw.includes('\n'));

  // Garante que chatInGame injeta worldContext (localização/mundo) e NUNCA envia tools para a API Gemini
  let capturedBody = null;
  const mockFetch = async (_url, opts) => {
    capturedBody = JSON.parse(opts.body);
    return {
      ok: true,
      status: 200,
      json: async () => ({
        candidates: [{ content: { parts: [{ text: 'Você está em X -1596, Y 70, Z -1485 no Overworld!' }] } }],
      }),
    };
  };

  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'yc-ingame-ai-'));
  try {
    // Valida leitura de world/level.dat (NBT com seed BigInt e SpawnX/Y/Z)
    const lvChunks = [];
    const pushStr = (s) => {
      const b = Buffer.from(s, 'utf8');
      const l = Buffer.alloc(2);
      l.writeUInt16BE(b.length, 0);
      lvChunks.push(l, b);
    };
    lvChunks.push(Buffer.from([10])); pushStr('');
    lvChunks.push(Buffer.from([8])); pushStr('LevelName'); pushStr('YacaWorld');
    lvChunks.push(Buffer.from([3])); pushStr('SpawnX'); const sx = Buffer.alloc(4); sx.writeInt32BE(-16, 0); lvChunks.push(sx);
    lvChunks.push(Buffer.from([3])); pushStr('SpawnY'); const sy = Buffer.alloc(4); sy.writeInt32BE(83, 0); lvChunks.push(sy);
    lvChunks.push(Buffer.from([3])); pushStr('SpawnZ'); const sz = Buffer.alloc(4); sz.writeInt32BE(16, 0); lvChunks.push(sz);
    lvChunks.push(Buffer.from([4])); pushStr('RandomSeed'); const sd = Buffer.alloc(8); sd.writeBigInt64BE(-3052998425174464123n, 0); lvChunks.push(sd);
    lvChunks.push(Buffer.from([0]));
    fs.mkdirSync(path.join(tmpRoot, 'world'), { recursive: true });
    fs.writeFileSync(path.join(tmpRoot, 'world/level.dat'), zlib.gzipSync(Buffer.concat(lvChunks)));

    const reader = createPlayerDataReader(tmpRoot);
    const worldInfo = reader.getWorldOverview();
    assert.equal(worldInfo.levelName, 'YacaWorld');
    assert.deepEqual(worldInfo.spawn, { x: -16, y: 83, z: 16, dimension: 'overworld' });
    assert.equal(worldInfo.seed, '-3052998425174464123');

    const ai = createAiAssistant({
      configFile: path.join(tmpRoot, '.ai.json'),
      envApiKey: 'AIzaSyTestFakeKeyForUnitTest12345',
      fetchImpl: mockFetch,
      handlers: {},
    });
    const res = await ai.chatInGame({
      player: 'Nycolazs',
      question: 'onde eu to?',
      worldContext: {
        world: worldInfo,
        askingPlayer: { name: 'Nycolazs', dimension: 'overworld', pos: { x: -1596, y: 70, z: -1485 } },
      },
    });
    assert.equal(res.ok, true);
    assert.match(res.reply, /-1596/);
    assert.equal(capturedBody.tools, undefined);
    assert.match(capturedBody.systemInstruction.parts[0].text, /-1596/);
    assert.match(capturedBody.systemInstruction.parts[0].text, /YacaWorld/);
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test('Crossplay Sync (Java <-> Bedrock): bloqueio simultâneo e espelhamento completo de .dat/stats/advancements', async () => {
  assert.equal(normalizeCrossplayKey('Nycolazs'), 'nycolazs');
  assert.equal(normalizeCrossplayKey('.Nycolazs'), 'nycolazs');
  assert.deepEqual(parseJoinLeaveLine('15:51:28  INFO Nycolazs joined the game'), { type: 'join', player: 'Nycolazs' });
  assert.deepEqual(parseJoinLeaveLine('15:52:01  INFO .Nycolazs left the game'), { type: 'leave', player: '.Nycolazs' });

  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'yc-crossplay-'));
  const javaUuid = computeOfflineJavaUuid('Nycolazs');
  const bedrockUuid = '06eaeacf-306a-3dff-ab87-b6042cfcc3e1';

  fs.mkdirSync(path.join(tmpRoot, 'data'), { recursive: true });
  fs.mkdirSync(path.join(tmpRoot, 'world/players/data'), { recursive: true });
  fs.mkdirSync(path.join(tmpRoot, 'world/players/stats'), { recursive: true });
  fs.mkdirSync(path.join(tmpRoot, 'world/players/advancements'), { recursive: true });

  fs.writeFileSync(
    path.join(tmpRoot, 'data/usercache.json'),
    JSON.stringify([
      { uuid: javaUuid, name: 'Nycolazs' },
      { uuid: bedrockUuid, name: '.Nycolazs' },
    ])
  );
  fs.writeFileSync(path.join(tmpRoot, `world/players/data/${javaUuid}.dat`), 'JAVA_ITEMS_ARMOR_POS_V1');
  fs.writeFileSync(path.join(tmpRoot, `world/players/stats/${javaUuid}.json`), '{"play":100}');
  fs.writeFileSync(path.join(tmpRoot, `world/players/advancements/${javaUuid}.json`), '{"adv":1}');

  const sentCmds = [];
  try {
    const sync = createCrossplaySyncManager({
      dataDir: tmpRoot,
      docker: { isAvailable: () => false },
      containerName: 'yacacode-mc',
      sendMcCommand: async (c) => {
        sentCmds.push(c);
        return '';
      },
      saveSettleDelayMs: 0,
    });

    // 1. Nycolazs entra no Java
    const j1 = await sync._handleJoinForTest('Nycolazs');
    assert.equal(j1.action, 'joined');

    // 2. .Nycolazs tenta entrar no Bedrock ao mesmo tempo -> BLOQUEADO com kick!
    const j2 = await sync._handleJoinForTest('.Nycolazs');
    assert.equal(j2.action, 'blocked_duplicate');
    assert.match(sentCmds[0], /^kick \.Nycolazs /);

    // 3. Leave subsequente do .Nycolazs kickado NÃO sobrescreve nada
    fs.writeFileSync(path.join(tmpRoot, `world/players/data/${bedrockUuid}.dat`), 'OLD_BEDROCK_STALE');
    const lBlocked = await sync._handleLeaveForTest('.Nycolazs');
    assert.equal(lBlocked.action, 'leave_suppressed');
    assert.equal(fs.readFileSync(path.join(tmpRoot, `world/players/data/${javaUuid}.dat`), 'utf8'), 'JAVA_ITEMS_ARMOR_POS_V1');

    // 4. Nycolazs desconecta do Java -> espelha .dat/stats/advancements para o Bedrock!
    const lJava = await sync._handleLeaveForTest('Nycolazs');
    assert.equal(lJava.action, 'synced_on_leave');
    assert.equal(fs.readFileSync(path.join(tmpRoot, `world/players/data/${bedrockUuid}.dat`), 'utf8'), 'JAVA_ITEMS_ARMOR_POS_V1');
    assert.equal(fs.readFileSync(path.join(tmpRoot, `world/players/stats/${bedrockUuid}.json`), 'utf8'), '{"play":100}');

    // 5. Agora .Nycolazs entra no Bedrock (permitido!), joga e salva novo estado
    const jBedrock = await sync._handleJoinForTest('.Nycolazs');
    assert.equal(jBedrock.action, 'joined');

    // 6. Enquanto .Nycolazs está no Bedrock, Java tenta entrar -> BLOQUEADO!
    const jJavaDup = await sync._handleJoinForTest('Nycolazs');
    assert.equal(jJavaDup.action, 'blocked_duplicate');
    assert.match(sentCmds[1], /^kick Nycolazs /);

    // 7. .Nycolazs sai do Bedrock com novos itens -> espelha de volta para o Java!
    fs.writeFileSync(path.join(tmpRoot, `world/players/data/${bedrockUuid}.dat`), 'BEDROCK_DIAMONDS_POS_V2');
    const lBedrock = await sync._handleLeaveForTest('.Nycolazs');
    assert.equal(lBedrock.action, 'synced_on_leave');
    assert.equal(fs.readFileSync(path.join(tmpRoot, `world/players/data/${javaUuid}.dat`), 'utf8'), 'BEDROCK_DIAMONDS_POS_V2');
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test('AI History: persistência por usuário, isolamento, pendingAction sync e pub/sub', () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'yc-ai-history-'));
  const historyFile = path.join(tmpRoot, '.yacacode-ai-chats.json');
  try {
    const store = createAiHistoryStore({ historyFile, maxConversationsPerUser: 5, maxMessagesPerConversation: 20 });

    const nycEvents = [];
    const modEvents = [];
    const unsubNyc = store.subscribe('nycolas', (ev) => nycEvents.push(ev));
    const unsubMod = store.subscribe('moderador', (ev) => modEvents.push(ev));

    // Auto-cria conversa com título derivado da 1ª mensagem
    const u1 = store.appendUserMessage('nycolas', { text: 'Quem está online agora e qual o nível de XP?' });
    assert.ok(u1.conversation.id);
    assert.match(u1.conversation.title, /Quem está online/);
    assert.equal(nycEvents.length, 1);
    assert.equal(modEvents.length, 0); // Isolamento estrito entre usuários!

    // Salva resposta com ação pendente
    const m1 = store.appendModelMessage('nycolas', {
      conversationId: u1.conversation.id,
      text: 'Quer expulsar o jogador Grief?',
      model: 'gemini-3.5-flash-lite',
      actions: [{ label: 'list_players', status: 'ok', output: '1 online' }],
      pendingActions: [{ id: 'act_123', label: 'Expulsar Grief', command: 'kick Grief', reason: 'Destrutiva' }],
    });
    assert.equal(m1.conversation.messages.length, 2);
    assert.equal(nycEvents.length, 2);

    // Outro usuário não enxerga conversas de nycolas
    const modList = store.listConversations('moderador');
    assert.equal(modList.conversations.length, 0);
    assert.equal(store.getConversation('moderador', u1.conversation.id), null);

    // Resolver ação pendente atualiza histórico e dispara evento de sync
    const resolvedConv = store.resolvePendingActionInHistory('nycolas', {
      actionId: 'act_123',
      status: 'executed',
      output: 'Kicked Grief',
    });
    assert.ok(resolvedConv);
    assert.equal(resolvedConv.messages[1].pendingActions[0].resolution, 'executed');
    assert.equal(resolvedConv.messages[1].pendingActions[0].resolvedOutput, 'Kicked Grief');
    assert.equal(nycEvents.length, 3);
    assert.equal(nycEvents[2].type, 'pending_resolved');

    // Recarrega do disco (simula reinício do container)
    const reloaded = createAiHistoryStore({ historyFile });
    const listAfterRestart = reloaded.listConversations('nycolas');
    assert.equal(listAfterRestart.conversations.length, 1);
    assert.equal(listAfterRestart.activeConversation.messages.length, 2);
    assert.equal(listAfterRestart.activeConversation.messages[1].pendingActions[0].resolution, 'executed');

    // Criar nova conversa, renomear e excluir
    const c2 = reloaded.createConversation('nycolas', { title: 'Manutenção' });
    assert.equal(c2.conversations.length, 2);
    const renamed = reloaded.renameConversation('nycolas', c2.conversation.id, 'Backup Semanal');
    assert.equal(renamed.title, 'Backup Semanal');
    const del = reloaded.deleteConversation('nycolas', c2.conversation.id);
    assert.equal(del.conversations.length, 1);

    unsubNyc();
    unsubMod();
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test('Analytics & WhatsApp IA: relatórios de N dias, ranking consolidado Java+Bedrock, gatilho e notificações', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yc-wa-test-'));
  try {
    // 1) Prepara usercache + stats de Java e Bedrock para testar consolidação de ranking
    const javaUuid = '11111111-1111-3111-8111-111111111111';
    const bedrockUuid = '22222222-2222-3222-8222-222222222222';
    const otherUuid = '33333333-3333-3333-8333-333333333333';
    fs.mkdirSync(path.join(tmpDir, 'data'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, 'world/players/stats'), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, 'data/usercache.json'),
      JSON.stringify([
        { name: 'Nycolazs', uuid: javaUuid },
        { name: '.Nycolazs', uuid: bedrockUuid },
        { name: 'Joao', uuid: otherUuid },
      ])
    );
    fs.writeFileSync(
      path.join(tmpDir, `world/players/stats/${javaUuid}.json`),
      JSON.stringify({ stats: { 'minecraft:custom': { 'minecraft:deaths': 12, 'minecraft:play_time': 72000, 'minecraft:mob_kills': 50 } } })
    );
    fs.writeFileSync(
      path.join(tmpDir, `world/players/stats/${bedrockUuid}.json`),
      JSON.stringify({ stats: { 'minecraft:custom': { 'minecraft:deaths': 12, 'minecraft:play_time': 72000, 'minecraft:mob_kills': 50 } } })
    );
    fs.writeFileSync(
      path.join(tmpDir, `world/players/stats/${otherUuid}.json`),
      JSON.stringify({ stats: { 'minecraft:custom': { 'minecraft:deaths': 25, 'minecraft:play_time': 36000, 'minecraft:mob_kills': 10 } } })
    );

    const analytics = createAnalyticsManager({ dataDir: tmpDir });
    const now = Date.now();
    analytics.recordSample({ online: true, players: 3, cpu: 12.5, ram: 34.0, temp: 46.2, ts: now - 3600_000 });
    analytics.recordSample({ online: true, players: 5, cpu: 22.5, ram: 38.0, temp: 48.8, ts: now - 1800_000 });
    analytics.recordPlayerEvent({ name: 'Nycolazs', event: 'join', ts: now - 1200_000 });
    analytics.recordPlayerEvent({ name: 'Nycolazs', event: 'leave', ts: now - 600_000 });
    analytics.recordBackupEvent({ ok: true, fileName: 'yacacode-world.tar.gz', sizeBytes: 150 * 1024 * 1024, ts: now - 300_000 });

    const report = analytics.getReport(7);
    assert.equal(report.periodDays, 7);
    assert.equal(report.server.uptimePercent, 100);
    assert.equal(report.players.peakOnline, 5);
    assert.equal(report.players.uniquePlayersCount, 1);
    assert.equal(report.backups.succeeded, 1);

    const reader = createPlayerDataReader(tmpDir);
    const deathsRanking = analytics.getRankings(reader, ['Nycolazs'], 'deaths');
    assert.equal(deathsRanking.ranking.length, 2); // Nycolazs + .Nycolazs consolidados em 1!
    assert.equal(deathsRanking.ranking[0].name, 'Joao');
    assert.equal(deathsRanking.ranking[0].value, 25);
    assert.equal(deathsRanking.ranking[1].name, 'Nycolazs');
    assert.equal(deathsRanking.ranking[1].value, 12);

    // 2) Helpers de gatilho e telefone
    assert.equal(isBotCalledInGroup('Jorge, quem morreu mais?', 'Jorge'), true);
    assert.equal(isBotCalledInGroup('e ai galera bora jogar', 'Jorge'), false);
    assert.equal(isBotCalledInGroup('qual o status?', 'Jorge', { isMentioningBot: true }), true);
    assert.deepEqual(normalizePhoneList('+55 (11) 99999-8888, 5585988887777'), ['5511999998888', '5585988887777']);

    // 3) WhatsApp Manager: Function Calling read-only + envio ao bridge mockado + notificação de backup
    const sentMessages = [];
    let geminiCalls = 0;
    const mockFetch = async (url, opts) => {
      if (String(url).includes('/send')) {
        const body = JSON.parse(opts.body);
        sentMessages.push(body);
        return { ok: true, status: 200, json: async () => ({ ok: true, messageId: 'msg-1' }) };
      }
      if (String(url).includes('generativelanguage.googleapis.com')) {
        geminiCalls += 1;
        if (geminiCalls === 1) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              candidates: [
                {
                  content: {
                    parts: [{ functionCall: { name: 'get_player_rankings', args: { metric: 'deaths' } } }],
                  },
                },
              ],
            }),
          };
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({
            candidates: [
              {
                content: {
                  parts: [{ text: '💀 Quem morreu mais foi *Joao* com 25 mortes, seguido de *Nycolazs* (12).' }],
                },
              },
            ],
          }),
        };
      }
      return { ok: true, status: 200, json: async () => ({ state: 'connected' }) };
    };

    const wa = createWhatsAppManager({
      dataDir: tmpDir,
      serviceUrl: 'http://whatsapp:3001',
      internalToken: 'secret',
      getGeminiConfig: () => ({ apiKey: 'test-key', model: 'gemini-3.5-flash-lite' }),
      toolHandlers: {
        get_player_rankings: async ({ metric }) => analytics.getRankings(reader, ['Nycolazs'], metric),
      },
      fetchImpl: mockFetch,
    });

    wa.updateConfig({
      enabled: true,
      botName: 'Jorge',
      groupJid: '120363000000@g.us',
      groupName: 'Grupo Minecraft',
      respondInGroup: true,
      notifyBackup: true,
    });

    // Mensagem no grupo SEM chamar Jorge -> ignorada
    const ignored = await wa.handleIncomingMessage({
      messageId: 'm1',
      chatJid: '120363000000@g.us',
      isGroup: true,
      senderPhone: '5511999998888',
      pushName: 'Nycolas',
      text: 'oi pessoal',
    });
    assert.equal(ignored.handled, false);
    assert.equal(ignored.reason, 'not_called');

    // Mensagem no grupo chamando Jorge -> aciona tool read-only e responde no grupo
    const handled = await wa.handleIncomingMessage({
      messageId: 'm2',
      chatJid: '120363000000@g.us',
      isGroup: true,
      senderPhone: '5511999998888',
      pushName: 'Nycolas',
      text: 'Jorge, qual jogador morreu mais?',
    });
    assert.equal(handled.handled, true);
    assert.equal(sentMessages.length, 1);
    assert.equal(sentMessages[0].jid, '120363000000@g.us');
    assert.match(sentMessages[0].text, /Joao/);

    // Notificação automática de backup concluído
    const notified = await wa.notifyBackupResult({
      ok: true,
      fileName: 'yacacode-world-2026.tar.gz',
      sizeBytes: 180 * 1024 * 1024,
      prunedCount: 1,
    });
    assert.equal(notified, true);
    assert.equal(sentMessages.length, 2);
    assert.match(sentMessages[1].text, /Backup concluído/);

    analytics.stop();
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
