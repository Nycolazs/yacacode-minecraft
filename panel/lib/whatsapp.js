import fs from 'node:fs';
import path from 'node:path';

// ============================================================================
// YacaCode WhatsApp IA Manager (Zero Dependências no Painel)
// Comunica-se com o sidecar Baileys (whatsapp:3001) + Gemini Function Calling
// Somente leitura / informativa (ZERO comandos destrutivos)
// ============================================================================

const CONFIG_FILENAME = '.yacacode-whatsapp-config.json';
const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta';
const FALLBACK_MODELS = ['gemini-3.5-flash-lite', 'gemini-3.1-flash-lite', 'gemini-flash-lite-latest'];
const CHAT_HISTORY_TTL_MS = 30 * 60 * 1000;
const CHAT_COOLDOWN_MS = 2000;
const MAX_TOOL_ITERATIONS = 4;

const DEFAULT_CONFIG = {
  enabled: true,
  botName: 'Jorge',
  groupJid: '',
  groupName: '',
  respondInGroup: true,
  respondInPrivate: true,
  allowedPrivateNumbers: [], // vazio = qualquer privado; ou ['5511999999999']
  notifyBackup: true,
  notifyServerStatus: true,
  notifyPlayerJoinLeave: false,
  updatedAt: null,
};

