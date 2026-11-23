import crypto from 'node:crypto';
import { buildPersonaInstruction, rememberExchange } from './persona.js';
import fs from 'node:fs';
import path from 'node:path';
import { hasRole } from './auth.js';

// ============================================================================
// YacaCode AI Assistant — Integração Nativa Gemini REST API (Zero Dependências)
// ============================================================================

export const AVAILABLE_MODELS = [
  { id: 'gemini-3.8-flash', label: 'Gemini 3.8 Flash (Mais inteligente • Recomendado)' },
  { id: 'gemini-3.5-flash-lite', label: 'Gemini 3.5 Flash-Lite (Ultra rápido)' },
  { id: 'gemini-3.1-flash-lite', label: 'Gemini 3.1 Flash-Lite (Ultra rápido)' },
  { id: 'gemini-flash-lite-latest', label: 'Gemini Flash-Lite Latest (Sempre atualizado)' },
  { id: 'gemini-flash-latest', label: 'Gemini Flash Latest (Sempre atualizado)' },
];

const DEFAULT_MODEL = 'gemini-3.8-flash';
// Modelo principal (mais inteligente) tenta por pouco tempo; se o Google estiver congestionado cai
// direto nos Flash-Lite, que respondem em poucos segundos.
const FALLBACK_MODELS = ['gemini-3.5-flash-lite', 'gemini-3.1-flash-lite', 'gemini-flash-lite-latest'];
const DEPRECATED_MODELS = new Set(['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.5-flash-lite']);
const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta';
const PENDING_TTL_MS = 5 * 60 * 1000; // 5 minutos
const MAX_TOOL_ITERATIONS = 6;

// Comandos que exigem cargo ADMIN (bloqueados para moderadores)
const ADMIN_ONLY_CMD_ROOTS = new Set([
  'op',
  'deop',
  'stop',
  'restart',
  'ban-ip',
  'pardon-ip',
  'save-off',
  'reload',
  'setworldspawn',
  'forceload',
  'worldborder',
  'publish',
]);

// Comandos considerados destrutivos -> exigem confirmação em 1 clique do usuário no chat
const DESTRUCTIVE_CMD_ROOTS = new Set([
  'ban',
  'ban-ip',
  'kick',
  'clear',
  'kill',
  'stop',
  'fill',
  'op',
  'deop',
  'whitelist',
  'gamemode',
  'pardon',
  'pardon-ip',
]);

// Comandos de consulta pura (somente leitura) — permitidos até para viewer se precisar
const READONLY_CMD_ROOTS = new Set([
  'list',
  'tps',
  'seed',
  'help',
  'banlist',
]);

export function sanitizeMcCommandInput(command) {
  return String(command || '')
    .replace(/[\r\n\0]/g, ' ')
    .trim()
    .replace(/^\/+/, '')
    .slice(0, 512);
}

export function classifyMinecraftCommand(rawCommand, userRole) {
  const clean = sanitizeMcCommandInput(rawCommand);
  if (!clean) {
    return { allowed: false, reason: 'Comando vazio.', clean: '' };
  }

  const parts = clean.split(/\s+/);
  const root = (parts[0] || '').toLowerCase();
  const sub = (parts[1] || '').toLowerCase();

  // Permite comandos de consulta pura (ex: list, experience query ..., time query ...)
  const isReadOnly =
    READONLY_CMD_ROOTS.has(root) ||
    ((root === 'experience' || root === 'xp') && sub === 'query') ||
    (root === 'time' && sub === 'query') ||
    (root === 'whitelist' && sub === 'list');

  if (!isReadOnly && !hasRole(userRole, 'moderator')) {
    return {
      allowed: false,
      clean,
      reason: `Seu cargo "${userRole}" é somente leitura e não tem permissão para executar "/${clean}".`,
    };
  }

  const isAdminOnly =
    ADMIN_ONLY_CMD_ROOTS.has(root) ||
    (root === 'whitelist' && sub === 'off');

  if (isAdminOnly && !hasRole(userRole, 'admin')) {
    return {
      allowed: false,
      clean,
      reason: `O comando "/${clean}" requer cargo Administrador (seu cargo: "${userRole}").`,
    };
  }

  const isDestructive =
    DESTRUCTIVE_CMD_ROOTS.has(root) ||
    (root === 'whitelist' && sub === 'off');

  return {
    allowed: true,
    clean,
    root,
    isReadOnly,
    requiresConfirmation: isDestructive,
  };
}

