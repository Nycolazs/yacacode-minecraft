import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import pino from 'pino';
import QRCode from 'qrcode';
import makeWASocket, {
  DisconnectReason,
  fetchLatestBaileysVersion,
  useMultiFileAuthState,
  Browsers,
} from '@whiskeysockets/baileys';

// ============================================================================
// YacaCode WhatsApp Bridge (Baileys leve, sem navegador)
// Rede interna Docker apenas — autenticado via X-Internal-Token
// ============================================================================

const PORT = Number(process.env.PORT || 3001);
const AUTH_DIR = process.env.AUTH_DIR || '/wa-auth';
const INTERNAL_TOKEN = String(process.env.WHATSAPP_INTERNAL_TOKEN || '').trim();
const PANEL_WEBHOOK_URL = String(
  process.env.PANEL_WEBHOOK_URL || 'http://panel:8080/api/internal/whatsapp/incoming'
).trim();

const logger = pino({ level: process.env.WA_LOG_LEVEL || 'warn' });

let sock = null;
let reconnectTimer = null;
let manualDisconnect = false;
let isConnecting = false;
const sentMessageIds = new Set(); // IDs enviados pelo próprio bot (detecção infalível de quote/reply)
const incomingMessagesCache = new Map(); // messageId -> { msg, ts } para responder dando quote

function rememberSentMessageId(id) {
  if (!id) return;
  sentMessageIds.add(id);
  if (sentMessageIds.size > 400) {
    const first = sentMessageIds.values().next().value;
    if (first) sentMessageIds.delete(first);
  }
}

function cacheIncomingMessage(id, msg) {
  if (!id || !msg) return;
  const now = Date.now();
  incomingMessagesCache.set(id, { msg, ts: now });
  if (incomingMessagesCache.size > 200) {
    for (const [k, v] of incomingMessagesCache.entries()) {
      if (now - v.ts > 10 * 60 * 1000) incomingMessagesCache.delete(k);
    }
  }
}

const statusState = {
  state: 'disconnected', // disconnected | connecting | qr | connected
  qrDataUrl: null,
  qrUpdatedAt: null,
  phone: null,
  jid: null,
  pushName: null,
  connectedAt: null,
  lastError: null,
};

function ensureAuthDir() {
  if (!fs.existsSync(AUTH_DIR)) {
    fs.mkdirSync(AUTH_DIR, { recursive: true });
  }
}

function clearAuthDir() {
  try {
    if (fs.existsSync(AUTH_DIR)) {
      for (const entry of fs.readdirSync(AUTH_DIR)) {
        fs.rmSync(path.join(AUTH_DIR, entry), { recursive: true, force: true });
      }
    }
  } catch (err) {
    console.error('[YacaCode WA] Erro ao limpar sessão:', err.message);
  }
}

function hasSavedSession() {
  try {
    return fs.existsSync(path.join(AUTH_DIR, 'creds.json'));
  } catch {
    return false;
  }
}

function extractMessageText(message) {
  if (!message || typeof message !== 'object') return '';
  const inner =
    message.ephemeralMessage?.message ||
    message.viewOnceMessage?.message ||
    message.viewOnceMessageV2?.message ||
    message.documentWithCaptionMessage?.message ||
    message;

  return String(
    inner.conversation ||
      inner.extendedTextMessage?.text ||
      inner.imageMessage?.caption ||
      inner.videoMessage?.caption ||
      inner.buttonsResponseMessage?.selectedDisplayText ||
      inner.listResponseMessage?.title ||
      ''
  ).trim();
}

function extractContextInfo(message) {
  if (!message || typeof message !== 'object') return null;
  const inner =
    message.ephemeralMessage?.message ||
    message.viewOnceMessage?.message ||
    message.viewOnceMessageV2?.message ||
    message;
  return (
    inner.extendedTextMessage?.contextInfo ||
    inner.imageMessage?.contextInfo ||
    inner.videoMessage?.contextInfo ||
    null
  );
}

function normalizePhoneFromJid(jid) {
  const raw = String(jid || '');
  const base = raw.split('@')[0] || '';
  return base.split(':')[0].replace(/\D/g, '');
}

async function forwardIncomingToPanel(payload) {
  if (!PANEL_WEBHOOK_URL) return;
  try {
    const headers = { 'Content-Type': 'application/json; charset=utf-8' };
    if (INTERNAL_TOKEN) {
      headers['X-Internal-Token'] = INTERNAL_TOKEN;
    }
    const res = await fetch(PANEL_WEBHOOK_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      console.warn(`[YacaCode WA] Webhook panel HTTP ${res.status}: ${txt.slice(0, 200)}`);
    }
  } catch (err) {
    console.warn(`[YacaCode WA] Falha ao encaminhar mensagem ao painel: ${err.message}`);
  }
}