function escapeRegExp(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function normalizePhoneList(input) {
  const arr = Array.isArray(input)
    ? input
    : String(input || '')
        .split(/[\n,;]+/)
        .map((s) => s.trim());
  const clean = [];
  for (const item of arr) {
    const digits = String(item || '').replace(/\D/g, '');
    if (digits.length >= 8 && !clean.includes(digits)) {
      clean.push(digits);
    }
  }
  return clean;
}

export function isBotCalledInGroup(text, botName = 'Jorge', { isMentioningBot = false, isReplyToBot = false } = {}) {
  if (isMentioningBot || isReplyToBot) return true;
  const cleanName = String(botName || 'Jorge').trim();
  if (!cleanName) return false;
  const rx = new RegExp(`(^|[^\\p{L}\\p{N}_])${escapeRegExp(cleanName)}($|[^\\p{L}\\p{N}_])`, 'iu');
  return rx.test(String(text || ''));
}

function buildReadOnlyTools() {
  return [
    {
      functionDeclarations: [
        {
          name: 'get_server_status',
          description:
            'Retorna o status em tempo real do servidor Minecraft (ligado/desligado, quantos e quem está jogando agora, versão, CPU, RAM, temperatura, endereço de conexão).',
          parameters: { type: 'OBJECT', properties: {} },
        },
        {
          name: 'get_server_report',
          description:
            'Retorna o relatório histórico dos últimos X dias (1 a 30): uptime, quedas, pico de jogadores, jogadores únicos, sessões, tempo jogado, médias de CPU/RAM/temperatura e backups realizados.',
          parameters: {
            type: 'OBJECT',
            properties: {
              days: {
                type: 'INTEGER',
                description: 'Quantidade de dias do relatório (entre 1 e 30). Padrão: 7.',
              },
            },
          },
        },
        {
          name: 'get_player_rankings',
          description:
            'Retorna rankings dos jogadores do servidor consolidando contas Java e Bedrock: quem morreu mais (deaths), quem jogou mais tempo (play_time), quem matou mais mobs (mob_kills), quem minerou mais blocos (blocks_mined), maior nível XP (xp) ou todos (all).',
          parameters: {
            type: 'OBJECT',
            properties: {
              metric: {
                type: 'STRING',
                description: 'Métrica do ranking: deaths, play_time, mob_kills, blocks_mined, xp ou all.',
              },
            },
          },
        },
        {
          name: 'get_player_stats',
          description:
            'Retorna estatísticas detalhadas de um jogador específico (mortes, tempo jogado, mobs mortos, blocos minerados, nível XP, vida, dimensão, se está online agora).',
          parameters: {
            type: 'OBJECT',
            properties: {
              name: {
                type: 'STRING',
                description: 'Nome ou parte do nick do jogador.',
              },
            },
            required: ['name'],
          },
        },
        {
          name: 'get_backup_status',
          description:
            'Retorna informações sobre os backups do servidor no Google Drive (último backup, data/hora, tamanho, agendamento automático e se há backup rodando agora).',
          parameters: { type: 'OBJECT', properties: {} },
        },
      ],
    },
  ];
}

function buildSystemInstruction(botName, serverName, mcDomain) {
  return [
    `Você é ${botName}, o assistente de IA do servidor Minecraft "${serverName}" (${mcDomain}) atendendo no WhatsApp.`,
    'Responda sempre em Português do Brasil (pt-BR), de forma simpática, clara, direta e bem formatada para WhatsApp.',
    'Use formatação simples do WhatsApp (*negrito* com asterisco único, listas curtas com hífen ou bullet, emojis moderados). Nunca use tabelas Markdown complexas nem blocos de código longos.',
    'SEMPRE consulte as ferramentas disponíveis para obter dados reais e atualizados antes de responder sobre status, jogadores online, relatórios, rankings, mortes ou backups. Nunca invente números ou nomes.',
    'Você é estritamente informativo (somente leitura): NÃO executa comandos administrativos (kick, ban, restart, op, backup manual etc.). Se alguém pedir uma ação administrativa, explique educadamente que pelo WhatsApp você só informa dados e que ações de controle devem ser feitas no painel web.',
  ].join('\n');
}

export function createWhatsAppManager({
  dataDir,
  serviceUrl = 'http://whatsapp:3001',
  internalToken = '',
  serverName = 'YacaCode',
  mcDomain = 'mc.yacacode.com',
  getGeminiConfig,
  toolHandlers,
  fetchImpl = globalThis.fetch,
}) {
  const configPath = path.join(dataDir, CONFIG_FILENAME);
  const recentLogs = [];
  const chatHistories = new Map(); // chatJid -> { updatedAt, messages: [] }
  const chatCooldowns = new Map(); // chatJid -> lastTs
  const seenMessageIds = new Map(); // messageId -> ts
  let lastNotifiedServerOnline = null;

  function pushLog(type, summary, details = '') {
    recentLogs.unshift({
      ts: new Date().toISOString(),
      type,
      summary: String(summary || '').slice(0, 180),
      details: String(details || '').slice(0, 300),
    });
    if (recentLogs.length > 40) recentLogs.length = 40;
  }

  function loadConfig() {
    try {
      if (!fs.existsSync(configPath)) return { ...DEFAULT_CONFIG };
      const parsed = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      return {
        ...DEFAULT_CONFIG,
        ...(parsed && typeof parsed === 'object' ? parsed : {}),
        allowedPrivateNumbers: normalizePhoneList(parsed?.allowedPrivateNumbers),
      };
    } catch {
      return { ...DEFAULT_CONFIG };
    }
  }

  function saveConfig(cfg) {
    const dir = path.dirname(configPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const clean = {
      ...DEFAULT_CONFIG,
      ...cfg,
      botName: String(cfg.botName || 'Jorge').trim().slice(0, 32) || 'Jorge',
      groupJid: String(cfg.groupJid || '').trim().slice(0, 128),
      groupName: String(cfg.groupName || '').trim().slice(0, 128),
      allowedPrivateNumbers: normalizePhoneList(cfg.allowedPrivateNumbers),
      updatedAt: new Date().toISOString(),
    };
    const tmp = `${configPath}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(clean, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, configPath);
    return clean;
  }

  async function bridgeFetch(pathname, { method = 'GET', body = null, timeoutMs = 10000 } = {}) {
    const headers = {};
    if (internalToken) headers['X-Internal-Token'] = internalToken;
    let payload;
    if (body !== null) {
      headers['Content-Type'] = 'application/json; charset=utf-8';
      payload = JSON.stringify(body);
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetchImpl(`${serviceUrl}${pathname}`, {
        method,
        headers,
        body: payload,
        signal: controller.signal,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw Object.assign(new Error(data.error || `Bridge WhatsApp HTTP ${res.status}`), {
          status: res.status === 400 ? 400 : 502,
        });
      }
      return data;
    } catch (err) {
      if (err.name === 'AbortError') {
        throw Object.assign(new Error('Tempo esgotado ao comunicar com o serviço WhatsApp.'), { status: 504 });
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  async function getBridgeStatus() {
    try {
      const data = await bridgeFetch('/status', { timeoutMs: 4000 });
      return { bridgeAvailable: true, ...data };
    } catch (err) {
      return {
        bridgeAvailable: false,
        state: 'offline',
        qrDataUrl: null,
        phone: null,
        pushName: null,
        lastError: `Serviço WhatsApp indisponível (${err.message})`,
      };
    }
  }

  async function getPublicStatus() {
    const [bridge, cfg] = await Promise.all([getBridgeStatus(), Promise.resolve(loadConfig())]);
    const gemini = typeof getGeminiConfig === 'function' ? getGeminiConfig() : { apiKey: '' };
    return {
      bridge,
      config: cfg,
      aiConfigured: Boolean(gemini?.apiKey),
      recentLogs: recentLogs.slice(0, 25),
    };
  }

  function updateConfig(patch = {}) {
    const current = loadConfig();
    const next = {
      ...current,
      ...(typeof patch.enabled === 'boolean' ? { enabled: patch.enabled } : {}),
      ...(patch.botName !== undefined ? { botName: String(patch.botName).trim() || 'Jorge' } : {}),
      ...(patch.groupJid !== undefined ? { groupJid: String(patch.groupJid).trim() } : {}),
      ...(patch.groupName !== undefined ? { groupName: String(patch.groupName).trim() } : {}),
      ...(typeof patch.respondInGroup === 'boolean' ? { respondInGroup: patch.respondInGroup } : {}),
      ...(typeof patch.respondInPrivate === 'boolean' ? { respondInPrivate: patch.respondInPrivate } : {}),
      ...(patch.allowedPrivateNumbers !== undefined
        ? { allowedPrivateNumbers: normalizePhoneList(patch.allowedPrivateNumbers) }
        : {}),
      ...(typeof patch.notifyBackup === 'boolean' ? { notifyBackup: patch.notifyBackup } : {}),
      ...(typeof patch.notifyServerStatus === 'boolean' ? { notifyServerStatus: patch.notifyServerStatus } : {}),
      ...(typeof patch.notifyPlayerJoinLeave === 'boolean'
        ? { notifyPlayerJoinLeave: patch.notifyPlayerJoinLeave }
        : {}),
    };
    const saved = saveConfig(next);
    pushLog('config', 'Configurações do WhatsApp IA atualizadas.');
    return saved;
  }

  async function connect() {
    const data = await bridgeFetch('/connect', { method: 'POST', timeoutMs: 12000 });
    pushLog('connection', 'Conexão WhatsApp iniciada.');
    return data;
  }

  async function disconnect({ logout = false } = {}) {
    const data = await bridgeFetch('/disconnect', {
      method: 'POST',
      body: { logout: Boolean(logout) },
      timeoutMs: 10000,
    });
    pushLog('connection', logout ? 'Sessão WhatsApp encerrada (logout).' : 'WhatsApp desconectado.');
    return data;
  }

  async function listGroups() {
    return bridgeFetch('/groups', { method: 'GET', timeoutMs: 12000 });
  }

  async function sendMessage(jid, text) {
    const cleanJid = String(jid || '').trim();
    const cleanText = String(text || '').trim();
    if (!cleanJid || !cleanText) {
      throw Object.assign(new Error('Destino ou mensagem vazios.'), { status: 400 });
    }
    return bridgeFetch('/send', {
      method: 'POST',
      body: { jid: cleanJid, text: cleanText },
      timeoutMs: 10000,
    });
  }

  async function sendTestMessage() {
    const cfg = loadConfig();
    if (!cfg.groupJid) {
      throw Object.assign(new Error('Selecione primeiro o grupo do WhatsApp nas configurações.'), { status: 400 });
    }
    const text = `🤖 *${cfg.botName} (IA ${serverName})*\nConexão com o WhatsApp funcionando perfeitamente!\n\nPode me chamar por aqui (ex: _"${cfg.botName}, quem está jogando agora?"_ ou _"${cfg.botName}, qual jogador morreu mais?"_).`;
    const res = await sendMessage(cfg.groupJid, text);
    pushLog('notify', `Mensagem de teste enviada para ${cfg.groupName || cfg.groupJid}`);
    return res;
  }

  async function notifyGroup(text, logSummary) {
    const cfg = loadConfig();
    if (!cfg.enabled || !cfg.groupJid) return false;
    try {
      await sendMessage(cfg.groupJid, text);
      pushLog('notify', logSummary || text.slice(0, 120));
      return true;
    } catch (err) {
      pushLog('error', `Falha ao notificar grupo: ${err.message}`);
      return false;
    }
  }

  async function notifyBackupResult({ ok, fileName = null, sizeBytes = 0, prunedCount = 0, error = null }) {
    const cfg = loadConfig();
    if (!cfg.enabled || !cfg.notifyBackup || !cfg.groupJid) return false;
    const sizeMB = sizeBytes ? `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB` : 'tamanho desconhecido';
    const timeStr = new Date().toLocaleString('pt-BR', { timeZone: 'America/Fortaleza' });
    if (ok) {
      const prunedNote = prunedCount > 0 ? `\n🧹 ${prunedCount} backup(s) antigo(s) removido(s) pela retenção.` : '';
      const msg = `☁️ *Backup concluído — ${serverName}*\n📦 Arquivo: \`${fileName || 'world.tar.gz'}\`\n💾 Tamanho: *${sizeMB}*\n🕒 Horário: ${timeStr}${prunedNote}`;
      return notifyGroup(msg, `Backup concluído notificado (${fileName || sizeMB})`);
    }
    const msg = `⚠️ *Falha no backup — ${serverName}*\n🕒 Horário: ${timeStr}\n❌ Motivo: ${error || 'Erro desconhecido'}`;
    return notifyGroup(msg, `Falha de backup notificada: ${error || 'erro'}`);
  }

  async function notifyServerStateChange({ online, reason = '' }) {
    const cfg = loadConfig();
    if (lastNotifiedServerOnline === null) {
      lastNotifiedServerOnline = Boolean(online);
      return false; // Evita spam no boot do painel
    }
    if (lastNotifiedServerOnline === Boolean(online)) return false;
    lastNotifiedServerOnline = Boolean(online);

    if (!cfg.enabled || !cfg.notifyServerStatus || !cfg.groupJid) return false;
    const timeStr = new Date().toLocaleTimeString('pt-BR', { timeZone: 'America/Fortaleza' });
    const msg = online
      ? `🟢 *Servidor ${serverName} ONLINE!*\n🎮 Endereço: \`${mcDomain}\`\n🕒 Voltou às ${timeStr}`
      : `🔴 *Servidor ${serverName} OFFLINE*\n🕒 Detectado às ${timeStr}${reason ? `\nℹ️ ${reason}` : ''}`;
    return notifyGroup(msg, `Status do servidor: ${online ? 'ONLINE' : 'OFFLINE'}`);
  }

  async function notifyPlayerEvent({ name, event }) {
    const cfg = loadConfig();
    if (!cfg.enabled || !cfg.notifyPlayerJoinLeave || !cfg.groupJid) return false;
    const cleanName = String(name || '').trim();
    if (!cleanName) return false;
    const edition = cleanName.startsWith('.') ? 'Bedrock' : 'Java';
    const msg =
      event === 'join'
        ? `🎮 *${cleanName}* entrou no servidor (${edition}).`
        : `👋 *${cleanName}* saiu do servidor (${edition}).`;
    return notifyGroup(msg, `${cleanName} ${event === 'join' ? 'entrou' : 'saiu'}`);
  }

  async function callGemini({ apiKey, model, contents, systemInstruction, tools }) {
    const orderedModels = [model, ...FALLBACK_MODELS].filter(
      (m, i, arr) => Boolean(m) && arr.indexOf(m) === i
    );
    let lastError = null;

    for (const candidateModel of orderedModels) {
      const url = `${GEMINI_API_BASE}/models/${encodeURIComponent(candidateModel)}:generateContent?key=${encodeURIComponent(apiKey)}`;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 25000);
      try {
        const res = await fetchImpl(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json; charset=utf-8' },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: systemInstruction }] },
            contents,
            tools,
            generationConfig: {
              temperature: 0.35,
              maxOutputTokens: 700,
            },
          }),
          signal: controller.signal,
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          lastError = new Error(data?.error?.message || `Gemini HTTP ${res.status}`);
          if (res.status === 404 || res.status === 429 || res.status >= 500) {
            continue; // tenta fallback
          }
          throw lastError;
        }
        return { data, model: candidateModel };
      } catch (err) {
        lastError = err;
        if (err.name === 'AbortError') continue;
      } finally {
        clearTimeout(timer);
      }
    }
    throw lastError || new Error('Não foi possível obter resposta do Gemini.');
  }

  async function executeReadOnlyTool(name, args = {}) {
    if (!toolHandlers || typeof toolHandlers[name] !== 'function') {
      return { error: `Ferramenta desconhecida: ${name}` };
    }
    try {
      return await toolHandlers[name](args || {});
    } catch (err) {
      return { error: err.message || 'Erro ao consultar dados.' };
    }
  }

  async function generateAiReply({ chatJid, senderName, text, botName }) {
    const gemini = typeof getGeminiConfig === 'function' ? getGeminiConfig() : null;
    if (!gemini?.apiKey) {
      return `⚠️ A chave da API Gemini ainda não foi configurada no painel do ${serverName}.`;
    }

    const now = Date.now();
    const existing = chatHistories.get(chatJid);
    const history =
      existing && now - existing.updatedAt < CHAT_HISTORY_TTL_MS ? existing.messages.slice(-8) : [];

    const userPrompt = `[${senderName}]: ${text}`;
    const contents = [
      ...history,
      { role: 'user', parts: [{ text: userPrompt }] },
    ];

    const tools = buildReadOnlyTools();
    const systemInstruction = buildSystemInstruction(botName, serverName, mcDomain);

    let replyText = '';
    for (let step = 0; step < MAX_TOOL_ITERATIONS; step++) {
      const { data } = await callGemini({
        apiKey: gemini.apiKey,
        model: gemini.model || FALLBACK_MODELS[0],
        contents,
        systemInstruction,
        tools,
      });

      const candidate = data?.candidates?.[0];
      const parts = candidate?.content?.parts || [];
      const fnCalls = parts.filter((p) => p.functionCall);

      if (fnCalls.length === 0) {
        replyText = parts
          .map((p) => p.text || '')
          .join('')
          .trim();
        break;
      }

      contents.push({ role: 'model', parts });
      const responseParts = [];
      for (const callPart of fnCalls) {
        const fnName = callPart.functionCall.name;
        const fnArgs = callPart.functionCall.args || {};
        const result = await executeReadOnlyTool(fnName, fnArgs);
        responseParts.push({
          functionResponse: {
            name: fnName,
            response: { result },
          },
        });
      }
      contents.push({ role: 'user', parts: responseParts });
    }

    if (!replyText) {
      replyText = 'Desculpe, não consegui consultar os dados agora. Tente novamente em alguns segundos.';
    }

    chatHistories.set(chatJid, {
      updatedAt: Date.now(),
      messages: [
        ...history,
        { role: 'user', parts: [{ text: userPrompt }] },
        { role: 'model', parts: [{ text: replyText }] },
      ].slice(-10),
    });

    return replyText;
  }

  async function handleIncomingMessage(payload = {}) {
    const cfg = loadConfig();
    if (!cfg.enabled) return { handled: false, reason: 'disabled' };

    const messageId = payload.messageId || '';
    const now = Date.now();
    if (messageId) {
      if (seenMessageIds.has(messageId)) return { handled: false, reason: 'duplicate' };
      seenMessageIds.set(messageId, now);
      if (seenMessageIds.size > 300) {
        for (const [id, ts] of seenMessageIds.entries()) {
          if (now - ts > 5 * 60 * 1000) seenMessageIds.delete(id);
        }
      }
    }

    const chatJid = String(payload.chatJid || '').trim();
    const text = String(payload.text || '').trim();
    const isGroup = Boolean(payload.isGroup);
    const senderPhone = String(payload.senderPhone || '').replace(/\D/g, '');
    const senderName = String(payload.pushName || senderPhone || 'Jogador').trim();

    if (!chatJid || !text) return { handled: false, reason: 'empty' };

    if (isGroup) {
      if (!cfg.respondInGroup) return { handled: false, reason: 'group_disabled' };
      if (!cfg.groupJid || chatJid !== cfg.groupJid) {
        return { handled: false, reason: 'other_group' };
      }
      const called = isBotCalledInGroup(text, cfg.botName, {
        isMentioningBot: Boolean(payload.isMentioningBot),
        isReplyToBot: Boolean(payload.isReplyToBot),
      });
      if (!called) return { handled: false, reason: 'not_called' };
    } else {
      if (!cfg.respondInPrivate) return { handled: false, reason: 'private_disabled' };
      if (cfg.allowedPrivateNumbers.length > 0 && !cfg.allowedPrivateNumbers.includes(senderPhone)) {
        return { handled: false, reason: 'sender_not_allowed' };
      }
    }

    const lastReplyAt = chatCooldowns.get(chatJid) || 0;
    if (now - lastReplyAt < CHAT_COOLDOWN_MS) {
      return { handled: false, reason: 'cooldown' };
    }
    chatCooldowns.set(chatJid, now);

    try {
      const reply = await generateAiReply({
        chatJid,
        senderName,
        text,
        botName: cfg.botName,
      });
      await sendMessage(chatJid, reply);
      pushLog(
        isGroup ? 'group' : 'private',
        `${senderName}: "${text.slice(0, 80)}"`,
        reply.slice(0, 180)
      );
      return { handled: true, reply };
    } catch (err) {
      pushLog('error', `Erro ao responder ${senderName}: ${err.message}`);
      return { handled: false, error: err.message };
    }
  }

  return {
    loadConfig,
    getPublicStatus,
    updateConfig,
    connect,
    disconnect,
    listGroups,
    sendMessage,
    sendTestMessage,
    notifyBackupResult,
    notifyServerStateChange,
    notifyPlayerEvent,
    handleIncomingMessage,
  };
}