export function maskApiKey(key) {
  const s = String(key || '').trim();
  if (!s) return '';
  if (s.length <= 10) return `${s.slice(0, 2)}••••${s.slice(-2)}`;
  return `${s.slice(0, 6)}••••••${s.slice(-4)}`;
}

function buildToolDeclarations(userRole) {
  const isMod = hasRole(userRole, 'moderator');
  const isAdmin = hasRole(userRole, 'admin');

  const decls = [
    {
      name: 'get_server_status',
      description:
        'Obtém o status completo e ao vivo do server: se está online, versão, TPS, jogadores online, uso de RAM/CPU, temperatura do Orange Pi, uptime e endereço de conexão.',
      parameters: { type: 'OBJECT', properties: {} },
    },
    {
      name: 'list_players',
      description:
        'Lista todos os jogadores online no momento e os jogadores conhecidos do servidor, incluindo nível de XP (xpLevel), vida, modo de jogo, dimensão, coordenadas (X, Y, Z), se é OP, whitelist e banidos.',
      parameters: { type: 'OBJECT', properties: {} },
    },
    {
      name: 'get_player_details',
      description:
        'Consulta informações detalhadas de um jogador específico: se está online, nível de XP ao vivo (via experience query), vida, fome, coordenadas, dimensão, modo de jogo, tempo jogado, mortes, mobs derrotados e blocos minerados.',
      parameters: {
        type: 'OBJECT',
        properties: {
          player_name: {
            type: 'STRING',
            description: 'Nick do jogador (Java ou .Nick para Bedrock).',
          },
        },
        required: ['player_name'],
      },
    },
    {
      name: 'get_recent_logs',
      description:
        'Lê as últimas linhas recentes do console/logs do servidor Minecraft para diagnosticar eventos recentes (entradas, saídas, mortes, chat, erros).',
      parameters: {
        type: 'OBJECT',
        properties: {
          lines: {
            type: 'INTEGER',
            description: 'Quantidade de linhas recentes para ler (padrão 40, máximo 100).',
          },
        },
      },
    },
    {
      name: 'list_backups',
      description: 'Lista os arquivos de backup disponíveis do mundo do servidor com data e tamanho.',
      parameters: { type: 'OBJECT', properties: {} },
    },
  ];

  if (isMod) {
    decls.push(
      {
        name: 'run_minecraft_command',
        description:
          'Executa um comando no console do servidor Minecraft (sem barra "/" inicial). Exemplos: "time set day", "weather clear", "op Jogador", "say Mensagem", "gamemode creative Jogador", "tp Jogador1 Jogador2", "give Jogador diamond 5", "xp add Jogador 10 levels", "difficulty normal", "whitelist add Jogador", "kick Jogador motivo", "ban Jogador motivo". Comandos destrutivos (ban, kick, clear, kill, stop) entram em fila de confirmação de 1 clique para o usuário aprovar.',
        parameters: {
          type: 'OBJECT',
          properties: {
            command: {
              type: 'STRING',
              description: 'Comando Minecraft sem a barra "/" inicial (ex: "time set day", "op Nycolazs").',
            },
            reason: {
              type: 'STRING',
              description: 'Resumo curto em português do objetivo deste comando (ex: "Deixar de dia no mundo").',
            },
          },
          required: ['command'],
        },
      },
      {
        name: 'server_power_action',
        description:
          'Controla energia do container do servidor Minecraft: "start" (iniciar), "restart" (reiniciar salvando o mundo) ou "stop" (parar — somente admin). "restart" e "stop" sempre pedem confirmação de 1 clique ao usuário.',
        parameters: {
          type: 'OBJECT',
          properties: {
            action: {
              type: 'STRING',
              enum: isAdmin ? ['start', 'restart', 'stop'] : ['start', 'restart'],
              description: 'Ação de energia desejada.',
            },
            reason: {
              type: 'STRING',
              description: 'Motivo curto em português.',
            },
          },
          required: ['action'],
        },
      }
    );
  }

  if (isAdmin) {
    decls.push({
      name: 'create_backup_now',
      description: 'Aciona um backup imediato e seguro do mundo no container yacacode-backup (somente Admin).',
      parameters: { type: 'OBJECT', properties: {} },
    });
  }

  return [{ functionDeclarations: decls }];
}

