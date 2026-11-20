import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { hasRole } from './auth.js';

// ============================================================================
// YacaCode Google Drive Backup Manager — REST API v3 Nativa (Zero Dependências)
// ============================================================================
// - OAuth 2.0 Web Flow com escopo restrito (drive.file: só acessa arquivos/pastas
//   criados pelo próprio painel — máxima privacidade no Google Drive pessoal).
// - Upload resumable em chunks de 4 MB (streaming do disco: baixo consumo de RAM
//   no Orange Pi 4GB mesmo para mundos grandes).
// - Rotação automática (prune) e agendador 24/7 configurável pelo painel.
// ============================================================================

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const DRIVE_API_BASE = 'https://www.googleapis.com/drive/v3';
const DRIVE_UPLOAD_BASE = 'https://www.googleapis.com/upload/drive/v3';
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';

const UPLOAD_CHUNK_BYTES = 4 * 1024 * 1024; // 4 MiB (múltiplo de 256 KiB exigido pelo Google)
const OAUTH_STATE_TTL_MS = 15 * 60 * 1000;
const SCHEDULER_TICK_MS = 5 * 60 * 1000;

const DEFAULT_SETTINGS = {
  enabled: false,
  folderName: 'YacaCode Minecraft Backups',
  folderId: '',
  scheduleHours: 24, // 0 = somente manual; 6, 12, 24, 72
  maxBackups: 10,
  autoUploadOnManual: true,
  skipIfNoActivity: true,
};

function maskSecret(val) {
  const s = String(val || '').trim();
  if (!s) return '';
  if (s.length <= 10) return `${s.slice(0, 2)}••••${s.slice(-2)}`;
  return `${s.slice(0, 6)}••••••${s.slice(-4)}`;
}

function sanitizeFolderName(name) {
  const clean = String(name || '')
    .replace(/[\r\n\0/\\]/g, ' ')
    .trim()
    .slice(0, 80);
  return clean || DEFAULT_SETTINGS.folderName;
}