async function startSocket() {
  if (isConnecting) return;
  if (sock && statusState.state === 'connected') return;

  isConnecting = true;
  manualDisconnect = false;
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  try {
    ensureAuthDir();
    statusState.state = 'connecting';
    statusState.lastError = null;

    const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
    let version;
    try {
      const latest = await fetchLatestBaileysVersion();
      version = latest.version;
    } catch {
      version = undefined;
    }

    const nextSock = makeWASocket({
      version,
      auth: state,
      logger,
      browser: Browsers.ubuntu('YacaCode Minecraft Panel'),
      printQRInTerminal: false,
      markOnlineOnConnect: false,
      syncFullHistory: false,
      generateHighQualityLinkPreview: false,
    });

    sock = nextSock;

    nextSock.ev.on('creds.update', saveCreds);

    nextSock.ev.on('connection.update', async (update) => {
      if (sock !== nextSock) return;
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        try {
          statusState.qrDataUrl = await QRCode.toDataURL(qr, {
            width: 280,
            margin: 2,
            color: { dark: '#0b0d09', light: '#ffffff' },
          });
          statusState.qrUpdatedAt = new Date().toISOString();
          statusState.state = 'qr';
          statusState.lastError = null;
          console.log('[YacaCode WA] QR Code pronto para leitura no painel.');
        } catch (err) {
          statusState.lastError = `Erro ao gerar QR: ${err.message}`;
        }
      }

      if (connection === 'open') {
        statusState.state = 'connected';
        statusState.qrDataUrl = null;
        statusState.qrUpdatedAt = null;
        statusState.jid = nextSock.user?.id || null;
        statusState.phone = normalizePhoneFromJid(nextSock.user?.id);
        statusState.pushName = nextSock.user?.name || null;
        statusState.connectedAt = new Date().toISOString();
        statusState.lastError = null;
        console.log(`[YacaCode WA] Conectado como ${statusState.phone || 'desconhecido'}`);
      } else if (connection === 'close') {
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        const loggedOut = statusCode === DisconnectReason.loggedOut;
        statusState.state = 'disconnected';
        statusState.qrDataUrl = null;
        statusState.connectedAt = null;

        if (loggedOut) {
          statusState.phone = null;
          statusState.jid = null;
          statusState.pushName = null;
          statusState.lastError = 'Sessão desconectada no celular. Gere um novo QR Code.';
          clearAuthDir();
          sock = null;
          return;
        }

        if (manualDisconnect) {
          sock = null;
          return;
        }

        statusState.lastError = lastDisconnect?.error?.message || `Conexão encerrada (código ${statusCode || '?'})`;
        sock = null;
        reconnectTimer = setTimeout(() => {
          reconnectTimer = null;
          startSocket().catch(() => {});
        }, 4000);
      }
    });

    nextSock.ev.on('messages.upsert', async ({ messages, type }) => {
      if (type !== 'notify' || !Array.isArray(messages)) return;
      const nowSec = Math.floor(Date.now() / 1000);
      const selfPhone = normalizePhoneFromJid(nextSock.user?.id);
      const selfLid = normalizePhoneFromJid(nextSock.user?.lid);

      for (const msg of messages) {
        try {
          if (!msg || !msg.message) continue;
          if (msg.key?.fromMe) {
            rememberSentMessageId(msg.key?.id);
            continue;
          }
          const remoteJid = String(msg.key?.remoteJid || '');
          if (!remoteJid || remoteJid === 'status@broadcast' || remoteJid.endsWith('@newsletter')) {
            continue;
          }

          // Ignora mensagens muito antigas (ex: sincronização de histórico ao reconectar)
          const msgTs = Number(msg.messageTimestamp || 0);
          if (msgTs > 0 && nowSec - msgTs > 90) continue;

          const text = extractMessageText(msg.message);
          if (!text) continue;

          const msgId = msg.key?.id || null;
          if (msgId) cacheIncomingMessage(msgId, msg);

          const isGroup = remoteJid.endsWith('@g.us');
          const senderJid = isGroup ? String(msg.key?.participant || '') : remoteJid;
          const senderPhone = normalizePhoneFromJid(senderJid);
          const ctx = extractContextInfo(msg.message);
          const mentionedJids = Array.isArray(ctx?.mentionedJid) ? ctx.mentionedJid : [];
          const isMentioningBot = mentionedJids.some((m) => {
            const norm = normalizePhoneFromJid(m);
            return (Boolean(selfPhone) && norm === selfPhone) || (Boolean(selfLid) && norm === selfLid);
          });

          const quotedStanzaId = ctx?.stanzaId || null;
          const quotedParticipant = normalizePhoneFromJid(ctx?.participant);
          const isReplyToBot =
            (Boolean(quotedStanzaId) && sentMessageIds.has(quotedStanzaId)) ||
            (Boolean(selfPhone) && Boolean(quotedParticipant) && quotedParticipant === selfPhone) ||
            (Boolean(selfLid) && Boolean(quotedParticipant) && quotedParticipant === selfLid);
          const quotedText = ctx?.quotedMessage ? extractMessageText(ctx.quotedMessage) : '';

          await forwardIncomingToPanel({
            messageId: msgId,
            chatJid: remoteJid,
            isGroup,
            senderJid,
            senderPhone,
            pushName: msg.pushName || senderPhone || 'Jogador',
            text,
            quotedText: quotedText || null,
            isMentioningBot,
            isReplyToBot,
            timestamp: msgTs ? new Date(msgTs * 1000).toISOString() : new Date().toISOString(),
          });
        } catch (err) {
          console.warn('[YacaCode WA] Erro ao processar mensagem recebida:', err.message);
        }
      }
    });
  } catch (err) {
    statusState.state = 'disconnected';
    statusState.lastError = err.message;
    console.error('[YacaCode WA] Falha ao iniciar socket:', err.message);
  } finally {
    isConnecting = false;
  }
}