function buildSystemInstruction({ mcDomain, mcVersion, username, userRole }) {
  return buildPersonaInstruction({
    channel: 'panel',
    username,
    role: userRole,
    mcVersion,
    mcDomain,
    extra: [
      'Para nível/XP/vida/posição de um jogador use `get_player_details` ou `list_players` (console ao vivo + dados salvos).',
    ],
  });
}

export function createAiAssistant({
  configFile,
  envApiKey = '',
  envModel = '',
  serverName = 'YacaCode',
  mcDomain = 'mc.yacacode.com',
  mcVersion = '26.3',
  fetchImpl = globalThis.fetch,
  handlers,
}) {
  const pendingActions = new Map();

  function loadStoredConfig() {
    if (!configFile || !fs.existsSync(configFile)) return {};
    try {
      const parsed = JSON.parse(fs.readFileSync(configFile, 'utf8'));
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }

  function saveStoredConfig(next) {
    if (!configFile) return;
    fs.mkdirSync(path.dirname(configFile), { recursive: true });
    fs.writeFileSync(configFile, JSON.stringify(next, null, 2), { encoding: 'utf8', mode: 0o600 });
    try {
      fs.chmodSync(configFile, 0o600);
    } catch {
      // ignore
    }
  }

  function getEffectiveConfig() {
    const stored = loadStoredConfig();
    const storedKey = typeof stored.apiKey === 'string' ? stored.apiKey.trim() : '';
    const fallbackKey = String(envApiKey || '').trim();
    const apiKey = storedKey || fallbackKey;
    const source = storedKey ? 'panel' : fallbackKey ? 'env' : 'none';
    let model =
      (typeof stored.model === 'string' && stored.model.trim()) ||
      String(envModel || '').trim() ||
      DEFAULT_MODEL;
    if (DEPRECATED_MODELS.has(model)) {
      model = DEFAULT_MODEL;
    }

    return {
      configured: Boolean(apiKey),
      apiKey,
      source,
      model,
      inGameChatEnabled: stored.inGameChatEnabled !== false,
      updatedAt: stored.updatedAt || null,
    };
  }

  function getPublicStatus(userRole) {
    const cfg = getEffectiveConfig();
    const isAdmin = hasRole(userRole, 'admin');
    return {
      configured: cfg.configured,
      model: cfg.model,
      source: cfg.source,
      inGameChatEnabled: cfg.inGameChatEnabled,
      updatedAt: cfg.updatedAt,
      maskedKey: isAdmin ? maskApiKey(cfg.apiKey) : undefined,
      availableModels: AVAILABLE_MODELS,
      permissions: {
        canRead: true,
        canRunCommands: hasRole(userRole, 'moderator'),
        canAdminCommands: isAdmin,
        canConfigure: isAdmin,
      },
    };
  }

  function updateConfig({ apiKey, model, clearApiKey = false, inGameChatEnabled }) {
    const current = loadStoredConfig();
    const next = { ...current };

    if (clearApiKey) {
      delete next.apiKey;
    } else if (typeof apiKey === 'string' && apiKey.trim()) {
      const cleanKey = apiKey.trim();
      if (cleanKey.length < 16 || /\s/.test(cleanKey)) {
        throw Object.assign(new Error('Chave de API do Gemini inválida.'), { status: 400 });
      }
      next.apiKey = cleanKey;
    }

    if (typeof model === 'string' && model.trim()) {
      const cleanModel = model.trim();
      if (!/^[a-zA-Z0-9._-]{3,80}$/.test(cleanModel)) {
        throw Object.assign(new Error('Nome de modelo Gemini inválido.'), { status: 400 });
      }
      next.model = cleanModel;
    }

    if (inGameChatEnabled !== undefined) {
      next.inGameChatEnabled = Boolean(inGameChatEnabled);
    }

    next.updatedAt = new Date().toISOString();
    saveStoredConfig(next);
    return getPublicStatus('admin');
  }

  function cleanupExpiredPending() {
    const now = Date.now();
    for (const [id, item] of pendingActions.entries()) {
      if (now > item.expiresAt) pendingActions.delete(id);
    }
  }

  function registerPendingAction({ username, role, kind, command, powerAction, label, reason }) {
    cleanupExpiredPending();
    const id = crypto.randomBytes(8).toString('hex');
    const record = {
      id,
      username,
      role,
      kind, // 'command' | 'power'
      command: command || null,
      powerAction: powerAction || null,
      label,
      reason: reason || '',
      createdAt: Date.now(),
      expiresAt: Date.now() + PENDING_TTL_MS,
    };
    pendingActions.set(id, record);
    return {
      id: record.id,
      kind: record.kind,
      command: record.command,
      powerAction: record.powerAction,
      label: record.label,
      reason: record.reason,
      expiresAt: record.expiresAt,
    };
  }

  async function executeTool(name, args, session, executedActions, queuedPending) {
    const safeArgs = args && typeof args === 'object' ? args : {};

    switch (name) {
      case 'get_server_status': {
        const data = await handlers.getServerStatus();
        executedActions.push({
          tool: name,
          label: 'Consultou status do servidor',
          status: 'ok',
        });
        return data;
      }

      case 'list_players': {
        const data = await handlers.listPlayers();
        executedActions.push({
          tool: name,
          label: `Consultou jogadores (${data.onlineCount ?? 0} online)`,
          status: 'ok',
        });
        return data;
      }

      case 'get_player_details': {
        const playerName = String(safeArgs.player_name || '').trim();
        if (!playerName) return { error: 'Informe o nome do jogador.' };
        const data = await handlers.getPlayerDetails(playerName);
        executedActions.push({
          tool: name,
          label: `Consultou dados de ${playerName}`,
          status: 'ok',
        });
        return data;
      }

      case 'get_recent_logs': {
        const lines = Math.min(Math.max(Number(safeArgs.lines) || 40, 5), 100);
        const data = await handlers.getRecentLogs(lines);
        executedActions.push({
          tool: name,
          label: `Leu últimas ${lines} linhas de log`,
          status: 'ok',
        });
        return data;
      }

      case 'list_backups': {
        const data = await handlers.listBackups();
        executedActions.push({
          tool: name,
          label: `Listou backups (${data.backups?.length ?? 0})`,
          status: 'ok',
        });
        return data;
      }

      case 'run_minecraft_command': {
        const verdict = classifyMinecraftCommand(safeArgs.command, session.role);
        if (!verdict.allowed) {
          executedActions.push({
            tool: name,
            command: verdict.clean,
            label: `Bloqueado: /${verdict.clean || '?'}`,
            status: 'denied',
            output: verdict.reason,
          });
          return { ok: false, denied: true, error: verdict.reason };
        }

        if (verdict.requiresConfirmation) {
          const pending = registerPendingAction({
            username: session.username,
            role: session.role,
            kind: 'command',
            command: verdict.clean,
            label: `Executar /${verdict.clean}`,
            reason: String(safeArgs.reason || 'Ação destrutiva no servidor'),
          });
          queuedPending.push(pending);
          return {
            ok: false,
            status: 'pending_confirmation',
            actionId: pending.id,
            command: verdict.clean,
            message:
              'Ação destrutiva preparada. Aguarde o usuário clicar em "Confirmar e executar" no chat.',
          };
        }

        try {
          const output = await handlers.runMinecraftCommand(verdict.clean);
          executedActions.push({
            tool: name,
            command: verdict.clean,
            label: `/${verdict.clean}`,
            status: 'ok',
            output: output || 'Comando enviado com sucesso.',
          });
          return {
            ok: true,
            command: verdict.clean,
            output: output || 'Comando executado no servidor.',
          };
        } catch (err) {
          executedActions.push({
            tool: name,
            command: verdict.clean,
            label: `/${verdict.clean}`,
            status: 'error',
            output: err.message,
          });
          return { ok: false, error: err.message };
        }
      }

      case 'server_power_action': {
        const action = String(safeArgs.action || '').trim().toLowerCase();
        if (!['start', 'restart', 'stop'].includes(action)) {
          return { ok: false, error: 'Ação de energia inválida.' };
        }
        const needed = action === 'stop' ? 'admin' : 'moderator';
        if (!hasRole(session.role, needed)) {
          return {
            ok: false,
            denied: true,
            error: `Ação "${action}" requer cargo "${needed}".`,
          };
        }

        if (action === 'stop' || action === 'restart') {
          const pending = registerPendingAction({
            username: session.username,
            role: session.role,
            kind: 'power',
            powerAction: action,
            label: action === 'stop' ? 'Parar o servidor Minecraft' : 'Reiniciar o servidor Minecraft',
            reason: String(safeArgs.reason || 'Controle de energia do servidor'),
          });
          queuedPending.push(pending);
          return {
            ok: false,
            status: 'pending_confirmation',
            actionId: pending.id,
            action,
            message: `Ação "${action}" aguardando confirmação de 1 clique do usuário no chat.`,
          };
        }

        const result = await handlers.serverPowerAction(action);
        executedActions.push({
          tool: name,
          label: `Energia: ${action}`,
          status: 'ok',
          output: 'Servidor iniciado.',
        });
        return { ok: true, action, ...result };
      }

      case 'create_backup_now': {
        if (!hasRole(session.role, 'admin')) {
          return { ok: false, denied: true, error: 'Criar backup requer cargo Administrador.' };
        }
        try {
          const res = await handlers.createBackupNow();
          executedActions.push({
            tool: name,
            label: 'Backup imediato criado',
            status: 'ok',
            output: res.output || 'Backup concluído.',
          });
          return { ok: true, ...res };
        } catch (err) {
          executedActions.push({
            tool: name,
            label: 'Falha ao criar backup',
            status: 'error',
            output: err.message,
          });
          return { ok: false, error: err.message };
        }
      }

      default:
        return { ok: false, error: `Ferramenta desconhecida: ${name}` };
    }
  }

  async function callSingleGeminiModel(apiKey, model, payload, timeoutMs = 25000) {
    const url = `${GEMINI_API_BASE}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetchImpl(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const apiMsg = data?.error?.message || `Gemini API HTTP ${res.status}`;
        if (res.status === 400 && /API key/i.test(apiMsg)) {
          throw Object.assign(new Error('Chave de API do Gemini inválida. Verifique nas configurações da IA.'), {
            status: 400,
            fatal: true,
          });
        }
        if (res.status === 429) {
          throw Object.assign(
            new Error('Limite/cota da API Gemini atingido (429). Troque para um modelo Flash-Lite ou tente novamente em instantes.'),
            { status: 429, retryable: true }
          );
        }
        if (res.status === 404) {
          throw Object.assign(
            new Error(`Modelo "${model}" indisponível na API Gemini: ${apiMsg}`),
            { status: 400, retryable: true }
          );
        }
        if (res.status === 503 || res.status === 500) {
          throw Object.assign(
            new Error(`Modelo "${model}" temporariamente sobrecarregado na API Gemini (HTTP ${res.status}).`),
            { status: 500, retryable: true }
          );
        }
        // Usa HTTP 400/500 em vez de 502 para evitar que proxies (Cloudflare) substituam o JSON de erro
        throw Object.assign(new Error(`Erro na API Gemini (HTTP ${res.status}): ${apiMsg}`), { status: 500 });
      }
      return data;
    } catch (err) {
      if (err.name === 'AbortError') {
        throw Object.assign(new Error(`Tempo esgotado aguardando "${model}".`), { status: 408, retryable: true });
      }
      throw err;
    } finally {
      clearTimeout(timeout);
    }
  }

  async function callGeminiApi(apiKey, primaryModel, payload) {
    const candidates = [primaryModel, ...FALLBACK_MODELS.filter((m) => m !== primaryModel)];
    let lastErr = null;
    for (let i = 0; i < candidates.length; i += 1) {
      const candidateModel = candidates[i];
      try {
        const data = await callSingleGeminiModel(apiKey, candidateModel, payload, i === 0 ? 12000 : 18000);
        return { data, usedModel: candidateModel };
      } catch (err) {
        lastErr = err;
        if (err.fatal || !err.retryable) throw err;
      }
    }
    throw lastErr || Object.assign(new Error('Falha ao comunicar com a API Gemini.'), { status: 500 });
  }

  function sanitizeHistory(history) {
    if (!Array.isArray(history)) return [];
    return history
      .slice(-16)
      .filter((m) => m && (m.role === 'user' || m.role === 'model') && typeof m.text === 'string' && m.text.trim())
      .map((m) => ({
        role: m.role,
        parts: [{ text: m.text.trim().slice(0, 4000) }],
      }));
  }

  async function chat({ message, history = [], session }) {
    const cleanMsg = String(message || '').trim().slice(0, 4000);
    if (!cleanMsg) {
      throw Object.assign(new Error('Digite uma mensagem para a IA.'), { status: 400 });
    }

    const cfg = getEffectiveConfig();
    if (!cfg.configured) {
      throw Object.assign(
        new Error('A chave de API do Gemini ainda não foi configurada. Um Administrador pode configurá-la no botão "Configurar IA".'),
        { status: 503 }
      );
    }

    const contents = [
      ...sanitizeHistory(history),
      { role: 'user', parts: [{ text: cleanMsg }] },
    ];

    const tools = buildToolDeclarations(session.role);
    const systemInstruction = {
      parts: [
        {
          text: buildSystemInstruction({
            serverName,
            mcDomain,
            mcVersion,
            username: session.displayName || session.username,
            userRole: session.role,
          }),
        },
      ],
    };

    const executedActions = [];
    const queuedPending = [];
    let finalReply = '';
    let activeModel = cfg.model;

    for (let iter = 0; iter < MAX_TOOL_ITERATIONS; iter += 1) {
      const { data: response, usedModel } = await callGeminiApi(cfg.apiKey, activeModel, {
        systemInstruction,
        contents,
        tools,
        generationConfig: {
          temperature: 0.35,
          maxOutputTokens: 1024,
        },
      });
      activeModel = usedModel;

      const candidate = response?.candidates?.[0];
      const parts = candidate?.content?.parts || [];
      if (parts.length === 0) {
        const blockReason = response?.promptFeedback?.blockReason || candidate?.finishReason;
        finalReply = blockReason
          ? `Não foi possível gerar resposta (${blockReason}).`
          : 'Não recebi uma resposta da IA. Tente reformular a pergunta.';
        break;
      }

      const fnCalls = parts.filter((p) => p.functionCall);
      if (fnCalls.length === 0) {
        finalReply = parts
          .filter((p) => typeof p.text === 'string')
          .map((p) => p.text)
          .join('\n')
          .trim();
        break;
      }

      // Adiciona turno do modelo com as functionCalls (preservando thoughtSignature se existir)
      contents.push({ role: 'model', parts });

      // Executa todas as chamadas de ferramenta solicitadas nesta iteração
      const fnResponseParts = [];
      for (const callPart of fnCalls) {
        const { name, args } = callPart.functionCall;
        const toolResult = await executeTool(name, args, session, executedActions, queuedPending);
        fnResponseParts.push({
          functionResponse: {
            name,
            response: { result: toolResult },
          },
        });
      }

      contents.push({ role: 'user', parts: fnResponseParts });
    }

    if (!finalReply) {
      finalReply =
        queuedPending.length > 0
          ? 'Preparei a ação abaixo — clique em confirmar para executar no servidor.'
          : 'Concluí as verificações solicitadas.';
    }

    rememberExchange({
      channel: 'panel',
      who: session.displayName || session.username,
      question: cleanMsg,
      answer: finalReply,
    });
    return {
      ok: true,
      reply: finalReply,
      model: activeModel,
      actions: executedActions,
      pendingActions: queuedPending,
    };
  }

  async function resolvePendingAction({ actionId, decision, session }) {
    cleanupExpiredPending();
    const record = pendingActions.get(String(actionId || ''));
    if (!record) {
      throw Object.assign(new Error('Ação pendente não encontrada ou expirada (limite de 5 min).'), {
        status: 404,
      });
    }
    if (record.username !== session.username) {
      throw Object.assign(new Error('Apenas o usuário que solicitou esta ação pode confirmá-la.'), {
        status: 403,
      });
    }

    pendingActions.delete(record.id);

    if (decision !== 'approve') {
      return {
        ok: true,
        status: 'rejected',
        label: record.label,
        summary: `Ação cancelada: ${record.label}.`,
      };
    }

    if (record.kind === 'command') {
      const verdict = classifyMinecraftCommand(record.command, session.role);
      if (!verdict.allowed) {
        throw Object.assign(new Error(verdict.reason), { status: 403 });
      }
      const output = await handlers.runMinecraftCommand(verdict.clean);
      return {
        ok: true,
        status: 'executed',
        kind: 'command',
        command: verdict.clean,
        label: record.label,
        output: output || 'Comando executado no servidor.',
        summary: `Comando /${verdict.clean} executado com sucesso.`,
      };
    }

    if (record.kind === 'power') {
      const needed = record.powerAction === 'stop' ? 'admin' : 'moderator';
      if (!hasRole(session.role, needed)) {
        throw Object.assign(new Error(`Ação "${record.powerAction}" requer cargo "${needed}".`), {
          status: 403,
        });
      }
      await handlers.serverPowerAction(record.powerAction);
      return {
        ok: true,
        status: 'executed',
        kind: 'power',
        powerAction: record.powerAction,
        label: record.label,
        output: `Ação "${record.powerAction}" concluída.`,
        summary: `${record.label} concluído com sucesso.`,
      };
    }

    throw Object.assign(new Error('Tipo de ação pendente inválido.'), { status: 400 });
  }

  // Memória curta do chat global dentro do Minecraft (somente conversa/dúvidas)
  const inGameHistory = [];

  async function chatInGame({ player, question, worldContext = null }) {
    const cleanQuestion = String(question || '').trim().slice(0, 300);
    const cleanPlayer = String(player || 'Jogador').trim().slice(0, 32);
    if (!cleanQuestion) return { ok: false, reply: '' };

    const cfg = getEffectiveConfig();
    if (!cfg.configured || !cfg.inGameChatEnabled) {
      return { ok: false, reply: '' };
    }

    const contextBlock = worldContext
      ? [
          '',
          'CONTEXTO REAL DO MUNDO E JOGADORES (somente leitura — use estes dados reais quando perguntarem sobre localização, coordenadas, spawn, dia/hora, seed, jogadores online, nível de XP ou estatísticas do mundo):',
          JSON.stringify(worldContext),
        ].join('\n')
      : '';

    const hasRecentHistory = inGameHistory.length > 0;
    const systemInstruction = {
      parts: [
        {
          text: buildPersonaInstruction({
            channel: 'game',
            mcVersion,
            mcDomain,
            extra: [
              'Você pode passar dados reais dos jogadores (X/Y/Z, dimensão, distância, nível, vida, modo de jogo, tempo jogado) usando o contexto abaixo; se a posição vier do último salvamento, passe normalmente.',
              hasRecentHistory ? 'Você já está no meio da conversa no chat: continue naturalmente, sem saudar de novo.' : '',
              contextBlock,
            ],
          }),
        },
      ],
    };

    const userPrompt = `[${cleanPlayer}]: ${cleanQuestion}`;
    const contents = [
      ...inGameHistory.slice(-16),
      { role: 'user', parts: [{ text: userPrompt }] },
    ];

    // IMPORTANTE: NENHUMA tool é enviada — impossível executar comandos pelo chat do jogo!
    const { data: response, usedModel } = await callGeminiApi(cfg.apiKey, cfg.model, {
      systemInstruction,
      contents,
      generationConfig: {
        temperature: 0.45,
        maxOutputTokens: 220,
      },
    });

    const parts = response?.candidates?.[0]?.content?.parts || [];
    const reply = parts
      .filter((p) => typeof p.text === 'string')
      .map((p) => p.text)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();

    if (reply) {
      rememberExchange({ channel: 'game', who: cleanPlayer, question: cleanQuestion, answer: reply });
      inGameHistory.push({ role: 'user', parts: [{ text: userPrompt }] });
      inGameHistory.push({ role: 'model', parts: [{ text: reply }] });
      if (inGameHistory.length > 20) {
        inGameHistory.splice(0, inGameHistory.length - 20);
      }
    }

    return { ok: true, reply, model: usedModel };
  }

  function getActiveGeminiConfig() {
    const cfg = getEffectiveConfig();
    return {
      apiKey: cfg.apiKey || '',
      model: cfg.model || DEFAULT_MODEL,
    };
  }

  return {
    getPublicStatus,
    getActiveGeminiConfig,
    updateConfig,
    chat,
    chatInGame,
    resolvePendingAction,
  };
}
