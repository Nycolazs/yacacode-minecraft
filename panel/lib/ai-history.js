import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';

// ============================================================================
// YacaCode AI Chat History Store — Persistência por Usuário + Sync em Tempo Real
// ============================================================================
// - Zero dependências externas (Node nativo + EventEmitter para SSE live sync).
// - Isolamento estrito por usuário (cada conta só lê/escreve suas próprias conversas).
// - Escrita atômica com permissão 0600 (proteção contra corrupção no SD do Orange Pi).
// ============================================================================

const DEFAULT_TITLE = 'Nova conversa';

function normalizeUserKey(username) {
  const clean = String(username || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, '');
  return clean || 'anonymous';
}

function nowTimeHHMM() {
  const d = new Date();
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

function deriveTitle(text) {
  const single = String(text || '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!single) return DEFAULT_TITLE;
  return single.length > 52 ? `${single.slice(0, 49).trimEnd()}…` : single;
}

function sanitizeTitle(raw) {
  const single = String(raw || '')
    .replace(/[\r\n\t\0]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 64);
  return single || DEFAULT_TITLE;
}

function sanitizeActions(actions) {
  if (!Array.isArray(actions)) return [];
  return actions.slice(0, 12).map((a) => ({
    label: String(a?.label || 'Ação').slice(0, 160),
    status: ['ok', 'denied', 'error'].includes(a?.status) ? a.status : 'ok',
    output: a?.output ? String(a.output).slice(0, 2000) : undefined,
  }));
}

function sanitizePendingActions(pendingActions) {
  if (!Array.isArray(pendingActions)) return [];
  return pendingActions.slice(0, 8).map((p) => ({
    id: String(p?.id || crypto.randomBytes(6).toString('hex')),
    type: p?.type ? String(p.type).slice(0, 48) : undefined,
    label: String(p?.label || 'Ação pendente').slice(0, 160),
    command: p?.command ? String(p.command).slice(0, 512) : undefined,
    reason: p?.reason ? String(p.reason).slice(0, 300) : undefined,
    expiresAt: typeof p?.expiresAt === 'number' ? p.expiresAt : undefined,
    resolution: p?.resolution || null,
    resolvedOutput: p?.resolvedOutput || p?.output || null,
  }));
}

function summarizeConversation(conv) {
  const lastMsg = conv.messages[conv.messages.length - 1];
  const rawPreview = lastMsg ? String(lastMsg.text || '').replace(/\s+/g, ' ').trim() : '';
  return {
    id: conv.id,
    title: conv.title,
    createdAt: conv.createdAt,
    updatedAt: conv.updatedAt,
    messageCount: conv.messages.length,
    preview: rawPreview.length > 90 ? `${rawPreview.slice(0, 87).trimEnd()}…` : rawPreview,
  };
}

function cloneConversation(conv) {
  if (!conv) return null;
  return {
    id: conv.id,
    title: conv.title,
    createdAt: conv.createdAt,
    updatedAt: conv.updatedAt,
    messages: conv.messages.map((m) => ({
      ...m,
      actions: Array.isArray(m.actions) ? m.actions.map((a) => ({ ...a })) : [],
      pendingActions: Array.isArray(m.pendingActions) ? m.pendingActions.map((p) => ({ ...p })) : [],
    })),
  };
}

export function createAiHistoryStore({
  historyFile,
  maxConversationsPerUser = 30,
  maxMessagesPerConversation = 120,
} = {}) {
  const emitter = new EventEmitter();
  emitter.setMaxListeners(100);

  let store = { version: 1, users: {} };

  function loadFromDisk() {
    if (!historyFile || !fs.existsSync(historyFile)) return;
    try {
      const parsed = JSON.parse(fs.readFileSync(historyFile, 'utf8'));
      if (parsed && typeof parsed === 'object' && parsed.users && typeof parsed.users === 'object') {
        store = { version: 1, users: parsed.users };
      }
    } catch {
      store = { version: 1, users: {} };
    }
  }

  function saveToDisk() {
    if (!historyFile) return;
    try {
      const dir = path.dirname(historyFile);
      fs.mkdirSync(dir, { recursive: true });
      const tmp = `${historyFile}.${process.pid}.${Date.now()}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(store, null, 2), { encoding: 'utf8', mode: 0o600 });
      fs.renameSync(tmp, historyFile);
      try {
        fs.chmodSync(historyFile, 0o600);
      } catch {
        // ignore chmod failures on non-POSIX filesystems
      }
    } catch {
      // keep in-memory state working even if disk save fails
    }
  }

  loadFromDisk();

  function getUserBucket(username) {
    const key = normalizeUserKey(username);
    if (!store.users[key] || typeof store.users[key] !== 'object') {
      store.users[key] = { activeConversationId: null, conversations: [] };
    }
    const bucket = store.users[key];
    if (!Array.isArray(bucket.conversations)) bucket.conversations = [];
    return { key, bucket };
  }

  function sortAndPrune(bucket) {
    bucket.conversations.sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
    if (bucket.conversations.length > maxConversationsPerUser) {
      bucket.conversations = bucket.conversations.slice(0, maxConversationsPerUser);
    }
    if (
      bucket.activeConversationId &&
      !bucket.conversations.some((c) => c.id === bucket.activeConversationId)
    ) {
      bucket.activeConversationId = bucket.conversations[0]?.id || null;
    }
  }

  function emitSync(userKey, payload) {
    emitter.emit(`sync:${userKey}`, {
      ...payload,
      ts: Date.now(),
    });
  }

  function listConversations(username) {
    const { bucket } = getUserBucket(username);
    sortAndPrune(bucket);
    const active =
      bucket.conversations.find((c) => c.id === bucket.activeConversationId) ||
      bucket.conversations[0] ||
      null;
    if (active && bucket.activeConversationId !== active.id) {
      bucket.activeConversationId = active.id;
    }
    return {
      conversations: bucket.conversations.map(summarizeConversation),
      activeConversationId: active?.id || null,
      activeConversation: cloneConversation(active),
    };
  }

  function getConversation(username, conversationId, { select = false } = {}) {
    const { bucket } = getUserBucket(username);
    const conv = bucket.conversations.find((c) => c.id === conversationId);
    if (!conv) return null;
    if (select && bucket.activeConversationId !== conv.id) {
      bucket.activeConversationId = conv.id;
      saveToDisk();
    }
    return cloneConversation(conv);
  }

  function createConversation(username, { title = '', select = true } = {}) {
    const { key, bucket } = getUserBucket(username);
    const now = new Date().toISOString();
    const conv = {
      id: `conv_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`,
      title: title ? sanitizeTitle(title) : DEFAULT_TITLE,
      createdAt: now,
      updatedAt: now,
      messages: [],
    };
    bucket.conversations.unshift(conv);
    if (select) bucket.activeConversationId = conv.id;
    sortAndPrune(bucket);
    saveToDisk();
    emitSync(key, {
      type: 'created',
      conversationId: conv.id,
      activeConversationId: bucket.activeConversationId,
      updatedAt: now,
    });
    return {
      conversation: cloneConversation(conv),
      conversations: bucket.conversations.map(summarizeConversation),
      activeConversationId: bucket.activeConversationId,
    };
  }

  function renameConversation(username, conversationId, title) {
    const { key, bucket } = getUserBucket(username);
    const conv = bucket.conversations.find((c) => c.id === conversationId);
    if (!conv) return null;
    conv.title = sanitizeTitle(title);
    conv.updatedAt = new Date().toISOString();
    sortAndPrune(bucket);
    saveToDisk();
    emitSync(key, {
      type: 'renamed',
      conversationId: conv.id,
      title: conv.title,
      updatedAt: conv.updatedAt,
    });
    return cloneConversation(conv);
  }

  function deleteConversation(username, conversationId) {
    const { key, bucket } = getUserBucket(username);
    const idx = bucket.conversations.findIndex((c) => c.id === conversationId);
    if (idx === -1) return null;
    bucket.conversations.splice(idx, 1);
    if (bucket.activeConversationId === conversationId) {
      bucket.activeConversationId = bucket.conversations[0]?.id || null;
    }
    sortAndPrune(bucket);
    saveToDisk();
    const now = new Date().toISOString();
    emitSync(key, {
      type: 'deleted',
      conversationId,
      activeConversationId: bucket.activeConversationId,
      updatedAt: now,
    });
    const active = bucket.conversations.find((c) => c.id === bucket.activeConversationId) || null;
    return {
      ok: true,
      conversations: bucket.conversations.map(summarizeConversation),
      activeConversationId: bucket.activeConversationId,
      activeConversation: cloneConversation(active),
    };
  }

  function getHistoryForPrompt(username, conversationId, limit = 16) {
    const { bucket } = getUserBucket(username);
    const conv = conversationId
      ? bucket.conversations.find((c) => c.id === conversationId)
      : null;
    if (!conv) return [];
    return conv.messages
      .filter((m) => (m.role === 'user' || m.role === 'model') && typeof m.text === 'string' && m.text.trim())
      .slice(-limit)
      .map((m) => ({ role: m.role, text: m.text }));
  }

  function appendUserMessage(username, { conversationId = null, text, time = null } = {}) {
    const { key, bucket } = getUserBucket(username);
    const cleanText = String(text || '').trim().slice(0, 4000);
    const now = new Date().toISOString();

    let conv = conversationId ? bucket.conversations.find((c) => c.id === conversationId) : null;
    if (!conv) {
      conv = {
        id: `conv_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`,
        title: deriveTitle(cleanText),
        createdAt: now,
        updatedAt: now,
        messages: [],
      };
      bucket.conversations.unshift(conv);
    } else if (conv.title === DEFAULT_TITLE && !conv.messages.some((m) => m.role === 'user')) {
      conv.title = deriveTitle(cleanText);
    }

    const msg = {
      id: `msg_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`,
      role: 'user',
      text: cleanText,
      model: null,
      actions: [],
      pendingActions: [],
      time: time || nowTimeHHMM(),
      createdAt: now,
    };

    conv.messages.push(msg);
    if (conv.messages.length > maxMessagesPerConversation) {
      conv.messages = conv.messages.slice(-maxMessagesPerConversation);
    }
    conv.updatedAt = now;
    bucket.activeConversationId = conv.id;
    sortAndPrune(bucket);
    saveToDisk();

    emitSync(key, {
      type: 'message',
      role: 'user',
      conversationId: conv.id,
      messageId: msg.id,
      updatedAt: now,
    });

    return { conversation: cloneConversation(conv), message: { ...msg } };
  }

  function appendModelMessage(
    username,
    { conversationId, text, model = null, actions = [], pendingActions = [], time = null } = {}
  ) {
    const { key, bucket } = getUserBucket(username);
    const conv = bucket.conversations.find((c) => c.id === conversationId);
    if (!conv) return null;

    const now = new Date().toISOString();
    const msg = {
      id: `msg_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`,
      role: 'model',
      text: String(text || '').slice(0, 12000),
      model: model ? String(model).slice(0, 80) : null,
      actions: sanitizeActions(actions),
      pendingActions: sanitizePendingActions(pendingActions),
      time: time || nowTimeHHMM(),
      createdAt: now,
    };

    conv.messages.push(msg);
    if (conv.messages.length > maxMessagesPerConversation) {
      conv.messages = conv.messages.slice(-maxMessagesPerConversation);
    }
    conv.updatedAt = now;
    bucket.activeConversationId = conv.id;
    sortAndPrune(bucket);
    saveToDisk();

    emitSync(key, {
      type: 'message',
      role: 'model',
      conversationId: conv.id,
      messageId: msg.id,
      updatedAt: now,
    });

    return { conversation: cloneConversation(conv), message: { ...msg } };
  }

  function resolvePendingActionInHistory(username, { actionId, status, output = null } = {}) {
    if (!actionId) return null;
    const { key, bucket } = getUserBucket(username);
    for (const conv of bucket.conversations) {
      for (const msg of conv.messages) {
        if (!Array.isArray(msg.pendingActions)) continue;
        const found = msg.pendingActions.find((p) => p.id === actionId);
        if (found) {
          found.resolution = status;
          found.resolvedOutput = output ? String(output).slice(0, 2000) : null;
          conv.updatedAt = new Date().toISOString();
          saveToDisk();
          emitSync(key, {
            type: 'pending_resolved',
            conversationId: conv.id,
            actionId,
            status,
            updatedAt: conv.updatedAt,
          });
          return cloneConversation(conv);
        }
      }
    }
    return null;
  }

  function subscribe(username, listener) {
    const key = normalizeUserKey(username);
    const channel = `sync:${key}`;
    emitter.on(channel, listener);
    return () => emitter.off(channel, listener);
  }

  return {
    listConversations,
    getConversation,
    createConversation,
    renameConversation,
    deleteConversation,
    getHistoryForPrompt,
    appendUserMessage,
    appendModelMessage,
    resolvePendingActionInHistory,
    subscribe,
  };
}