async function disconnectSocket({ logout = false } = {}) {
  manualDisconnect = true;
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  const current = sock;
  sock = null;

  if (current) {
    try {
      if (logout) {
        await current.logout().catch(() => {});
      } else {
        current.end(new Error('Manual disconnect'));
      }
    } catch {
      // ignore
    }
  }

  if (logout) {
    clearAuthDir();
    statusState.phone = null;
    statusState.jid = null;
    statusState.pushName = null;
  }

  statusState.state = 'disconnected';
  statusState.qrDataUrl = null;
  statusState.qrUpdatedAt = null;
  statusState.connectedAt = null;
  statusState.lastError = null;
}

function readJsonBody(req, maxBytes = 64 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on('data', (chunk) => {
      total += chunk.length;
      if (total > maxBytes) {
        reject(Object.assign(new Error('Payload muito grande.'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(Object.assign(new Error('JSON inválido.'), { status: 400 }));
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

function isAuthorized(req) {
  if (!INTERNAL_TOKEN) return true;
  const provided = String(req.headers['x-internal-token'] || '').trim();
  return provided === INTERNAL_TOKEN;
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

    if (url.pathname === '/health' && req.method === 'GET') {
      return sendJson(res, 200, { ok: true, state: statusState.state });
    }

    if (!isAuthorized(req)) {
      return sendJson(res, 401, { error: 'Token interno inválido.' });
    }

    if (url.pathname === '/status' && req.method === 'GET') {
      return sendJson(res, 200, {
        ...statusState,
        hasSession: hasSavedSession(),
      });
    }

    if (url.pathname === '/connect' && req.method === 'POST') {
      if (statusState.state !== 'connected' && statusState.state !== 'qr') {
        startSocket().catch(() => {});
      }
      // Aguarda um instante para QR/status ficar disponível quando possível
      await new Promise((r) => setTimeout(r, 800));
      return sendJson(res, 200, {
        ok: true,
        ...statusState,
        hasSession: hasSavedSession(),
      });
    }

    if (url.pathname === '/disconnect' && req.method === 'POST') {
      const body = await readJsonBody(req).catch(() => ({}));
      await disconnectSocket({ logout: Boolean(body.logout) });
      return sendJson(res, 200, {
        ok: true,
        ...statusState,
        hasSession: hasSavedSession(),
      });
    }

    if (url.pathname === '/groups' && req.method === 'GET') {
      if (!sock || statusState.state !== 'connected') {
        return sendJson(res, 400, { error: 'WhatsApp não está conectado.' });
      }
      const rawGroups = await sock.groupFetchAllParticipating();
      const groups = Object.values(rawGroups || {})
        .map((g) => ({
          jid: g.id,
          subject: g.subject || g.id,
          participantsCount: Array.isArray(g.participants) ? g.participants.length : 0,
        }))
        .sort((a, b) => a.subject.localeCompare(b.subject, 'pt-BR'));
      return sendJson(res, 200, { groups });
    }

    if (url.pathname === '/send' && req.method === 'POST') {
      if (!sock || statusState.state !== 'connected') {
        return sendJson(res, 400, { error: 'WhatsApp não está conectado.' });
      }
      const body = await readJsonBody(req);
      const jid = String(body.jid || '').trim();
      const text = String(body.text || '').trim();
      const quotedId = String(body.quotedId || '').trim();
      if (!jid || !text) {
        return sendJson(res, 400, { error: 'Informe jid e text.' });
      }
      const sendOpts = {};
      if (quotedId && incomingMessagesCache.has(quotedId)) {
        sendOpts.quoted = incomingMessagesCache.get(quotedId).msg;
      }
      const sent = await sock.sendMessage(jid, { text }, sendOpts);
      rememberSentMessageId(sent?.key?.id);
      return sendJson(res, 200, {
        ok: true,
        messageId: sent?.key?.id || null,
      });
    }

    return sendJson(res, 404, { error: 'Rota não encontrada.' });
  } catch (err) {
    sendJson(res, err.status || 500, { error: err.message || 'Erro interno no bridge WhatsApp.' });
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[YacaCode WA] Bridge interno ativo na porta ${PORT}`);
  // Se já existe sessão salva, reconecta automaticamente no boot
  if (hasSavedSession()) {
    console.log('[YacaCode WA] Sessão salva detectada — reconectando automaticamente...');
    startSocket().catch(() => {});
  }
});

process.on('SIGTERM', async () => {
  await disconnectSocket({ logout: false });
  server.close(() => process.exit(0));
});
process.on('SIGINT', async () => {
  await disconnectSocket({ logout: false });
  server.close(() => process.exit(0));
});
