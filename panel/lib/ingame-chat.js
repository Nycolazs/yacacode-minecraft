// ============================================================================
// Jorge — Bot de Chat Global In-Game (Somente Conversa & Dúvidas — ZERO Comandos)
// ============================================================================
// Escuta o stream de logs do container Minecraft (Pumpkin Rust ou Paper)
// e responde no chat global SEMPRE que alguém chamar por "Jorge" / "jorge"
// (sem precisar de @ ou !), e NUNCA quando não for chamado.
// Segurança:
//  - Nunca expõe ferramentas de execução para a IA neste modo.
//  - Sanitiza 100% da saída (sem \r/\n/\0) e envia exclusivamente via tellraw/say.
//  - Ignora mensagens do próprio servidor/bot e aplica cooldown por jogador.
// ============================================================================

// Reconhece a palavra isolada "jorge" (case-insensitive, com ou sem @/! opcional)
const JORGE_CALL_RE = /(?:^|[^\p{L}\p{N}_])[@!]?jorge(?=$|[^\p{L}\p{N}_])/iu;

// Formatos suportados:
// 1) Pumpkin Rust: "22:21:56  INFO <chat> EddScissors42: jorge qual camada de diamante?"
//    ou "[22:21:56] [INFO] <chat> Player: Jorge, me ajuda"
// 2) Paper/Vanilla: "[22:21:56 INFO]: <Player> oi jorge"
const PUMPKIN_CHAT_RE = /<chat>\s+([A-Za-z0-9_.-]{2,32}):\s+(.+)$/;
const VANILLA_CHAT_RE = /:\s+<([A-Za-z0-9_.-]{2,32})>\s+(.+)$/;

const IGNORED_SENDERS = new Set(['server', 'rcon', 'yacacode', 'yacacode-ia', 'yacacode ia', 'jorge', 'console']);

export function stripAnsi(text) {
  return String(text || '').replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '');
}

export function parseMinecraftChatLine(rawLine) {
  const line = stripAnsi(rawLine).trim();
  if (!line) return null;

  // Ignora eco das próprias respostas do Jorge ou mensagens do servidor
  if (line.includes('[Jorge]') || line.includes('[YacaCode IA]') || line.includes('[Server]')) {
    return null;
  }

  let match = line.match(PUMPKIN_CHAT_RE);
  if (!match) {
    match = line.match(VANILLA_CHAT_RE);
  }
  if (!match) return null;

  const player = match[1].trim();
  const message = match[2].trim();
  if (!player || !message) return null;
  if (IGNORED_SENDERS.has(player.toLowerCase())) return null;

  // Só responde se o jogador realmente chamou "Jorge" / "jorge"
  if (!JORGE_CALL_RE.test(message)) {
    return null;
  }

  // Se começou direto com "jorge, ..." limpa o vocativo inicial; mantém o resto intacto
  const cleaned = message.replace(/^[@!]?jorge\b[\s,:!?-]*/i, '').trim();
  const question = (cleaned || message).slice(0, 300);

  return { player, question };
}