function escapeDriveQueryValue(str) {
  return String(str || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

export function createGoogleDriveBackupManager({
  configFile,
  sessionSecret,
  panelDomain = 'painel.yacacode.com',
  envClientId = '',
  envClientSecret = '',
  fetchImpl = globalThis.fetch,
  createLocalBackup,
  getBackupFilePath,
  getWorldLastModifiedMs,
  chunkSizeBytes = UPLOAD_CHUNK_BYTES,
}) {
  const hmacKey = sessionSecret || crypto.randomBytes(32).toString('hex');
  let cachedToken = { accessToken: '', expiresAt: 0 };
  let syncInProgress = false;
  let schedulerTimer = null;
  let progress = {
    active: false,
    stage: 'idle', // 'idle' | 'compressing' | 'uploading' | 'pruning' | 'done' | 'error'
    percent: 0,
    message: '',
    fileName: null,
    uploadedBytes: 0,
    totalBytes: 0,
    speedBps: 0,
    startedAt: null,
    finishedAt: null,
    error: null,
  };

  function setProgress(patch) {
    progress = { ...progress, ...patch };
  }

  function getProgressSnapshot() {
    return { ...progress };
  }

  function loadConfig() {
    let raw = {};
    if (configFile && fs.existsSync(configFile)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(configFile, 'utf8'));
        if (parsed && typeof parsed === 'object') raw = parsed;
      } catch {
        raw = {};
      }
    }
    return {
      ...DEFAULT_SETTINGS,
      clientId: String(envClientId || '').trim(),
      clientSecret: String(envClientSecret || '').trim(),
      refreshToken: '',
      accountEmail: '',
      accountName: '',
      storageQuota: null,
      lastBackupAt: null,
      lastUploadFile: null,
      lastUploadSize: null,
      lastUploadStatus: null,
      lastError: null,
      updatedAt: null,
      ...raw,
      clientId: (typeof raw.clientId === 'string' && raw.clientId.trim()) || String(envClientId || '').trim(),
      clientSecret:
        (typeof raw.clientSecret === 'string' && raw.clientSecret.trim()) || String(envClientSecret || '').trim(),
    };
  }

  function saveConfig(next) {
    if (!configFile) return;
    fs.mkdirSync(path.dirname(configFile), { recursive: true });
    fs.writeFileSync(configFile, JSON.stringify(next, null, 2), { encoding: 'utf8', mode: 0o600 });
    try {
      fs.chmodSync(configFile, 0o600);
    } catch {
      // ignore
    }
  }

  function computeRedirectUri(req) {
    if (req) {
      const host = req.headers?.['x-forwarded-host'] || req.headers?.host;
      const xfProto = String(req.headers?.['x-forwarded-proto'] || '').toLowerCase();
      const cfVisitor = String(req.headers?.['cf-visitor'] || '');
      const isHttps =
        xfProto.includes('https') ||
        cfVisitor.includes('"https"') ||
        (host && !host.startsWith('127.0.0.1') && !host.startsWith('localhost') && !/^\d+\.\d+\.\d+\.\d+/.test(host));
      if (host) {
        return `${isHttps ? 'https' : 'http'}://${host}/api/backups/gdrive/callback`;
      }
    }
    return `https://${panelDomain}/api/backups/gdrive/callback`;
  }

  function computeNextScheduledAt(cfg) {
    if (!cfg.enabled || !cfg.refreshToken || !cfg.scheduleHours || cfg.scheduleHours <= 0) {
      return null;
    }
    const baseMs = cfg.lastBackupAt ? new Date(cfg.lastBackupAt).getTime() : Date.now();
    const intervalMs = cfg.scheduleHours * 60 * 60 * 1000;
    const nextMs = baseMs + intervalMs;
    return new Date(Math.max(nextMs, Date.now() + 60 * 1000)).toISOString();
  }

  function getPublicStatus(userRole, req = null) {
    const cfg = loadConfig();
    const isAdmin = hasRole(userRole, 'admin');
    const connected = Boolean(cfg.clientId && cfg.clientSecret && cfg.refreshToken);
    const hasCredentials = Boolean(cfg.clientId && cfg.clientSecret);

    return {
      connected,
      hasCredentials,
      enabled: Boolean(cfg.enabled),
      syncInProgress,
      progress: getProgressSnapshot(),
      accountEmail: cfg.accountEmail || null,
      accountName: cfg.accountName || null,
      storageQuota: cfg.storageQuota || null,
      folderName: cfg.folderName,
      folderId: cfg.folderId || null,
      folderUrl: cfg.folderId ? `https://drive.google.com/drive/folders/${cfg.folderId}` : null,
      scheduleHours: Number(cfg.scheduleHours) || 0,
      maxBackups: Number(cfg.maxBackups) || 10,
      autoUploadOnManual: cfg.autoUploadOnManual !== false,
      skipIfNoActivity: cfg.skipIfNoActivity !== false,
      lastBackupAt: cfg.lastBackupAt || null,
      lastUploadFile: cfg.lastUploadFile || null,
      lastUploadSize: cfg.lastUploadSize || null,
      lastUploadStatus: cfg.lastUploadStatus || null,
      lastError: cfg.lastError || null,
      nextScheduledAt: computeNextScheduledAt(cfg),
      updatedAt: cfg.updatedAt || null,
      redirectUri: computeRedirectUri(req),
      clientId: isAdmin ? cfg.clientId || '' : undefined,
      hasClientSecret: isAdmin ? Boolean(cfg.clientSecret) : undefined,
      maskedClientSecret: isAdmin ? maskSecret(cfg.clientSecret) : undefined,
      canConfigure: isAdmin,
    };
  }

  function updateConfig(updates = {}) {
    const current = loadConfig();
    const next = { ...current };

    // Suporte a importar direto o JSON baixado do Google Cloud Console (client_secret_*.json)
    if (typeof updates.credentialsJson === 'string' && updates.credentialsJson.trim()) {
      let parsed;
      try {
        parsed = JSON.parse(updates.credentialsJson);
      } catch {
        throw Object.assign(new Error('O arquivo/texto colado não é um JSON válido do Google Cloud.'), { status: 400 });
      }
      const root = parsed.web || parsed.installed || parsed;
      if (!root?.client_id || !root?.client_secret) {
        throw Object.assign(
          new Error('JSON do Google inválido: não foram encontrados "client_id" e "client_secret".'),
          { status: 400 }
        );
      }
      updates = {
        ...updates,
        clientId: String(root.client_id),
        clientSecret: String(root.client_secret),
      };
    }

    if (typeof updates.clientId === 'string') {
      const cleanId = updates.clientId.trim();
      if (cleanId && !/^[a-zA-Z0-9._-]{10,200}$/.test(cleanId)) {
        throw Object.assign(new Error('Google OAuth Client ID inválido.'), { status: 400 });
      }
      if (cleanId !== current.clientId) {
        cachedToken = { accessToken: '', expiresAt: 0 };
      }
      next.clientId = cleanId;
    }

    if (typeof updates.clientSecret === 'string' && updates.clientSecret.trim()) {
      const cleanSecret = updates.clientSecret.trim();
      if (cleanSecret.length < 8 || /\s/.test(cleanSecret)) {
        throw Object.assign(new Error('Google OAuth Client Secret inválido.'), { status: 400 });
      }
      next.clientSecret = cleanSecret;
      cachedToken = { accessToken: '', expiresAt: 0 };
    }

    if (typeof updates.refreshToken === 'string' && updates.refreshToken.trim()) {
      const cleanRt = updates.refreshToken.trim();
      if (cleanRt.length < 16 || /\s/.test(cleanRt)) {
        throw Object.assign(new Error('Refresh Token inválido.'), { status: 400 });
      }
      next.refreshToken = cleanRt;
      cachedToken = { accessToken: '', expiresAt: 0 };
    }

    if (updates.folderName !== undefined) {
      const cleanName = sanitizeFolderName(updates.folderName);
      if (cleanName !== current.folderName && !updates.folderId) {
        // Permite recriar/localizar a nova pasta na próxima sincronização
        next.folderId = '';
      }
      next.folderName = cleanName;
    }

    if (typeof updates.folderId === 'string') {
      const cleanFid = updates.folderId.trim();
      if (cleanFid && !/^[a-zA-Z0-9_-]{8,120}$/.test(cleanFid)) {
        throw Object.assign(new Error('ID da pasta do Google Drive inválido.'), { status: 400 });
      }
      next.folderId = cleanFid;
    }

    if (updates.enabled !== undefined) {
      next.enabled = Boolean(updates.enabled);
    }

    if (updates.scheduleHours !== undefined) {
      const hours = Number(updates.scheduleHours);
      if (!Number.isFinite(hours) || hours < 0 || hours > 720) {
        throw Object.assign(new Error('Intervalo de agendamento inválido (0 a 720 horas).'), { status: 400 });
      }
      next.scheduleHours = Math.round(hours);
    }

    if (updates.maxBackups !== undefined) {
      const maxB = Number(updates.maxBackups);
      if (!Number.isFinite(maxB) || maxB < 1 || maxB > 100) {
        throw Object.assign(new Error('Retenção no Google Drive deve ser entre 1 e 100 backups.'), { status: 400 });
      }
      next.maxBackups = Math.round(maxB);
    }

    if (updates.autoUploadOnManual !== undefined) {
      next.autoUploadOnManual = Boolean(updates.autoUploadOnManual);
    }

    if (updates.skipIfNoActivity !== undefined) {
      next.skipIfNoActivity = Boolean(updates.skipIfNoActivity);
    }

    next.updatedAt = new Date().toISOString();
    saveConfig(next);
    return getPublicStatus('admin');
  }

  function disconnect({ clearCredentials = false } = {}) {
    const current = loadConfig();
    const next = {
      ...current,
      refreshToken: '',
      accountEmail: '',
      accountName: '',
      storageQuota: null,
      enabled: false,
      lastError: null,
      updatedAt: new Date().toISOString(),
    };
    if (clearCredentials) {
      next.clientId = '';
      next.clientSecret = '';
      next.folderId = '';
    }
    cachedToken = { accessToken: '', expiresAt: 0 };
    saveConfig(next);
    return getPublicStatus('admin');
  }

  function signOAuthState(username, redirectUri) {
    const payload = {
      u: String(username || '').toLowerCase(),
      r: redirectUri,
      exp: Date.now() + OAUTH_STATE_TTL_MS,
      n: crypto.randomBytes(8).toString('hex'),
    };
    const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const sig = crypto.createHmac('sha256', hmacKey).update(encoded).digest('base64url');
    return `${encoded}.${sig}`;
  }

  function verifyOAuthState(stateToken, expectedUsername) {
    if (!stateToken || typeof stateToken !== 'string') return null;
    const dot = stateToken.indexOf('.');
    if (dot <= 0) return null;
    const encoded = stateToken.slice(0, dot);
    const sig = stateToken.slice(dot + 1);
    const expectedSig = crypto.createHmac('sha256', hmacKey).update(encoded).digest('base64url');
    const a = Buffer.from(sig);
    const b = Buffer.from(expectedSig);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    try {
      const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
      if (!payload || Date.now() > payload.exp) return null;
      if (expectedUsername && payload.u !== String(expectedUsername).toLowerCase()) return null;
      return payload;
    } catch {
      return null;
    }
  }

  function buildAuthUrl({ req, username }) {
    const cfg = loadConfig();
    if (!cfg.clientId || !cfg.clientSecret) {
      throw Object.assign(
        new Error('Salve primeiro o Client ID e o Client Secret do Google OAuth antes de conectar.'),
        { status: 400 }
      );
    }
    const redirectUri = computeRedirectUri(req);
    const state = signOAuthState(username, redirectUri);
    const params = new URLSearchParams({
      client_id: cfg.clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: DRIVE_SCOPE,
      access_type: 'offline',
      prompt: 'consent',
      include_granted_scopes: 'true',
      state,
    });
    return {
      url: `${GOOGLE_AUTH_URL}?${params.toString()}`,
      redirectUri,
    };
  }

  async function exchangeToken(paramsObj) {
    const body = new URLSearchParams(paramsObj).toString();
    const res = await fetchImpl(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const detail = data.error_description || data.error || `HTTP ${res.status}`;
      throw Object.assign(new Error(`Falha na autenticação Google OAuth: ${detail}`), { status: 400 });
    }
    return data;
  }

  async function getAccessToken(forceRefresh = false) {
    const cfg = loadConfig();
    if (!cfg.clientId || !cfg.clientSecret || !cfg.refreshToken) {
      throw Object.assign(new Error('Google Drive não está conectado.'), { status: 400 });
    }
    if (!forceRefresh && cachedToken.accessToken && Date.now() < cachedToken.expiresAt - 60000) {
      return cachedToken.accessToken;
    }
    const tokenData = await exchangeToken({
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      refresh_token: cfg.refreshToken,
      grant_type: 'refresh_token',
    });
    const ttlSec = Number(tokenData.expires_in) || 3500;
    cachedToken = {
      accessToken: tokenData.access_token,
      expiresAt: Date.now() + ttlSec * 1000,
    };
    return cachedToken.accessToken;
  }

  async function driveJson(urlPath, { method = 'GET', body = null, accessToken = null } = {}) {
    const token = accessToken || (await getAccessToken());
    const headers = { Authorization: `Bearer ${token}` };
    let payload = undefined;
    if (body !== null) {
      headers['Content-Type'] = 'application/json; charset=utf-8';
      payload = JSON.stringify(body);
    }
    const res = await fetchImpl(`${DRIVE_API_BASE}${urlPath}`, { method, headers, body: payload });
    if (res.status === 204) return { ok: true };
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = data?.error?.message || `Google Drive API HTTP ${res.status}`;
      throw Object.assign(new Error(`Google Drive: ${msg}`), { status: res.status === 404 ? 404 : 500 });
    }
    return data;
  }

  async function fetchAbout(accessToken) {
    const data = await driveJson('/about?fields=user(emailAddress,displayName),storageQuota(limit,usage,usageInDrive)', {
      accessToken,
    });
    const quota = data.storageQuota
      ? {
          limitBytes: Number(data.storageQuota.limit) || 0,
          usageBytes: Number(data.storageQuota.usage) || 0,
          usageInDriveBytes: Number(data.storageQuota.usageInDrive) || 0,
        }
      : null;
    return {
      email: data.user?.emailAddress || '',
      displayName: data.user?.displayName || '',
      storageQuota: quota,
    };
  }

  async function ensureFolder(accessToken = null) {
    const token = accessToken || (await getAccessToken());
    const cfg = loadConfig();

    if (cfg.folderId) {
      try {
        const meta = await driveJson(`/files/${encodeURIComponent(cfg.folderId)}?fields=id,name,trashed,mimeType`, {
          accessToken: token,
        });
        if (meta && !meta.trashed && meta.mimeType === 'application/vnd.google-apps.folder') {
          return meta.id;
        }
      } catch {
        // Pasta antiga não existe mais -> cria novamente abaixo
      }
    }

    const escapedName = escapeDriveQueryValue(cfg.folderName);
    const q = `mimeType='application/vnd.google-apps.folder' and name='${escapedName}' and trashed=false`;
    const search = await driveJson(`/files?q=${encodeURIComponent(q)}&fields=files(id,name)&pageSize=5`, {
      accessToken: token,
    });

    let folderId = search.files?.[0]?.id || '';
    if (!folderId) {
      const created = await driveJson('/files?fields=id,name', {
        method: 'POST',
        accessToken: token,
        body: {
          name: cfg.folderName,
          mimeType: 'application/vnd.google-apps.folder',
        },
      });
      folderId = created.id;
    }

    cfg.folderId = folderId;
    cfg.updatedAt = new Date().toISOString();
    saveConfig(cfg);
    return folderId;
  }

  async function handleOAuthCallback({ code, state, expectedUsername }) {
    const verified = verifyOAuthState(state, expectedUsername);
    if (!verified) {
      throw Object.assign(new Error('Estado OAuth inválido ou expirado. Tente conectar novamente pelo painel.'), {
        status: 400,
      });
    }
    const cfg = loadConfig();
    if (!cfg.clientId || !cfg.clientSecret) {
      throw Object.assign(new Error('Credenciais OAuth não encontradas.'), { status: 400 });
    }

    const tokenData = await exchangeToken({
      code,
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      redirect_uri: verified.r,
      grant_type: 'authorization_code',
    });

    const refreshToken = tokenData.refresh_token || cfg.refreshToken;
    if (!refreshToken) {
      throw Object.assign(
        new Error('O Google não retornou um refresh_token. Remova o acesso anterior na sua conta Google e reconecte.'),
        { status: 400 }
      );
    }

    const accessToken = tokenData.access_token;
    cachedToken = {
      accessToken,
      expiresAt: Date.now() + (Number(tokenData.expires_in) || 3500) * 1000,
    };

    const about = await fetchAbout(accessToken);
    cfg.refreshToken = refreshToken;
    cfg.accountEmail = about.email;
    cfg.accountName = about.displayName;
    cfg.storageQuota = about.storageQuota;
    cfg.enabled = true;
    cfg.lastError = null;
    cfg.updatedAt = new Date().toISOString();
    saveConfig(cfg);

    await ensureFolder(accessToken);
    return getPublicStatus('admin');
  }

  async function testConnection() {
    const token = await getAccessToken(true);
    const about = await fetchAbout(token);
    const folderId = await ensureFolder(token);
    const cfg = loadConfig();
    cfg.accountEmail = about.email;
    cfg.accountName = about.displayName;
    cfg.storageQuota = about.storageQuota;
    cfg.folderId = folderId;
    cfg.lastError = null;
    cfg.updatedAt = new Date().toISOString();
    saveConfig(cfg);
    return { ok: true, status: getPublicStatus('admin') };
  }

  async function listRemoteBackups() {
    const cfg = loadConfig();
    if (!cfg.clientId || !cfg.clientSecret || !cfg.refreshToken) {
      return { connected: false, files: [] };
    }
    const token = await getAccessToken();
    const folderId = await ensureFolder(token);
    const q = `'${escapeDriveQueryValue(folderId)}' in parents and trashed=false and mimeType!='application/vnd.google-apps.folder'`;
    const res = await driveJson(
      `/files?q=${encodeURIComponent(q)}&orderBy=createdTime desc&pageSize=50&fields=files(id,name,size,createdTime,webViewLink)`,
      { accessToken: token }
    );
    const files = (res.files || []).map((f) => ({
      id: f.id,
      name: f.name,
      size: Number(f.size) || 0,
      createdTime: f.createdTime,
      webViewLink: f.webViewLink || `https://drive.google.com/file/d/${f.id}/view`,
    }));
    return { connected: true, folderId, files };
  }

  async function uploadFileResumable(localPath, fileName, onChunkProgress = null) {
    const st = fs.statSync(localPath);
    const totalBytes = st.size;
    if (totalBytes <= 0) {
      throw new Error('Arquivo de backup vazio.');
    }

    const token = await getAccessToken();
    const folderId = await ensureFolder(token);
    const mimeType = fileName.endsWith('.zip') ? 'application/zip' : 'application/gzip';

    // 1. Inicia sessão Resumable Upload
    const initRes = await fetchImpl(
      `${DRIVE_UPLOAD_BASE}/files?uploadType=resumable&fields=id,name,size,createdTime,webViewLink`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json; charset=utf-8',
          'X-Upload-Content-Type': mimeType,
          'X-Upload-Content-Length': String(totalBytes),
        },
        body: JSON.stringify({
          name: fileName,
          parents: [folderId],
        }),
      }
    );

    if (!initRes.ok) {
      const errJson = await initRes.json().catch(() => ({}));
      throw new Error(`Falha ao iniciar upload no Google Drive: ${errJson?.error?.message || `HTTP ${initRes.status}`}`);
    }

    const uploadUrl = initRes.headers.get('location');
    if (!uploadUrl) {
      throw new Error('Google Drive não retornou URL de sessão resumable.');
    }

    // 2. Envia o arquivo em chunks sequenciais de baixo consumo de RAM
    const fd = fs.openSync(localPath, 'r');
    const step = Math.max(256 * 1024, Math.floor(chunkSizeBytes / (256 * 1024)) * 256 * 1024);
    let offset = 0;
    let uploadedFile = null;
    const uploadStartMs = Date.now();
    onChunkProgress?.({ uploadedBytes: 0, totalBytes, speedBps: 0 });

    try {
      while (offset < totalBytes) {
        const len = Math.min(step, totalBytes - offset);
        const buf = Buffer.allocUnsafe(len);
        const bytesRead = fs.readSync(fd, buf, 0, len, offset);
        if (bytesRead <= 0) break;

        const slice = bytesRead === len ? buf : buf.subarray(0, bytesRead);
        const end = offset + bytesRead - 1;
        const putRes = await fetchImpl(uploadUrl, {
          method: 'PUT',
          headers: {
            'Content-Type': mimeType,
            'Content-Length': String(bytesRead),
            'Content-Range': `bytes ${offset}-${end}/${totalBytes}`,
          },
          body: slice,
        });

        if (putRes.status === 200 || putRes.status === 201) {
          uploadedFile = await putRes.json().catch(() => ({ name: fileName, size: totalBytes }));
          offset += bytesRead;
          const elapsedSec = Math.max(0.1, (Date.now() - uploadStartMs) / 1000);
          onChunkProgress?.({ uploadedBytes: offset, totalBytes, speedBps: Math.round(offset / elapsedSec) });
          break;
        }
        if (putRes.status === 308) {
          offset += bytesRead;
          const elapsedSec = Math.max(0.1, (Date.now() - uploadStartMs) / 1000);
          onChunkProgress?.({ uploadedBytes: offset, totalBytes, speedBps: Math.round(offset / elapsedSec) });
          continue;
        }
        const errData = await putRes.json().catch(() => ({}));
        throw new Error(`Erro durante upload (HTTP ${putRes.status}): ${errData?.error?.message || 'falha no chunk'}`);
      }
    } finally {
      fs.closeSync(fd);
    }

    if (!uploadedFile) {
      throw new Error('Upload resumable finalizou sem confirmação do Google Drive.');
    }

    return {
      id: uploadedFile.id,
      name: uploadedFile.name || fileName,
      size: Number(uploadedFile.size) || totalBytes,
      createdTime: uploadedFile.createdTime || new Date().toISOString(),
      webViewLink: uploadedFile.webViewLink || (uploadedFile.id ? `https://drive.google.com/file/d/${uploadedFile.id}/view` : null),
    };
  }

  async function pruneRemoteBackups(maxBackupsOverride = null) {
    const cfg = loadConfig();
    const limit = Math.max(1, Number(maxBackupsOverride ?? cfg.maxBackups) || 10);
    const { files } = await listRemoteBackups();
    if (files.length <= limit) return { deleted: 0 };

    const toDelete = files.slice(limit);
    const token = await getAccessToken();
    let deleted = 0;
    for (const f of toDelete) {
      try {
        await driveJson(`/files/${encodeURIComponent(f.id)}`, { method: 'DELETE', accessToken: token });
        deleted += 1;
      } catch {
        // continua removendo os demais
      }
    }
    return { deleted };
  }

  async function deleteRemoteBackup(fileId) {
    const cleanId = String(fileId || '').trim();
    if (!/^[a-zA-Z0-9_-]{8,120}$/.test(cleanId)) {
      throw Object.assign(new Error('ID de arquivo do Google Drive inválido.'), { status: 400 });
    }
    await driveJson(`/files/${encodeURIComponent(cleanId)}`, { method: 'DELETE' });
    return { ok: true, id: cleanId };
  }

  async function syncNow({ fileName = null, createNew = false } = {}) {
    if (syncInProgress) {
      throw Object.assign(new Error('Já existe um backup/envio para o Google Drive em andamento.'), { status: 409 });
    }
    const cfg = loadConfig();
    if (!cfg.clientId || !cfg.clientSecret || !cfg.refreshToken) {
      throw Object.assign(new Error('Conecte sua conta Google Drive primeiro na aba Backups.'), { status: 400 });
    }

    syncInProgress = true;
    let tempFileToCleanup = null;
    const startedAt = new Date().toISOString();
    setProgress({
      active: true,
      stage: createNew ? 'compressing' : 'uploading',
      percent: 2,
      message: createNew ? 'Compactando o mundo em arquivo temporário...' : 'Preparando envio para o Google Drive...',
      fileName: fileName || null,
      uploadedBytes: 0,
      totalBytes: 0,
      speedBps: 0,
      startedAt,
      finishedAt: null,
      error: null,
    });

    try {
      let targetPath = '';
      let targetName = '';

      if (fileName) {
        const resolved = getBackupFilePath(fileName);
        targetPath = resolved.fullPath;
        targetName = resolved.safeName;
      } else if (createNew) {
        const created = await createLocalBackup({
          onProgress: ({ fileName: fn, currentBytes, estimatedTotalBytes }) => {
            const ratio = estimatedTotalBytes > 0 ? Math.min(1, currentBytes / estimatedTotalBytes) : 0;
            const pct = Math.max(3, Math.min(28, Math.round(3 + ratio * 25)));
            setProgress({
              stage: 'compressing',
              percent: pct,
              fileName: fn || null,
              uploadedBytes: currentBytes || 0,
              totalBytes: estimatedTotalBytes || 0,
              message: `Compactando mundo (${(currentBytes / (1024 * 1024)).toFixed(1)} MB)...`,
            });
          },
        });
        targetPath = created.fullPath;
        targetName = created.name;
        if (created.isTemporary) {
          tempFileToCleanup = created.fullPath;
        }
      } else {
        throw Object.assign(new Error('Informe um arquivo de backup ou solicite criação de novo backup.'), {
          status: 400,
        });
      }

      const basePct = createNew ? 30 : 5;
      const spanPct = createNew ? 65 : 90;
      setProgress({
        stage: 'uploading',
        percent: basePct,
        fileName: targetName,
        message: `Iniciando envio de ${targetName} para o Google Drive...`,
      });

      const uploaded = await uploadFileResumable(targetPath, targetName, ({ uploadedBytes, totalBytes, speedBps }) => {
        const ratio = totalBytes > 0 ? Math.min(1, uploadedBytes / totalBytes) : 0;
        const pct = Math.min(95, Math.round(basePct + ratio * spanPct));
        const upMb = (uploadedBytes / (1024 * 1024)).toFixed(1);
        const totMb = (totalBytes / (1024 * 1024)).toFixed(1);
        setProgress({
          stage: 'uploading',
          percent: pct,
          fileName: targetName,
          uploadedBytes,
          totalBytes,
          speedBps,
          message: `Enviando para o Google Drive: ${upMb} MB / ${totMb} MB`,
        });
      });

      setProgress({
        stage: 'pruning',
        percent: 97,
        fileName: uploaded.name,
        uploadedBytes: uploaded.size,
        totalBytes: uploaded.size,
        message: 'Aplicando retenção automática na nuvem...',
      });
      const pruned = await pruneRemoteBackups(cfg.maxBackups);

      // Atualiza cota após upload
      let quota = cfg.storageQuota;
      try {
        const about = await fetchAbout(await getAccessToken());
        quota = about.storageQuota || quota;
      } catch {
        // opcional
      }

      const finishedAt = new Date().toISOString();
      const fresh = loadConfig();
      fresh.lastBackupAt = finishedAt;
      fresh.lastUploadFile = uploaded.name;
      fresh.lastUploadSize = uploaded.size;
      fresh.lastUploadStatus = 'ok';
      fresh.lastError = null;
      fresh.storageQuota = quota;
      fresh.updatedAt = finishedAt;
      saveConfig(fresh);

      setProgress({
        active: false,
        stage: 'done',
        percent: 100,
        fileName: uploaded.name,
        uploadedBytes: uploaded.size,
        totalBytes: uploaded.size,
        speedBps: 0,
        finishedAt,
        message: `Backup "${uploaded.name}" concluído no Google Drive!`,
        error: null,
      });

      return {
        ok: true,
        uploaded,
        prunedCount: pruned.deleted,
        status: getPublicStatus('admin'),
      };
    } catch (err) {
      const finishedAt = new Date().toISOString();
      const fresh = loadConfig();
      fresh.lastUploadStatus = 'error';
      fresh.lastError = err.message;
      fresh.updatedAt = finishedAt;
      saveConfig(fresh);
      setProgress({
        active: false,
        stage: 'error',
        finishedAt,
        message: `Falha no backup: ${err.message}`,
        error: err.message,
      });
      throw err;
    } finally {
      if (tempFileToCleanup) {
        try {
          if (fs.existsSync(tempFileToCleanup)) fs.unlinkSync(tempFileToCleanup);
        } catch {
          // ignore
        }
      }
      syncInProgress = false;
    }
  }

  function startSyncInBackground({ fileName = null, createNew = true } = {}) {
    const cfg = loadConfig();
    if (!cfg.clientId || !cfg.clientSecret || !cfg.refreshToken) {
      throw Object.assign(new Error('Conecte sua conta Google Drive primeiro na aba Backups.'), { status: 400 });
    }
    if (syncInProgress) {
      return {
        ok: true,
        started: false,
        alreadyRunning: true,
        progress: getProgressSnapshot(),
        status: getPublicStatus('admin'),
      };
    }
    // Inicia assincronamente (o erro já é gravado em progress/config dentro de syncNow)
    syncNow({ fileName, createNew }).catch((err) => {
      console.error(`[YacaCode Google Drive] Erro no backup em background: ${err.message}`);
    });
    return {
      ok: true,
      started: true,
      alreadyRunning: false,
      progress: getProgressSnapshot(),
      status: getPublicStatus('admin'),
    };
  }

  async function runScheduledTick() {
    if (syncInProgress) return;
    const cfg = loadConfig();
    if (!cfg.enabled || !cfg.refreshToken || !cfg.clientId || !cfg.clientSecret) return;
    if (!cfg.scheduleHours || cfg.scheduleHours <= 0) return;

    const intervalMs = cfg.scheduleHours * 60 * 60 * 1000;
    const lastMs = cfg.lastBackupAt ? new Date(cfg.lastBackupAt).getTime() : 0;
    if (lastMs && Date.now() - lastMs < intervalMs) return;

    // Se habilitado, pula backup automático caso o mundo não tenha mudado desde o último backup
    if (cfg.skipIfNoActivity && lastMs > 0 && typeof getWorldLastModifiedMs === 'function') {
      const worldMtime = getWorldLastModifiedMs();
      if (worldMtime > 0 && worldMtime <= lastMs) {
        return;
      }
    }

    try {
      console.log('[YacaCode Google Drive] Iniciando backup agendado para o Google Drive...');
      const res = await syncNow({ createNew: true });
      console.log(`[YacaCode Google Drive] Backup enviado: ${res.uploaded.name} (${res.uploaded.size} bytes)`);
    } catch (err) {
      console.error(`[YacaCode Google Drive] Falha no backup agendado: ${err.message}`);
    }
  }

  function startScheduler() {
    stopScheduler();
    schedulerTimer = setInterval(runScheduledTick, SCHEDULER_TICK_MS);
    schedulerTimer.unref();
  }

  function stopScheduler() {
    if (schedulerTimer) {
      clearInterval(schedulerTimer);
      schedulerTimer = null;
    }
  }

  return {
    getPublicStatus,
    updateConfig,
    disconnect,
    buildAuthUrl,
    handleOAuthCallback,
    testConnection,
    listRemoteBackups,
    uploadFileResumable,
    pruneRemoteBackups,
    deleteRemoteBackup,
    syncNow,
    startSyncInBackground,
    getProgress: getProgressSnapshot,
    startScheduler,
    stopScheduler,
  };
}