export function formatChatReplyLines(rawReply, maxLineLen = 170, maxLines = 3) {
  const clean = String(rawReply || '')
    // Remove markdown básico para ficar legível no chat do Minecraft
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^#+\s*/gm, '')
    .replace(/[\r\n\t\0]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();

  if (!clean) return [];

  const words = clean.split(' ');
  const lines = [];
  let current = '';

  for (const w of words) {
    if (!current) {
      current = w.slice(0, maxLineLen);
    } else if (current.length + 1 + w.length <= maxLineLen) {
      current += ` ${w}`;
    } else {
      lines.push(current);
      if (lines.length >= maxLines) break;
      current = w.slice(0, maxLineLen);
    }
  }
  if (current && lines.length < maxLines) {
    lines.push(current);
  }
  return lines;
}

export function buildTellrawCommand(player, lineText, isFirstLine = true) {
  const safeText = String(lineText || '')
    .replace(/[\r\n\0]/g, ' ')
    .trim()
    .slice(0, 220);
  const safePlayer = String(player || '')
    .replace(/[^a-zA-Z0-9_.-]/g, '')
    .slice(0, 32);

  const components = [
    '',
    { text: '[Jorge] ', color: 'green', bold: true },
  ];
  if (isFirstLine && safePlayer) {
    components.push({ text: `@${safePlayer} `, color: 'gold' });
  }
  components.push({ text: safeText, color: 'white' });
  return `tellraw @a ${JSON.stringify(components)}`;
}

export function buildSayFallbackCommand(player, lineText, isFirstLine = true) {
  const safeText = String(lineText || '')
    .replace(/[\r\n\0]/g, ' ')
    .trim()
    .slice(0, 200);
  const safePlayer = String(player || '')
    .replace(/[^a-zA-Z0-9_.-]/g, '')
    .slice(0, 32);
  const prefix = isFirstLine && safePlayer ? `[Jorge] @${safePlayer}: ` : '[Jorge] ';
  return `say ${prefix}${safeText}`;
}

export function createInGameChatBridge({
  docker,
  containerName,
  ai,
  sendMcCommand,
  getWorldContext = null,
  cooldownMs = 6000,
}) {
  let stopStreamFn = null;
  let reconnectTimer = null;
  let stopped = false;
  let connected = false;
  let inFlight = false;
  const lastPlayerAt = new Map();
  let totalAnswered = 0;
  let lastPlayer = null;
  let lastQuestionAt = null;
  let lastError = null;
  let startedAtMs = Date.now();

  async function broadcastReply(player, replyText) {
    const lines = formatChatReplyLines(replyText, 165, 3);
    for (let i = 0; i < lines.length; i += 1) {
      const tellrawCmd = buildTellrawCommand(player, lines[i], i === 0);
      try {
        const out = await sendMcCommand(tellrawCmd);
        // Se o motor reclamar de sintaxe do tellraw, cai para say
        if (/unknown|invalid|error|usage:/i.test(out || '')) {
          await sendMcCommand(buildSayFallbackCommand(player, lines[i], i === 0));
        }
      } catch {
        try {
          await sendMcCommand(buildSayFallbackCommand(player, lines[i], i === 0));
        } catch {
          // ignore
        }
      }
    }
  }

  async function handleLine(line) {
    // Evita responder a linha residual do tail=1 nos primeiros 2s após conectar
    if (Date.now() - startedAtMs < 2000) return;

    const parsed = parseMinecraftChatLine(line);
    if (!parsed) return;

    const status = ai.getPublicStatus('viewer');
    if (!status.configured || !status.inGameChatEnabled) return;

    const now = Date.now();
    const key = parsed.player.toLowerCase();
    const prev = lastPlayerAt.get(key) || 0;
    if (now - prev < cooldownMs) return;
    if (inFlight) return;

    lastPlayerAt.set(key, now);
    inFlight = true;
    try {
      let worldContext = null;
      if (typeof getWorldContext === 'function') {
        try {
          worldContext = await getWorldContext(parsed.player);
        } catch {
          worldContext = null;
        }
      }
      const res = await ai.chatInGame({
        player: parsed.player,
        question: parsed.question,
        worldContext,
      });
      if (res?.reply) {
        await broadcastReply(parsed.player, res.reply);
        totalAnswered += 1;
        lastPlayer = parsed.player;
        lastQuestionAt = new Date().toISOString();
        lastError = null;
      }
    } catch (err) {
      lastError = err.message;
      console.error(`[YacaCode In-Game AI] Erro ao responder @${parsed.player}: ${err.message}`);
    } finally {
      inFlight = false;
    }
  }

  function scheduleReconnect() {
    if (stopped || reconnectTimer) return;
    connected = false;
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
      connected = true;
      stopStreamFn = await docker.streamContainerLogs(containerName, {
        tail: 1,
        onLine: (line) => {
          handleLine(line);
        },
        onEnd: () => {
          connected = false;
          scheduleReconnect();
        },
        onError: () => {
          connected = false;
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
    connected = false;
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
      connected,
      totalAnswered,
      lastPlayer,
      lastQuestionAt,
      lastError,
      triggers: ['Jorge', 'jorge'],
    };
  }

  return {
    start,
    stop,
    getStats,
    // Exposto para testes unitários
    _handleLineForTest: handleLine,
  };
}
