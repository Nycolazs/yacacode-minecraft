// ============================================================================
// YacaCode Minecraft Admin Panel — Frontend Controller (Zero-bloat ES Module)
// ============================================================================

const TAB_META = {
  overview: { title: 'Visão Geral', subtitle: 'Monitoramento 24/7 do servidor YacaCode' },
  ai: { title: 'Assistente IA', subtitle: 'Chat inteligente Gemini com consultas ao vivo e comandos no servidor' },
  whatsapp: { title: 'WhatsApp IA', subtitle: 'Avisos automáticos de backup/status e perguntas no grupo ou privado' },
  console: { title: 'Console ao Vivo', subtitle: 'Logs em tempo real via Docker SSE + comandos RCON' },
  players: { title: 'Jogadores', subtitle: 'Gerencie jogadores Java & Bedrock, Whitelist, OPs e Banimentos' },
  settings: { title: 'Configurações', subtitle: 'Presets Orange Pi 4GB + GeyserMC e editor de server.properties' },
  plugins: { title: 'Plugins & Crossplay', subtitle: 'GeyserMC, Floodgate, Chunky e upload de plugins .jar' },
  files: { title: 'Arquivos', subtitle: 'Explore e edite configurações dentro do volume /data' },
  backups: { title: 'Backups', subtitle: 'Backups seguros coordenados via RCON com retenção automática' },
  network: { title: 'Domínio & Cloudflare', subtitle: 'Status do Cloudflare Tunnel, DDNS automático e portas' },
  users: { title: 'Usuários do Painel', subtitle: 'Controle quem pode acessar este painel e quais ações pode executar' },
};

const ROLE_LABELS = {
  admin: 'Administrador',
  moderator: 'Moderador',
  viewer: 'Visualizador',
};

const state = {
  activeTab: 'overview',
  currentUser: null,
  overview: null,
  currentDir: '',
  editingPath: null,
  sse: null,
  consoleLines: [],
  cmdHistory: [],
  cmdHistoryIdx: -1,
  pollTimer: null,
  aiStatus: null,
  aiConversations: [],
  aiActiveConversationId: null,
  aiMessages: [],
  aiSending: false,
  aiSyncSse: null,
  aiSyncReconnectTimer: null,
  aiThinkingPhase: 0,
  aiThinkingTimer: null,
  aiLastAnimatedIdx: -1,
  gdriveStatus: null,
  gdProgressTimer: null,
  gdWasActive: false,
  waStatus: null,
  waGroups: [],
  waPollTimer: null,
};

const TAB_ORDER = ['overview', 'ai', 'whatsapp', 'console', 'players', 'settings', 'plugins', 'files', 'backups', 'network', 'users'];
const AI_THINKING_PHRASES = [
  'Pensando...',
  'Consultando o servidor...',
  'Verificando dados ao vivo...',
  'Preparando resposta...',
];

// ----------------------------------------------------------------------------
// HELPERS
// ----------------------------------------------------------------------------
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatBytes(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

function formatUptime(startedAt) {
  if (!startedAt || startedAt.startsWith('0001-')) return 'Parado';
  const diffSec = Math.max(0, Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000));
  const d = Math.floor(diffSec / 86400);
  const h = Math.floor((diffSec % 86400) / 3600);
  const m = Math.floor((diffSec % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function formatDate(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

function toast(message, type = 'ok') {
  const box = $('#toast-container');
  const el = document.createElement('div');
  el.className = `toast ${type === 'error' ? 'toast-error' : type === 'warn' ? 'toast-warn' : ''}`;
  el.textContent = message;
  box.appendChild(el);
  setTimeout(() => {
    el.style.opacity = '0';
    el.style.transition = 'opacity 250ms ease';
    setTimeout(() => el.remove(), 260);
  }, 4200);
}

async function api(path, options = {}) {
  const headers = {
    'X-Requested-With': 'YacaCodePanel',
    ...(options.headers || {}),
  };
  let body = options.body;
  if (body && typeof body === 'object' && !(body instanceof ArrayBuffer) && !(body instanceof Uint8Array)) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(body);
  }
  const res = await fetch(path, { ...options, headers, body, credentials: 'same-origin' });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && !path.includes('/api/auth/')) {
      showLogin();
    }
    throw new Error(data.error || `Erro HTTP ${res.status}`);
  }
  return data;
}

// ----------------------------------------------------------------------------
// MODAIS NATIVOS <dialog> (modern-web-guidance)
// ----------------------------------------------------------------------------
function confirmDialog(title, message, confirmLabel = 'Confirmar', danger = true) {
  return new Promise((resolve) => {
    const dialog = $('#confirm-dialog');
    $('#confirm-title').textContent = title;
    $('#confirm-message').textContent = message;
    const okBtn = $('#confirm-ok-btn');
    okBtn.textContent = confirmLabel;
    okBtn.className = danger ? 'btn btn-danger' : 'btn btn-primary';

    const onClose = () => {
      const val = dialog.returnValue;
      dialog.returnValue = '';
      dialog.removeEventListener('close', onClose);
      resolve(val === 'confirm');
    };
    dialog.addEventListener('close', onClose);
    dialog.showModal();
  });
}

function promptDialog(title, message, placeholder = '', defaultValue = '') {
  return new Promise((resolve) => {
    const dialog = $('#prompt-dialog');
    $('#prompt-title').textContent = title;
    $('#prompt-message').textContent = message;
    const input = $('#prompt-input');
    input.placeholder = placeholder;
    input.value = defaultValue;

    const onClose = () => {
      const val = dialog.returnValue;
      dialog.returnValue = '';
      dialog.removeEventListener('close', onClose);
      resolve(val === 'confirm' ? input.value.trim() : null);
    };
    dialog.addEventListener('close', onClose);
    dialog.showModal();
    input.focus();
  });
}

// ----------------------------------------------------------------------------
// DARK MODE TOGGLE (Seguindo modern-web-guidance dark-mode-toggle)
// ----------------------------------------------------------------------------
const COLOR_SCHEME_KEY = 'yacacode-panel-color-scheme';

function getSystemScheme() {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function getEffectiveScheme() {
  const stored = localStorage.getItem(COLOR_SCHEME_KEY);
  return stored === 'light' || stored === 'dark' ? stored : getSystemScheme();
}

function applyMetaColorScheme(value) {
  const meta = document.querySelector('meta[name="color-scheme"]');
  if (meta) meta.content = value || 'light dark';
}

function toggleColorScheme() {
  const target = getEffectiveScheme() === 'dark' ? 'light' : 'dark';
  try {
    if (target === getSystemScheme()) {
      localStorage.removeItem(COLOR_SCHEME_KEY);
      applyMetaColorScheme('light dark');
    } else {
      localStorage.setItem(COLOR_SCHEME_KEY, target);
      applyMetaColorScheme(target);
    }
  } catch {
    applyMetaColorScheme(target);
  }
}

window.addEventListener('storage', (e) => {
  if (e.key === COLOR_SCHEME_KEY) {
    applyMetaColorScheme(e.newValue === 'light' || e.newValue === 'dark' ? e.newValue : 'light dark');
  }
});

// ----------------------------------------------------------------------------
// AUTENTICAÇÃO & SHELL
// ----------------------------------------------------------------------------
function showLogin() {
  stopPolling();
  stopGdriveProgressPolling();
  stopWhatsAppPolling();
  disconnectSse();
  disconnectAiSync();
  state.aiConversations = [];
  state.aiActiveConversationId = null;
  state.aiMessages = [];
  $('#app-shell').classList.add('hidden');
  $('#login-screen').classList.remove('hidden');
  $('#login-pass').value = '';
}

function showApp(authData) {
  state.currentUser = authData;
  $('#login-screen').classList.add('hidden');
  $('#app-shell').classList.remove('hidden');

  if (authData.brand) {
    $('#brand-name').textContent = authData.brand.name;
    $('#brand-edition').textContent = `Minecraft ${authData.brand.mcVersion} Crossplay`;
    $('#hero-server-name').textContent = `${authData.brand.name} Minecraft`;
  }
  if (authData.viaCloudflare) {
    const badge = $('#topbar-cf-badge');
    badge.classList.remove('hidden');
    badge.textContent = authData.cfEmail ? `CF Zero Trust (${authData.cfEmail})` : 'Cloudflare Tunnel';
  }

  // Exibe usuário logado e adapta visibilidade por cargo (RBAC)
  const role = authData.role || 'viewer';
  $('#sidebar-user-name').textContent = authData.displayName || authData.username || 'admin';
  const roleBadge = $('#sidebar-user-role');
  roleBadge.textContent = ROLE_LABELS[role] || role;
  roleBadge.className = `pill ${role === 'admin' ? 'pill-accent' : role === 'moderator' ? 'pill-info' : 'pill-muted'}`;

  const isAdmin = role === 'admin';
  const isMod = role === 'admin' || role === 'moderator';
  const setTabVis = (tabName, visible) => {
    const btn = document.querySelector(`.nav-item[data-tab="${tabName}"]`);
    if (btn && btn.parentElement) btn.parentElement.classList.toggle('hidden', !visible);
  };
  setTabVis('console', isMod);
  setTabVis('whatsapp', isAdmin);
  setTabVis('files', isAdmin);
  setTabVis('settings', isAdmin);
  setTabVis('plugins', isAdmin);
  // Na aba users, não-admins ainda podem ver a seção para alterar a própria senha
  const createCard = $('#create-user-form')?.closest('.card');
  const listCard = $('#users-tbody')?.closest('.card');
  if (createCard) createCard.classList.toggle('hidden', !isAdmin);
  if (listCard) listCard.classList.toggle('hidden', !isAdmin);

  loadOverview();
  loadAiConversations(true);
  connectAiSync();
  if (isAdmin) {
    loadUsers();
    loadWhatsAppStatus(true);
  }
  startPolling();

  // Tratar retorno do OAuth do Google Drive (?tab=backups&gdrive=connected|error)
  try {
    const params = new URLSearchParams(window.location.search);
    const reqTab = params.get('tab');
    const gdState = params.get('gdrive');
    const gdMsg = params.get('msg');
    if (reqTab && TAB_META[reqTab]) {
      switchTab(reqTab);
    }
    if (gdState === 'connected') {
      toast('Google Drive conectado com sucesso! Backup na nuvem pronto.');
    } else if (gdState === 'error') {
      toast(gdMsg || 'Não foi possível concluir a conexão com o Google Drive.', 'error');
    }
    if (reqTab || gdState) {
      window.history.replaceState({}, document.title, window.location.pathname);
    }
  } catch {
    // ignore
  }
}

async function bootstrap() {
  try {
    const me = await api('/api/auth/me');
    if (me.viaCloudflare) {
      $('#login-cf-pill').classList.remove('hidden');
      if (me.cfEmail) {
        $('#login-cf-text').textContent = `Cloudflare Access ativo (${me.cfEmail})`;
      }
    }
    if (me.authenticated) {
      showApp(me);
    } else {
      showLogin();
    }
  } catch {
    showLogin();
  }
}

// ----------------------------------------------------------------------------
// NAVEGAÇÃO ENTRE ABAS
// ----------------------------------------------------------------------------
function switchTab(tab) {
  if (!TAB_META[tab]) return;
  const prevTab = state.activeTab;
  const prevIdx = TAB_ORDER.indexOf(prevTab);
  const nextIdx = TAB_ORDER.indexOf(tab);
  const dirUp = prevIdx >= 0 && nextIdx >= 0 && nextIdx < prevIdx;
  state.activeTab = tab;

  $$('.nav-item').forEach((btn) => btn.classList.toggle('active', btn.dataset.tab === tab));
  $$('.mobile-nav-btn[data-tab]').forEach((btn) => btn.classList.toggle('active', btn.dataset.tab === tab));
  $$('.tab-panel').forEach((panel) => {
    const isTarget = panel.id === `tab-${tab}`;
    panel.classList.remove('active', 'tab-dir-up');
    if (isTarget) {
      // Reinicia a animação CSS limpa ao alternar de tela
      void panel.offsetWidth;
      if (dirUp) panel.classList.add('tab-dir-up');
      panel.classList.add('active');
    }
  });

  const titleEl = $('#page-title');
  const subEl = $('#page-subtitle');
  titleEl.textContent = TAB_META[tab].title;
  subEl.textContent = TAB_META[tab].subtitle;
  if (prevTab !== tab) {
    titleEl.classList.remove('topbar-title-swap');
    subEl.classList.remove('topbar-title-swap');
    void titleEl.offsetWidth;
    titleEl.classList.add('topbar-title-swap');
    subEl.classList.add('topbar-title-swap');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  closeMobileSidebar();

  if (tab === 'overview') loadOverview();
  if (tab === 'ai') {
    loadAiStatus();
    loadAiConversations(false);
    connectAiSync();
  }
  if (tab === 'whatsapp') loadWhatsAppStatus();
  if (tab === 'console') {
    connectSse();
    startConsoleMetrics();
  } else {
    stopConsoleMetrics();
  }
  if (tab === 'players') loadPlayers();
  if (tab === 'settings') {
    loadProperties();
    loadJvmArgs();
  }
  if (tab === 'plugins') loadPlugins();
  if (tab === 'files') loadFiles(state.currentDir);
  if (tab === 'backups') loadBackups();
  if (tab === 'network') loadNetwork(false);
  if (tab === 'users') loadUsers();
}

function openMobileSidebar() {
  $('#sidebar').classList.add('open');
  $('#sidebar-overlay').classList.remove('hidden');
}

function closeMobileSidebar() {
  $('#sidebar').classList.remove('open');
  $('#sidebar-overlay').classList.add('hidden');
}

// ----------------------------------------------------------------------------
// TAB 1: VISÃO GERAL & GRÁFICO SVG
// ----------------------------------------------------------------------------
function startPolling() {
  stopPolling();
  state.pollTimer = setInterval(() => {
    if (state.activeTab === 'overview') loadOverview();
  }, 10000);
}

function stopPolling() {
  if (state.pollTimer) {
    clearInterval(state.pollTimer);
    state.pollTimer = null;
  }
}

async function loadOverview() {
  try {
    const data = await api('/api/overview');
    state.overview = data;
    renderOverview(data);
  } catch (err) {
    toast(`Erro ao carregar visão geral: ${err.message}`, 'error');
  }
}

function renderOverview(data) {
  const { server, connection, host, stack, history } = data;
  const running = Boolean(server.container?.running);
  const mcOnline = Boolean(server.ping?.online);

  // Status principal
  const heroPill = $('#hero-status-pill');
  const sideDot = $('#sidebar-status-dot');
  const sideLabel = $('#sidebar-status-label');

  if (running && mcOnline) {
    heroPill.className = 'pill pill-ok';
    heroPill.textContent = '● Online';
    sideDot.className = 'dot dot-ok';
    sideLabel.textContent = 'Online';
  } else if (running) {
    heroPill.className = 'pill pill-warn';
    heroPill.textContent = '● Iniciando...';
    sideDot.className = 'dot dot-warn';
    sideLabel.textContent = 'Iniciando...';
  } else {
    heroPill.className = 'pill pill-danger';
    heroPill.textContent = '● Offline';
    sideDot.className = 'dot dot-danger';
    sideLabel.textContent = 'Offline';
  }

  $('#sidebar-uptime').textContent = running
    ? `Uptime: ${formatUptime(server.container.startedAt)} • ${host.arch.toUpperCase()}`
    : `${host.arch.toUpperCase()} • ${formatBytes(host.memory.totalBytes)} RAM`;

  $('#hero-meta').textContent = `${server.runningVersion} • Java 25 Compact Headers • Uptime ${formatUptime(
    server.container?.startedAt
  )}`;

  // Conexão Java & Bedrock
  const javaAddr =
    connection.javaPort && connection.javaPort !== 25565
      ? `${connection.mcDomain}:${connection.javaPort}`
      : connection.mcDomain;
  $('#conn-java-addr').textContent = javaAddr;
  $('#conn-java-port-note').textContent = `Porta ${connection.javaPort} (TCP) • Minecraft ${server.configuredVersion}`;

  $('#conn-bedrock-addr').textContent = connection.mcDomain;
  $('#conn-bedrock-port-note').innerHTML = `Porta: <strong>${connection.bedrockPort}</strong> (TCP + UDP NetherNet) • Sem conta Java via Floodgate`;

  // KPIs
  $('#kpi-players').textContent = `${server.players.online} / ${server.players.max}`;
  $('#kpi-players-sub').textContent = `${server.players.javaCount} Java • ${server.players.bedrockCount} Bedrock`;
  $('#nav-players-badge').textContent = String(server.players.online);

  if (server.tps) {
    $('#kpi-tps').textContent = `${server.tps.tps1m.toFixed(1)} TPS`;
    $('#kpi-tps-sub').textContent = `5m: ${server.tps.tps5m.toFixed(1)} • Ping: ${server.ping?.latencyMs ?? '--'} ms`;
  } else {
    $('#kpi-tps').textContent = mcOnline ? '20.0*' : '--';
    $('#kpi-tps-sub').textContent = mcOnline
      ? `Latência interna: ${server.ping?.latencyMs ?? '--'} ms`
      : 'Servidor offline';
  }

  // RAM MC
  if (server.stats) {
    const usedMB = Math.round(server.stats.memUsedBytes / (1024 * 1024));
    const limitMB = Math.round(server.stats.memLimitBytes / (1024 * 1024));
    $('#kpi-mc-ram').textContent = `${usedMB} MB`;
    $('#kpi-mc-ram-sub').textContent = `de ${limitMB} MB (${server.stats.memPercent}%)`;
    setBar('#bar-mc-ram', server.stats.memPercent);
  } else {
    $('#kpi-mc-ram').textContent = '0 MB';
    $('#kpi-mc-ram-sub').textContent = 'Container parado';
    setBar('#bar-mc-ram', 0);
  }

  // RAM Host Orange Pi
  $('#kpi-host-ram').textContent = `${host.memory.percent}%`;
  $('#kpi-host-ram-sub').textContent = `${formatBytes(host.memory.usedBytes)} / ${formatBytes(
    host.memory.totalBytes
  )}${host.memory.swapTotalBytes > 0 ? ` • Swap ${host.memory.swapPercent}%` : ''}`;
  setBar('#bar-host-ram', host.memory.percent);

  // Temperatura & CPU
  const tempC = host.temperature?.celsius;
  const tempBadge = $('#topbar-temp-badge');
  if (tempC !== null && tempC !== undefined) {
    $('#kpi-temp').textContent = `${tempC}°C`;
    tempBadge.classList.remove('hidden');
    tempBadge.textContent = `🌡 ${tempC}°C`;
    tempBadge.className = `pill ${
      host.temperature.status === 'critical'
        ? 'pill-danger'
        : host.temperature.status === 'warm'
        ? 'pill-warn'
        : 'pill-ok'
    }`;
  } else {
    $('#kpi-temp').textContent = `${server.stats?.cpuPercent ?? 0}% CPU`;
    tempBadge.classList.add('hidden');
  }
  $('#kpi-cpu-sub').textContent = `CPU MC: ${server.stats?.cpuPercent ?? 0}% • Load: ${host.loadAvg[0]}`;

  // Disco
  if (host.disk) {
    $('#kpi-disk').textContent = `${host.disk.percent}%`;
    $('#kpi-disk-sub').textContent = `Livre: ${formatBytes(host.disk.freeBytes)} (${server.backupCount} backups)`;
    setBar('#bar-disk', host.disk.percent);
  }

  // Stack 24/7
  const stackEl = $('#stack-list');
  stackEl.innerHTML = stack
    .map((svc) => {
      const dotClass = svc.running ? 'dot-ok' : svc.exists ? 'dot-danger' : 'dot-warn';
      const pillClass = svc.running ? 'pill-ok' : svc.exists ? 'pill-danger' : 'pill-muted';
      const label = svc.running ? 'Ativo' : svc.exists ? svc.state : 'Perfil inativo';
      return `
        <li class="stack-item">
          <div class="stack-item-left">
            <span class="dot ${dotClass}" aria-hidden="true"></span>
            <div>
              <strong>${escapeHtml(svc.label)}</strong>
              <small>${escapeHtml(svc.container)}${svc.running ? ` • ${formatUptime(svc.startedAt)}` : ''}</small>
            </div>
          </div>
          <span class="pill ${pillClass}">${escapeHtml(label)}</span>
        </li>
      `;
    })
    .join('');

  renderTelemetryChart(history || [], server.stats, host);
}

function setBar(selector, percent) {
  const el = $(selector);
  const clamped = Math.min(100, Math.max(0, Number(percent) || 0));
  el.style.width = `${clamped}%`;
  el.classList.remove('warn', 'danger');
  if (clamped >= 88) el.classList.add('danger');
  else if (clamped >= 72) el.classList.add('warn');
}

function buildSmoothSvgPath(coords) {
  if (!coords.length) return '';
  if (coords.length === 1) return `M ${coords[0].x.toFixed(1)},${coords[0].y.toFixed(1)}`;
  let d = `M ${coords[0].x.toFixed(1)},${coords[0].y.toFixed(1)}`;
  for (let i = 0; i < coords.length - 1; i += 1) {
    const p0 = coords[i];
    const p1 = coords[i + 1];
    const cpx = ((p0.x + p1.x) / 2).toFixed(1);
    d += ` C ${cpx},${p0.y.toFixed(1)} ${cpx},${p1.y.toFixed(1)} ${p1.x.toFixed(1)},${p1.y.toFixed(1)}`;
  }
  return d;
}

function formatShortTime(ts) {
  if (!ts) return '';
  try {
    return new Date(ts).toLocaleTimeString('pt-BR', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch {
    return '';
  }
}

function renderTelemetryChart(rawPoints, liveStats = null, host = null) {
  const svg = $('#telemetry-chart');
  const tooltip = $('#chart-tooltip');
  const w = 720;
  const h = 250;
  const padL = 42;
  const padR = 48;
  const padT = 18;
  const padB = 30;
  const plotW = w - padL - padR;
  const plotH = h - padT - padB;

  const cores = liveStats?.onlineCpus || host?.cpuCores || 4;
  const points = (rawPoints || []).map((p) => {
    // Normaliza amostras antigas caso tenham sido gravadas na escala 0-400%
    const rawCpu = Number(p.mcCpuPercent) || 0;
    const normCpu = rawCpu > 100 ? Math.min(100, Number((rawCpu / cores).toFixed(1))) : rawCpu;
    return {
      ts: p.ts,
      mcMemMB: Number(p.mcMemMB) || 0,
      mcCpuPercent: normCpu,
      tempC: p.tempC !== null && p.tempC !== undefined ? Number(p.tempC) : null,
      hostMemPercent: Number(p.hostMemPercent) || 0,
    };
  });

  // Atualiza pills da legenda e rodapé estatístico
  const last = points[points.length - 1] || null;
  const curMem = liveStats ? Math.round(liveStats.memUsedBytes / (1024 * 1024)) : last?.mcMemMB ?? 0;
  const curCpu = liveStats ? liveStats.cpuPercent : last?.mcCpuPercent ?? 0;
  const curTemp = host?.temperature?.celsius ?? last?.tempC ?? null;

  $('#legend-val-ram').textContent = `${curMem} MB`;
  $('#legend-val-cpu').textContent = `${curCpu.toFixed(1)}%`;
  $('#legend-val-temp').textContent = curTemp !== null ? `${curTemp.toFixed(1)}°C` : '--°C';

  if (points.length > 0) {
    const peakMem = Math.max(curMem, ...points.map((p) => p.mcMemMB));
    const avgCpu = points.reduce((acc, p) => acc + p.mcCpuPercent, 0) / points.length;
    const peakCpu = Math.max(curCpu, ...points.map((p) => p.mcCpuPercent));
    const temps = points.map((p) => p.tempC).filter((t) => t !== null && t > 0);
    const minTemp = temps.length ? Math.min(...temps) : curTemp;
    const maxTemp = temps.length ? Math.max(...temps) : curTemp;

    $('#tele-stat-ram').textContent = `${curMem} MB / Pico ${peakMem} MB`;
    $('#tele-stat-cpu').textContent = `Méd ${avgCpu.toFixed(1)}% / Pico ${peakCpu.toFixed(1)}%`;
    $('#tele-stat-temp').textContent =
      minTemp !== null && maxTemp !== null ? `${minTemp.toFixed(1)}°C – ${maxTemp.toFixed(1)}°C` : 'Sensor N/D';

    const spanSec = Math.max(10, Math.round(((points[points.length - 1].ts - points[0].ts) || 10000) / 1000));
    const spanLabel = spanSec >= 60 ? `${Math.round(spanSec / 60)} min` : `${spanSec}s`;
    $('#telemetry-window-label').textContent = `Janela ativa: ${points.length} amostras (${spanLabel}) • Orange Pi ${cores} núcleos ARM64`;
  }

  if (liveStats) {
    $('#tele-stat-net').textContent = `↓ ${formatBytes(liveStats.rxBytes)} / ↑ ${formatBytes(liveStats.txBytes)}`;
  } else {
    $('#tele-stat-net').textContent = '↓ 0 B / ↑ 0 B';
  }

  if (!points.length) {
    svg.innerHTML = `<text x="50%" y="50%" text-anchor="middle" fill="currentColor" opacity="0.45" font-size="13">Coletando telemetria...</text>`;
    return;
  }

  const limitMBFromContainer = liveStats?.memLimitBytes
    ? Math.round(liveStats.memLimitBytes / (1024 * 1024))
    : 768;
  const maxMemMB = Math.max(256, limitMBFromContainer);
  const stepX = points.length > 1 ? plotW / (points.length - 1) : 0;

  const memCoords = points.map((p, i) => ({
    x: padL + (points.length > 1 ? i * stepX : plotW / 2),
    y: padT + plotH - (Math.min(maxMemMB, p.mcMemMB) / maxMemMB) * plotH,
  }));

  const cpuCoords = points.map((p, i) => ({
    x: padL + (points.length > 1 ? i * stepX : plotW / 2),
    y: padT + plotH - (Math.min(100, p.mcCpuPercent) / 100) * plotH,
  }));

  const tempCoords = points
    .map((p, i) =>
      p.tempC !== null
        ? {
            x: padL + (points.length > 1 ? i * stepX : plotW / 2),
            y: padT + plotH - (Math.min(100, p.tempC) / 100) * plotH,
          }
        : null
    )
    .filter(Boolean);

  const fmtMemAxis = (mb) => (mb >= 1024 ? `${(mb / 1024).toFixed(1)}G` : `${Math.round(mb)}M`);
  const yTicks = [
    { ratio: 0, pctLabel: '100%', memLabel: fmtMemAxis(maxMemMB) },
    { ratio: 0.25, pctLabel: '75%', memLabel: fmtMemAxis(maxMemMB * 0.75) },
    { ratio: 0.5, pctLabel: '50%', memLabel: fmtMemAxis(maxMemMB * 0.5) },
    { ratio: 0.75, pctLabel: '25%', memLabel: fmtMemAxis(maxMemMB * 0.25) },
    { ratio: 1, pctLabel: '0%', memLabel: '0M' },
  ];

  const hGridSvg = yTicks
    .map((t) => {
      const y = (padT + t.ratio * plotH).toFixed(1);
      return `
        <line x1="${padL}" y1="${y}" x2="${w - padR}" y2="${y}" stroke="currentColor" stroke-opacity="${
        t.ratio === 1 ? '0.18' : '0.07'
      }" />
        <text x="${padL - 8}" y="${Number(y) + 4}" text-anchor="end" fill="currentColor" opacity="0.48" font-size="10.5" font-family="JetBrains Mono, monospace">${t.pctLabel}</text>
        <text x="${w - padR + 8}" y="${Number(y) + 4}" text-anchor="start" fill="#8ab840" opacity="0.75" font-size="10.5" font-family="JetBrains Mono, monospace">${t.memLabel}</text>
      `;
    })
    .join('');

  const guideMB = Math.round(maxMemMB * 0.8);
  const heapY = (padT + plotH - (guideMB / maxMemMB) * plotH).toFixed(1);
  const heapGuideSvg = `
    <line x1="${padL}" y1="${heapY}" x2="${w - padR}" y2="${heapY}" stroke="#8ab840" stroke-opacity="0.28" stroke-dasharray="3 4" />
    <text x="${padL + 6}" y="${Number(heapY) - 4}" fill="#8ab840" opacity="0.6" font-size="9.5" font-family="JetBrains Mono, monospace">Alvo ${fmtMemAxis(guideMB)}</text>
  `;

  // Eixo X com até 5 carimbos de tempo
  const xTickIndices = [];
  if (points.length === 1) {
    xTickIndices.push(0);
  } else {
    const count = Math.min(5, points.length);
    for (let i = 0; i < count; i += 1) {
      xTickIndices.push(Math.round((i * (points.length - 1)) / (count - 1)));
    }
  }
  const uniqueXIndices = [...new Set(xTickIndices)];
  const xGridSvg = uniqueXIndices
    .map((idx, pos) => {
      const x = memCoords[idx].x.toFixed(1);
      const label = pos === uniqueXIndices.length - 1 ? 'Agora' : formatShortTime(points[idx].ts);
      return `
        <line x1="${x}" y1="${padT}" x2="${x}" y2="${padT + plotH}" stroke="currentColor" stroke-opacity="0.04" />
        <text x="${x}" y="${h - 8}" text-anchor="middle" fill="currentColor" opacity="0.5" font-size="10.5" font-family="JetBrains Mono, monospace">${label}</text>
      `;
    })
    .join('');

  const memLinePath = buildSmoothSvgPath(memCoords);
  const cpuLinePath = buildSmoothSvgPath(cpuCoords);
  const tempLinePath = tempCoords.length > 1 ? buildSmoothSvgPath(tempCoords) : '';

  const firstX = memCoords[0].x.toFixed(1);
  const lastX = memCoords[memCoords.length - 1].x.toFixed(1);
  const baseY = (padT + plotH).toFixed(1);
  const memAreaPath = points.length > 1 ? `${memLinePath} L ${lastX},${baseY} L ${firstX},${baseY} Z` : '';
  const cpuAreaPath = points.length > 1 ? `${cpuLinePath} L ${lastX},${baseY} L ${firstX},${baseY} Z` : '';

  const lastMemPt = memCoords[memCoords.length - 1];
  const lastCpuPt = cpuCoords[cpuCoords.length - 1];
  const lastTempPt = tempCoords[tempCoords.length - 1] || null;

  svg.innerHTML = `
    <defs>
      <linearGradient id="ycMemGrad" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#8ab840" stop-opacity="0.42"/>
        <stop offset="85%" stop-color="#8ab840" stop-opacity="0.06"/>
        <stop offset="100%" stop-color="#8ab840" stop-opacity="0.0"/>
      </linearGradient>
      <linearGradient id="ycCpuGrad" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#f0c040" stop-opacity="0.18"/>
        <stop offset="100%" stop-color="#f0c040" stop-opacity="0.0"/>
      </linearGradient>
    </defs>
    ${hGridSvg}
    ${xGridSvg}
    ${heapGuideSvg}
    ${cpuAreaPath ? `<path d="${cpuAreaPath}" fill="url(#ycCpuGrad)" />` : ''}
    ${memAreaPath ? `<path d="${memAreaPath}" fill="url(#ycMemGrad)" />` : ''}
    ${tempLinePath ? `<path d="${tempLinePath}" fill="none" stroke="#38bdf8" stroke-width="1.8" stroke-opacity="0.85" stroke-linecap="round" />` : ''}
    <path d="${cpuLinePath}" fill="none" stroke="#f0c040" stroke-width="2.2" stroke-linecap="round" />
    <path d="${memLinePath}" fill="none" stroke="#8ab840" stroke-width="2.8" stroke-linecap="round" />

    <!-- Marcadores do ponto mais recente -->
    <circle cx="${lastMemPt.x.toFixed(1)}" cy="${lastMemPt.y.toFixed(1)}" r="6" fill="#8ab840" fill-opacity="0.25" />
    <circle cx="${lastMemPt.x.toFixed(1)}" cy="${lastMemPt.y.toFixed(1)}" r="3.5" fill="#8ab840" stroke="#0b0d09" stroke-width="1.5" />
    <circle cx="${lastCpuPt.x.toFixed(1)}" cy="${lastCpuPt.y.toFixed(1)}" r="3.2" fill="#f0c040" stroke="#0b0d09" stroke-width="1.5" />
    ${
      lastTempPt
        ? `<circle cx="${lastTempPt.x.toFixed(1)}" cy="${lastTempPt.y.toFixed(1)}" r="2.8" fill="#38bdf8" stroke="#0b0d09" stroke-width="1.2" />`
        : ''
    }

    <!-- Elementos interativos de Hover (Crosshair) -->
    <line id="svg-hover-line" x1="0" y1="${padT}" x2="0" y2="${padT + plotH}" stroke="currentColor" stroke-opacity="0.35" stroke-dasharray="3 3" visibility="hidden" />
    <circle id="svg-hover-mem" cx="0" cy="0" r="4.5" fill="#8ab840" stroke="#ffffff" stroke-width="1.8" visibility="hidden" />
    <circle id="svg-hover-cpu" cx="0" cy="0" r="4.5" fill="#f0c040" stroke="#ffffff" stroke-width="1.8" visibility="hidden" />
    <circle id="svg-hover-temp" cx="0" cy="0" r="4" fill="#38bdf8" stroke="#ffffff" stroke-width="1.5" visibility="hidden" />
  `;

  // Interatividade de Hover/Touch para inspecionar cada amostra
  svg.onpointermove = (e) => {
    const rect = svg.getBoundingClientRect();
    if (!rect.width) return;
    const relX = ((e.clientX - rect.left) / rect.width) * w;
    let closestIdx = 0;
    let bestDist = Infinity;
    for (let i = 0; i < memCoords.length; i += 1) {
      const d = Math.abs(memCoords[i].x - relX);
      if (d < bestDist) {
        bestDist = d;
        closestIdx = i;
      }
    }

    const pt = points[closestIdx];
    const mCoord = memCoords[closestIdx];
    const cCoord = cpuCoords[closestIdx];

    const hLine = svg.querySelector('#svg-hover-line');
    const hMem = svg.querySelector('#svg-hover-mem');
    const hCpu = svg.querySelector('#svg-hover-cpu');
    const hTemp = svg.querySelector('#svg-hover-temp');

    if (hLine) {
      hLine.setAttribute('x1', mCoord.x.toFixed(1));
      hLine.setAttribute('x2', mCoord.x.toFixed(1));
      hLine.setAttribute('visibility', 'visible');
    }
    if (hMem) {
      hMem.setAttribute('cx', mCoord.x.toFixed(1));
      hMem.setAttribute('cy', mCoord.y.toFixed(1));
      hMem.setAttribute('visibility', 'visible');
    }
    if (hCpu) {
      hCpu.setAttribute('cx', cCoord.x.toFixed(1));
      hCpu.setAttribute('cy', cCoord.y.toFixed(1));
      hCpu.setAttribute('visibility', 'visible');
    }
    if (hTemp) {
      if (pt.tempC !== null) {
        const ty = padT + plotH - (Math.min(100, pt.tempC) / 100) * plotH;
        hTemp.setAttribute('cx', mCoord.x.toFixed(1));
        hTemp.setAttribute('cy', ty.toFixed(1));
        hTemp.setAttribute('visibility', 'visible');
      } else {
        hTemp.setAttribute('visibility', 'hidden');
      }
    }

    if (tooltip) {
      tooltip.classList.remove('hidden');
      tooltip.innerHTML = `
        <div class="chart-tooltip-time">${formatShortTime(pt.ts)}</div>
        <div class="chart-tooltip-row"><span>● RAM MC:</span><strong style="color:#8ab840">${pt.mcMemMB} MB (${Math.round(
        (pt.mcMemMB / maxMemMB) * 100
      )}%)</strong></div>
        <div class="chart-tooltip-row"><span>● CPU Total:</span><strong style="color:#f0c040">${pt.mcCpuPercent.toFixed(
          1
        )}%</strong></div>
        <div class="chart-tooltip-row"><span>● Temp SoC:</span><strong style="color:#38bdf8">${
          pt.tempC !== null ? `${pt.tempC.toFixed(1)}°C` : 'N/D'
        }</strong></div>
      `;
      const isRightHalf = mCoord.x > w * 0.55;
      tooltip.style.left = isRightHalf ? '14px' : 'auto';
      tooltip.style.right = isRightHalf ? 'auto' : '14px';
    }
  };

  svg.onpointerleave = () => {
    ['#svg-hover-line', '#svg-hover-mem', '#svg-hover-cpu', '#svg-hover-temp'].forEach((sel) => {
      const el = svg.querySelector(sel);
      if (el) el.setAttribute('visibility', 'hidden');
    });
    if (tooltip) tooltip.classList.add('hidden');
  };
}

// ----------------------------------------------------------------------------
// TAB 2: CONSOLE AO VIVO (SSE + RCON)
// ----------------------------------------------------------------------------
function classifyLogLine(line) {
  if (/ERROR|FATAL|Exception|SEVERE/i.test(line)) return 'log-error';
  if (/WARN/i.test(line)) return 'log-warn';
  if (/Geyser|Floodgate/i.test(line)) return 'log-geyser';
  return '';
}

function appendConsoleLine(text, customClass = '') {
  state.consoleLines.push({ text, cls: customClass || classifyLogLine(text) });
  if (state.consoleLines.length > 1200) {
    state.consoleLines.splice(0, state.consoleLines.length - 1200);
  }
  renderConsoleLine(state.consoleLines[state.consoleLines.length - 1]);
}

function renderConsoleLine(entry) {
  const filter = ($('#console-filter').value || '').trim().toLowerCase();
  if (filter && !entry.text.toLowerCase().includes(filter)) return;
  const out = $('#console-output');
  const div = document.createElement('div');
  div.className = `log-line ${entry.cls}`;
  div.textContent = entry.text;
  out.appendChild(div);
  if ($('#console-autoscroll').checked) {
    out.scrollTop = out.scrollHeight;
  }
}

function rerenderConsole() {
  const out = $('#console-output');
  out.innerHTML = '';
  for (const entry of state.consoleLines) {
    renderConsoleLine(entry);
  }
}

function connectSse() {
  if (state.sse) return;
  $('#sse-dot').className = 'dot dot-warn';
  $('#sse-status').textContent = 'Conectando logs...';

  const sse = new EventSource('/api/console/stream?tail=220');
  state.sse = sse;

  sse.addEventListener('meta', (e) => {
    const info = JSON.parse(e.data);
    if (info.connected) {
      $('#sse-dot').className = 'dot dot-ok';
      $('#sse-status').textContent = `Conectado (${info.container})`;
    }
    if (info.reconnecting) {
      $('#sse-dot').className = 'dot dot-warn';
      $('#sse-status').textContent = 'Server reiniciando, reconectando...';
    }
    if (info.error) {
      $('#sse-dot').className = 'dot dot-danger';
      $('#sse-status').textContent = 'Erro no stream';
      appendConsoleLine(`[Painel] ${info.error}`, 'log-error');
    }
  });

  sse.addEventListener('log', (e) => {
    const { line } = JSON.parse(e.data);
    appendConsoleLine(line);
  });

  sse.onerror = () => {
    $('#sse-dot').className = 'dot dot-warn';
    $('#sse-status').textContent = 'Reconectando...';
  };
}

function disconnectSse() {
  if (state.sse) {
    state.sse.close();
    state.sse = null;
  }
}

async function sendConsoleCommand(command) {
  const clean = command.trim();
  if (!clean) return;
  state.cmdHistory.unshift(clean);
  if (state.cmdHistory.length > 50) state.cmdHistory.pop();
  state.cmdHistoryIdx = -1;

  appendConsoleLine(`> ${clean}`, 'log-cmd');
  try {
    const res = await api('/api/console/command', {
      method: 'POST',
      body: { command: clean },
    });
    if (res.output) {
      for (const line of res.output.split('\n')) {
        appendConsoleLine(line, 'log-sys');
      }
    }
  } catch (err) {
    appendConsoleLine(`[RCON Erro] ${err.message}`, 'log-error');
    toast(err.message, 'error');
  }
}

// ----------------------------------------------------------------------------
// TAB 3: JOGADORES
// ----------------------------------------------------------------------------
async function loadPlayers() {
  try {
    const data = await api('/api/players');
    $('#players-online-subtitle').textContent = `${data.online.length} de ${data.max} jogadores conectados`;

    const grid = $('#online-players-list');
    if (!data.online.length) {
      grid.innerHTML = `<p class="muted-text">Nenhum jogador conectado no momento.</p>`;
    } else {
      grid.innerHTML = data.online
        .map((p) => {
          const isBedrock = p.edition === 'bedrock';
          const skinName = isBedrock ? 'Steve' : encodeURIComponent(p.name);
          return `
            <div class="player-card">
              <div class="player-head">
                <img class="player-avatar" src="https://mc-heads.net/avatar/${skinName}/40" alt="" width="38" height="38" loading="lazy">
                <div>
                  <strong>${escapeHtml(p.name)}</strong>
                  <div><span class="edition-tag ${isBedrock ? 'edition-bedrock' : 'edition-java'}">${isBedrock ? 'BEDROCK' : 'JAVA'}</span></div>
                </div>
              </div>
              <div class="player-actions">
                <button type="button" class="btn btn-secondary btn-sm" data-paction="whisper" data-player="${escapeHtml(p.name)}">Msg</button>
                <button type="button" class="btn btn-secondary btn-sm" data-paction="op" data-player="${escapeHtml(p.name)}">OP</button>
                <button type="button" class="btn btn-ghost btn-sm" data-paction="kick" data-player="${escapeHtml(p.name)}">Kick</button>
                <button type="button" class="btn btn-danger-outline btn-sm" data-paction="ban" data-player="${escapeHtml(p.name)}">Ban</button>
              </div>
            </div>
          `;
        })
        .join('');
    }

    // Whitelist state
    $('#whitelist-state-label').textContent = data.whitelistEnabled ? 'Ativada (Privado)' : 'Desativada (Aberto)';
    const toggleBtn = $('#btn-toggle-whitelist');
    toggleBtn.textContent = data.whitelistEnabled ? 'Desativar' : 'Ativar';
    toggleBtn.dataset.nextState = data.whitelistEnabled ? 'whitelist-off' : 'whitelist-on';

    renderEntityList('#whitelist-list', data.whitelist, 'whitelist-remove', 'Nenhum jogador na whitelist.');
    renderEntityList('#ops-list', data.ops, 'deop', 'Nenhum operador cadastrado.');
    renderEntityList('#bans-list', data.bannedPlayers, 'pardon', 'Nenhum jogador banido.');
  } catch (err) {
    toast(`Erro ao carregar jogadores: ${err.message}`, 'error');
  }
}

function renderEntityList(selector, items, removeAction, emptyText) {
  const ul = $(selector);
  if (!items || !items.length) {
    ul.innerHTML = `<li class="muted-text">${emptyText}</li>`;
    return;
  }
  ul.innerHTML = items
    .map((item) => {
      const name = item.name || item;
      const btnLabel = removeAction === 'pardon' ? 'Desbanir' : 'Remover';
      return `
        <li class="entity-item">
          <span>${escapeHtml(name)}</span>
          <button type="button" class="btn btn-ghost btn-sm" data-paction="${removeAction}" data-player="${escapeHtml(name)}">${btnLabel}</button>
        </li>
      `;
    })
    .join('');
}

async function runPlayerAction(action, player, extra = {}) {
  try {
    const res = await api('/api/players/action', {
      method: 'POST',
      body: { action, player, ...extra },
    });
    toast(res.output || `Ação "${action}" executada.`);
    loadPlayers();
  } catch (err) {
    toast(err.message, 'error');
  }
}

// ----------------------------------------------------------------------------
// TAB 4: CONFIGURAÇÕES
// ----------------------------------------------------------------------------
async function loadProperties() {
  try {
    const { exists, properties } = await api('/api/properties');
    if (!exists) {
      toast('server.properties ainda será gerado no 1º boot do servidor.', 'warn');
    }
    $$('[data-prop]').forEach((input) => {
      const key = input.dataset.prop;
      if (properties[key] !== undefined) {
        input.value = properties[key];
      }
    });
  } catch (err) {
    toast(`Erro ao ler server.properties: ${err.message}`, 'error');
  }
}

async function saveProperties() {
  const updates = {};
  $$('[data-prop]').forEach((input) => {
    updates[input.dataset.prop] = input.value;
  });
  try {
    await api('/api/properties', { method: 'PUT', body: { properties: updates } });
    toast('server.properties salvo! Reinicie o servidor para aplicar.');
  } catch (err) {
    toast(err.message, 'error');
  }
}

// ----------------------------------------------------------------------------
// TAB 5: PLUGINS
// ----------------------------------------------------------------------------
async function loadPlugins() {
  try {
    const data = await api('/api/plugins');
    const geyserOn = data.plugins.some((p) => /geyser/i.test(p.fileName) && p.enabled);
    const chunkyOn = data.plugins.some((p) => /chunky/i.test(p.fileName) && p.enabled);

    $('#crossplay-checklist').innerHTML = [
      { label: 'GeyserMC (Ponte Bedrock → Java)', ok: geyserOn },
      { label: 'Floodgate (Login Bedrock sem conta Java)', ok: data.floodgateInstalled },
      { label: 'Configuração Geyser gerada (config.yml)', ok: data.geyserConfigured },
      { label: 'Chunky (Pré-geração anti-lag Orange Pi)', ok: chunkyOn },
    ]
      .map(
        (item) => `
        <li>
          <span>${item.label}</span>
          <span class="pill ${item.ok ? 'pill-ok' : 'pill-warn'}">${item.ok ? 'Ativo' : 'Pendente'}</span>
        </li>
      `
      )
      .join('');

    $('#plugins-count-label').textContent = `${data.plugins.length} plugin(s) encontrado(s)`;
    const tbody = $('#plugins-tbody');
    if (!data.plugins.length) {
      tbody.innerHTML = `<tr><td colspan="5" class="muted-text">Nenhum plugin instalado ainda. Inicie o servidor para baixar Geyser, Floodgate e Chunky automaticamente.</td></tr>`;
      return;
    }

    tbody.innerHTML = data.plugins
      .map(
        (p) => `
        <tr>
          <td>
            <strong>${escapeHtml(p.displayName)}</strong>
            ${p.isCoreCrossplay ? ' <span class="pill pill-accent">Crossplay</span>' : ''}
          </td>
          <td><span class="pill ${p.enabled ? 'pill-ok' : 'pill-muted'}">${p.enabled ? 'Ativo' : 'Desativado'}</span></td>
          <td>${formatBytes(p.size)}</td>
          <td>${formatDate(p.mtime)}</td>
          <td class="text-right">
            <div class="row-actions">
              <button type="button" class="btn btn-secondary btn-sm" data-plugin-toggle="${escapeHtml(p.fileName)}">${
          p.enabled ? 'Desativar' : 'Ativar'
        }</button>
              <button type="button" class="btn btn-danger-outline btn-sm" data-plugin-del="${escapeHtml(p.fileName)}">Excluir</button>
            </div>
          </td>
        </tr>
      `
      )
      .join('');
  } catch (err) {
    toast(`Erro ao carregar plugins: ${err.message}`, 'error');
  }
}

async function uploadPluginFile(file) {
  if (!file) return;
  if (!file.name.toLowerCase().endsWith('.jar')) {
    toast('Envie apenas arquivos .jar.', 'error');
    return;
  }
  const statusEl = $('#plugin-upload-status');
  statusEl.textContent = `Enviando ${file.name} (${formatBytes(file.size)})...`;
  try {
    const buf = await file.arrayBuffer();
    await api(`/api/plugins/upload?name=${encodeURIComponent(file.name)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: buf,
    });
    statusEl.textContent = `Plugin ${file.name} enviado! Reinicie o servidor para carregar.`;
    toast(`Plugin ${file.name} instalado com sucesso!`);
    loadPlugins();
  } catch (err) {
    statusEl.textContent = err.message;
    toast(err.message, 'error');
  }
}

// ----------------------------------------------------------------------------
// TAB 6: GERENCIADOR DE ARQUIVOS
// ----------------------------------------------------------------------------
async function loadFiles(dirPath = '') {
  try {
    const data = await api(`/api/files?path=${encodeURIComponent(dirPath)}`);
    state.currentDir = data.path;

    // Breadcrumb
    const bc = $('#files-breadcrumb');
    const parts = data.path ? data.path.split('/').filter(Boolean) : [];
    let acc = '';
    const crumbs = [`<button type="button" data-dir="">/data</button>`];
    for (const part of parts) {
      acc = acc ? `${acc}/${part}` : part;
      crumbs.push(`<span>/</span><button type="button" data-dir="${escapeHtml(acc)}">${escapeHtml(part)}</button>`);
    }
    bc.innerHTML = crumbs.join('');

    const tbody = $('#files-tbody');
    if (!data.entries.length) {
      tbody.innerHTML = `<tr><td colspan="4" class="muted-text">Pasta vazia.</td></tr>`;
      return;
    }

    tbody.innerHTML = data.entries
      .map((entry) => {
        const icon = entry.isDirectory ? '📁' : entry.editable ? '📄' : '📦';
        const openAttr = entry.isDirectory
          ? `data-open-dir="${escapeHtml(entry.path)}"`
          : entry.editable
          ? `data-edit-file="${escapeHtml(entry.path)}"`
          : '';
        return `
          <tr>
            <td>
              ${
                openAttr
                  ? `<button type="button" class="file-link-btn" ${openAttr}>${icon} ${escapeHtml(entry.name)}</button>`
                  : `<span>${icon} ${escapeHtml(entry.name)}</span>`
              }
            </td>
            <td>${entry.isDirectory ? '—' : formatBytes(entry.size)}</td>
            <td>${formatDate(entry.mtime)}</td>
            <td class="text-right">
              <div class="row-actions">
                ${
                  entry.editable
                    ? `<button type="button" class="btn btn-secondary btn-sm" data-edit-file="${escapeHtml(entry.path)}">Editar</button>`
                    : ''
                }
                ${
                  !entry.isDirectory
                    ? `<a class="btn btn-ghost btn-sm" href="/api/files/download?path=${encodeURIComponent(entry.path)}">Baixar</a>`
                    : ''
                }
                <button type="button" class="btn btn-danger-outline btn-sm" data-del-file="${escapeHtml(entry.path)}">Excluir</button>
              </div>
            </td>
          </tr>
        `;
      })
      .join('');
  } catch (err) {
    toast(`Erro ao listar arquivos: ${err.message}`, 'error');
  }
}

async function openFileEditor(relPath) {
  try {
    const file = await api(`/api/files/content?path=${encodeURIComponent(relPath)}`);
    state.editingPath = file.path;
    $('#editor-title').textContent = file.path.split('/').pop();
    $('#editor-path').textContent = `/data/${file.path}`;
    $('#editor-textarea').value = file.content;
    $('#editor-dialog').showModal();
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function saveEditorFile() {
  if (!state.editingPath) return;
  try {
    await api('/api/files/content', {
      method: 'PUT',
      body: { path: state.editingPath, content: $('#editor-textarea').value },
    });
    toast(`Arquivo ${state.editingPath} salvo!`);
    $('#editor-dialog').close();
    loadFiles(state.currentDir);
  } catch (err) {
    toast(err.message, 'error');
  }
}

// ----------------------------------------------------------------------------
// TAB 7: BACKUPS (GOOGLE DRIVE PESSOAL — INTERFACE ULTRA SIMPLES)
// ----------------------------------------------------------------------------
async function loadBackups() {
  try {
    const [data, gd] = await Promise.all([
      api('/api/backups'),
      api('/api/backups/gdrive/status?files=1').catch(() => null),
    ]);
    state.gdriveStatus = gd;

    const gdConnected = Boolean(gd?.connected);
    const isAdmin = state.currentUser?.role === 'admin';
    const localCard = $('#local-backups-card');
    if (localCard) localCard.classList.toggle('hidden', data.backups.length === 0);

    const tbody = $('#backups-tbody');
    if (!data.backups.length) {
      tbody.innerHTML = '';
    } else {
      tbody.innerHTML = data.backups
        .map(
          (b) => `
          <tr>
            <td class="mono-val">${escapeHtml(b.name)}</td>
            <td>${formatDate(b.mtime)}</td>
            <td>${formatBytes(b.size)}</td>
            <td class="text-right">
              <div class="row-actions">
                ${
                  isAdmin && gdConnected
                    ? `<button type="button" class="btn btn-secondary btn-sm" data-upload-gdrive="${escapeHtml(b.name)}">☁ Drive</button>`
                    : ''
                }
                <a class="btn btn-secondary btn-sm" href="/api/backups/download?name=${encodeURIComponent(b.name)}">Baixar</a>
                ${
                  isAdmin
                    ? `<button type="button" class="btn btn-danger-outline btn-sm" data-del-backup="${escapeHtml(b.name)}">Excluir</button>`
                    : ''
                }
              </div>
            </td>
          </tr>
        `
        )
        .join('');
    }

    if (gd) {
      renderGoogleDrive(gd);
    }
  } catch (err) {
    toast(`Erro ao listar backups: ${err.message}`, 'error');
  }
}

function renderGoogleDrive(gd) {
  const isAdmin = Boolean(gd.canConfigure);
  const emptyCard = $('#gd-empty-state');
  const connectedCard = $('#gd-connected-card');
  const filesCard = $('#gdrive-files-card');

  emptyCard.classList.toggle('hidden', gd.connected);
  connectedCard.classList.toggle('hidden', !gd.connected);
  filesCard.classList.toggle('hidden', !gd.connected);

  if (!gd.connected) {
    const quickBtn = $('#btn-gd-quick-connect');
    const credsBtn = $('#btn-gd-open-creds');
    const emptyDesc = $('#gd-empty-desc');
    const emptyErr = $('#gd-empty-error');

    quickBtn.classList.toggle('hidden', !isAdmin);
    credsBtn.classList.toggle('hidden', !(isAdmin && gd.hasCredentials));

    if (!isAdmin) {
      emptyDesc.textContent = 'Peça a um Administrador do painel para conectar a conta Google Drive.';
    } else if (gd.hasCredentials) {
      emptyDesc.textContent = 'Tudo pronto! Clique abaixo para escolher sua conta Google e ativar os backups na nuvem.';
    } else {
      emptyDesc.textContent =
        'Envie cópias seguras do seu mundo direto para o seu Google Drive pessoal — zero espaço ocupado no Orange Pi.';
    }

    if (gd.lastError) {
      emptyErr.textContent = gd.lastError;
      emptyErr.classList.remove('hidden');
    } else {
      emptyErr.classList.add('hidden');
    }
    return;
  }

  // Estado conectado (super limpo)
  const autoPill = $('#gd-auto-pill');
  const autoOn = gd.enabled && gd.scheduleHours > 0;
  autoPill.classList.toggle('hidden', !autoOn);
  if (autoOn) autoPill.textContent = `Auto • ${gd.scheduleHours}h`;

  $('#gd-account-summary').textContent = `${gd.accountEmail || 'Conta Google conectada'} • Pasta "${gd.folderName}"`;

  const openLink = $('#gd-open-folder-link');
  openLink.classList.toggle('hidden', !gd.folderUrl);
  if (gd.folderUrl) openLink.href = gd.folderUrl;

  $('#btn-gd-options').classList.toggle('hidden', !isAdmin);
  const btnBackupNow = $('#btn-backup-now');
  btnBackupNow.classList.toggle('hidden', !isAdmin);
  renderGoogleDriveProgress(gd.progress);

  $('#gd-last-upload').textContent = gd.lastBackupAt ? formatDate(gd.lastBackupAt) : 'Nenhum ainda';
  $('#gd-next-schedule').textContent = gd.nextScheduledAt ? formatDate(gd.nextScheduledAt) : 'Manual';
  if (gd.storageQuota && gd.storageQuota.limitBytes > 0) {
    const free = Math.max(0, gd.storageQuota.limitBytes - gd.storageQuota.usageBytes);
    $('#gd-quota-text').textContent = `${formatBytes(free)} livres`;
  } else {
    $('#gd-quota-text').textContent = 'Disponível';
  }

  const errEl = $('#gd-last-error');
  if (gd.lastError) {
    errEl.textContent = `Último aviso do Google Drive: ${gd.lastError}`;
    errEl.classList.remove('hidden');
  } else {
    errEl.classList.add('hidden');
  }

  // Lista de arquivos no Google Drive
  const remoteFiles = Array.isArray(gd.remoteFiles) ? gd.remoteFiles : [];
  const totalCloudBytes = remoteFiles.reduce((acc, f) => acc + (Number(f.size) || 0), 0);
  $('#gd-files-subtitle').textContent = gd.remoteListError
    ? `Erro ao listar pasta: ${gd.remoteListError}`
    : `${remoteFiles.length} backup(s) • ${formatBytes(totalCloudBytes)} na nuvem • Mantém últimos ${gd.maxBackups}`;

  const rtbody = $('#gdrive-files-tbody');
  if (!remoteFiles.length) {
    rtbody.innerHTML = `<tr><td colspan="4" class="muted-text">Nenhum backup no Drive ainda. Clique em "Fazer Backup Agora" acima.</td></tr>`;
  } else {
    rtbody.innerHTML = remoteFiles
      .map(
        (f) => `
        <tr>
          <td class="mono-val">${escapeHtml(f.name)}</td>
          <td>${formatDate(f.createdTime)}</td>
          <td>${formatBytes(f.size)}</td>
          <td class="text-right">
            <div class="row-actions">
              <a class="btn btn-secondary btn-sm" href="${escapeHtml(f.webViewLink)}" target="_blank" rel="noopener noreferrer">Abrir</a>
              ${
                isAdmin
                  ? `<button type="button" class="btn btn-danger-outline btn-sm" data-del-gdfile="${escapeHtml(f.id)}" data-del-gdname="${escapeHtml(f.name)}">Excluir</button>`
                  : ''
              }
            </div>
          </td>
        </tr>
      `
      )
      .join('');
  }
}

function openGdriveConnectModal() {
  const gd = state.gdriveStatus || {};
  $('#gd-client-id').value = gd.clientId || '';
  $('#gd-client-secret').value = '';
  $('#gd-client-secret').placeholder = gd.hasClientSecret
    ? `Salvo (${gd.maskedClientSecret}) — deixe vazio para manter`
    : 'GOCSPX-...';
  $('#gd-redirect-uri').value = gd.redirectUri || `${window.location.origin}/api/backups/gdrive/callback`;
  $('#gd-json-status').textContent = 'Baixou o client_secret_*.json? Só selecionar aqui que preenche tudo sozinho.';
  $('#gdrive-connect-dialog').showModal();
}

function openGdriveOptionsModal() {
  const gd = state.gdriveStatus || {};
  $('#gd-options-email').textContent = gd.accountEmail || 'Conta Google conectada';
  $('#gd-folder-name').value = gd.folderName || 'YacaCode Minecraft Backups';
  $('#gd-schedule').value = String(gd.enabled ? gd.scheduleHours ?? 24 : 0);
  $('#gd-max-backups').value = String(gd.maxBackups ?? 10);
  $('#gd-skip-idle').checked = gd.skipIfNoActivity !== false;
  $('#gdrive-options-dialog').showModal();
}

async function handleQuickConnectGoogleDrive() {
  const gd = state.gdriveStatus;
  // Se já existem credenciais OAuth salvas (no painel ou .env), vai DIRETO pro login do Google em 1 clique!
  if (gd?.hasCredentials) {
    try {
      const { url } = await api('/api/backups/gdrive/auth-url');
      window.location.href = url;
      return;
    } catch (err) {
      toast(err.message, 'error');
    }
  }
  openGdriveConnectModal();
}

async function submitGdriveConnectModal(e) {
  e.preventDefault();
  const btn = $('#btn-gd-connect-go');
  btn.disabled = true;
  try {
    const clientId = $('#gd-client-id').value.trim();
    const clientSecret = $('#gd-client-secret').value.trim();
    if (clientId || clientSecret) {
      const updated = await api('/api/backups/gdrive/config', {
        method: 'PUT',
        body: { clientId, clientSecret: clientSecret || undefined },
      });
      state.gdriveStatus = updated;
    }
    const { url } = await api('/api/backups/gdrive/auth-url');
    window.location.href = url;
  } catch (err) {
    toast(err.message, 'error');
    btn.disabled = false;
  }
}

async function saveGoogleDriveOptions(e) {
  e.preventDefault();
  const btn = $('#btn-gd-save');
  btn.disabled = true;
  try {
    const scheduleHours = Number($('#gd-schedule').value);
    const payload = {
      folderName: $('#gd-folder-name').value.trim(),
      scheduleHours,
      enabled: scheduleHours > 0,
      maxBackups: Number($('#gd-max-backups').value),
      skipIfNoActivity: $('#gd-skip-idle').checked,
    };
    const updated = await api('/api/backups/gdrive/config', { method: 'PUT', body: payload });
    state.gdriveStatus = updated;
    $('#gdrive-options-dialog').close();
    toast('Opções do Google Drive salvas!');
    loadBackups();
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    btn.disabled = false;
  }
}

function renderGoogleDriveProgress(prog) {
  const box = $('#gd-progress-box');
  const btn = $('#btn-backup-now');
  if (!box) return;

  const show = Boolean(
    prog && (prog.active || prog.stage === 'done' || prog.stage === 'error')
  );
  box.classList.toggle('hidden', !show);
  box.classList.toggle('is-done', prog?.stage === 'done');
  box.classList.toggle('is-error', prog?.stage === 'error');

  if (btn) {
    if (prog?.active) {
      btn.disabled = true;
      btn.innerHTML = `<span class="btn-spinner" aria-hidden="true"></span> ${prog.percent ?? 0}%`;
    } else {
      btn.disabled = false;
      btn.textContent = '☁ Fazer Backup Agora';
    }
  }

  if (!show) {
    stopGdriveProgressPolling();
    return;
  }

  const stageTitles = {
    compressing: '📦 Compactando mundo...',
    uploading: '☁ Enviando para o Google Drive...',
    pruning: '🧹 Limpando backups antigos...',
    done: '✓ Backup concluído no Google Drive!',
    error: '✕ Falha durante o backup',
  };
  const pct = Math.max(0, Math.min(100, Number(prog.percent) || 0));
  $('#gd-progress-stage').textContent = stageTitles[prog.stage] || 'Em andamento...';
  $('#gd-progress-pct').textContent = `${pct}%`;
  $('#gd-progress-bar').style.width = `${pct}%`;

  const details = [];
  if (prog.message) details.push(prog.message);
  if (prog.active && prog.speedBps > 0) {
    details.push(`${formatBytes(prog.speedBps)}/s`);
  }
  if (prog.active && prog.startedAt) {
    const sec = Math.max(0, Math.floor((Date.now() - new Date(prog.startedAt).getTime()) / 1000));
    details.push(`${sec}s`);
  }
  $('#gd-progress-detail').textContent = details.join(' • ') || 'Processando...';

  if (prog.active) {
    state.gdWasActive = true;
    startGdriveProgressPolling();
  } else {
    stopGdriveProgressPolling();
    if (state.gdWasActive) {
      state.gdWasActive = false;
      if (prog.stage === 'done') {
        toast(prog.message || 'Backup enviado ao Google Drive!');
        loadBackups();
      } else if (prog.stage === 'error') {
        toast(prog.error || 'Falha no backup para o Google Drive.', 'error');
      }
    }
  }
}

function startGdriveProgressPolling() {
  if (state.gdProgressTimer) return;
  state.gdProgressTimer = setInterval(async () => {
    try {
      const gd = await api('/api/backups/gdrive/status');
      state.gdriveStatus = { ...(state.gdriveStatus || {}), ...gd };
      renderGoogleDriveProgress(gd.progress);
      if (!gd.progress?.active) {
        stopGdriveProgressPolling();
      }
    } catch {
      // mantém tentando
    }
  }, 1200);
}

function stopGdriveProgressPolling() {
  if (state.gdProgressTimer) {
    clearInterval(state.gdProgressTimer);
    state.gdProgressTimer = null;
  }
}

async function triggerGoogleDriveSync(fileName = null) {
  try {
    const res = await api('/api/backups/gdrive/sync', {
      method: 'POST',
      body: fileName ? { fileName } : {},
    });
    if (res.progress) {
      state.gdWasActive = true;
      renderGoogleDriveProgress(res.progress);
    }
    toast(res.output || 'Envio para o Google Drive iniciado!');
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function triggerBackupNow() {
  try {
    const res = await api('/api/backups/now', { method: 'POST' });
    if (res.progress) {
      state.gdWasActive = true;
      renderGoogleDriveProgress(res.progress);
    }
    toast(res.output || 'Backup iniciado! Acompanhe a barra de progresso.');
  } catch (err) {
    toast(err.message, 'error');
  }
}

// ----------------------------------------------------------------------------
// TAB 8: REDE, DOMÍNIO & CLOUDFLARE
// ----------------------------------------------------------------------------
async function loadNetwork(force = false) {
  try {
    const data = await api(`/api/network${force ? '?refresh=1' : ''}`);
    $('#net-public-ip').textContent = data.network.publicIp || 'Indisponível';
    $('#net-domain-ip').textContent = data.network.domainIps?.join(', ') || 'Sem registro A';

    const syncEl = $('#net-dns-sync');
    if (data.network.dnsSynced === true) {
      syncEl.textContent = `✓ ${data.mcDomain} sincronizado`;
      syncEl.style.color = 'var(--ok)';
    } else if (data.network.dnsSynced === false) {
      syncEl.textContent = `⚠ IP diferente do domínio (${data.mcDomain})`;
      syncEl.style.color = 'var(--warn)';
    } else {
      syncEl.textContent = `Configure o DNS de ${data.mcDomain}`;
      syncEl.style.color = '';
    }

    $('#net-tunnel-state').textContent = data.cloudflared?.running ? 'Ativo' : 'Inativo';
    $('#net-panel-domain').textContent = data.panelDomain;
    $('#net-ddns-state').textContent = data.ddns?.running ? 'Ativo' : 'Inativo';

    $('#network-rules-tbody').innerHTML = `
      <tr>
        <td><strong>Minecraft Java Edition</strong></td>
        <td>Registro <code>A</code>: <code>${escapeHtml(data.mcDomain)}</code> → <code>${escapeHtml(
      data.network.publicIp || 'IP_PUBLICO'
    )}</code></td>
        <td><code>${data.javaPort}/TCP</code> (Port Forward no roteador)</td>
        <td><span class="pill pill-muted">DNS Only (Nuvem Cinza)</span></td>
      </tr>
      <tr>
        <td><strong>Minecraft Bedrock (Geyser NetherNet)</strong></td>
        <td>Mesmo registro <code>A</code>: <code>${escapeHtml(data.mcDomain)}</code></td>
        <td><code>${data.bedrockPort}/UDP</code> + <code>${data.bedrockPort}/TCP</code></td>
        <td><span class="pill pill-muted">DNS Only (Nuvem Cinza)</span></td>
      </tr>
      <tr>
        <td><strong>Painel Admin YacaCode</strong></td>
        <td>Cloudflare Tunnel: <code>${escapeHtml(data.panelDomain)}</code> → <code>http://yacacode-panel:8080</code></td>
        <td>HTTPS 443 (Nenhuma porta aberta no roteador!)</td>
        <td><span class="pill pill-ok">Tunnel Proxied + HTTPS</span></td>
      </tr>
    `;
  } catch (err) {
    toast(`Erro ao verificar rede: ${err.message}`, 'error');
  }
}

// ----------------------------------------------------------------------------
// TAB 9: USUÁRIOS DO PAINEL & PERMISSÕES (RBAC)
// ----------------------------------------------------------------------------
async function loadUsers() {
  if (state.currentUser?.role !== 'admin') return;
  try {
    const data = await api('/api/users');
    const users = data.users || [];
    const badge = $('#nav-users-badge');
    if (badge) {
      badge.textContent = String(users.length);
      badge.classList.remove('hidden');
    }
    $('#users-count-label').textContent = `${users.length} conta(s) cadastrada(s) no painel`;
    const tbody = $('#users-tbody');

    tbody.innerHTML = users
      .map((u) => {
        const isSelf = u.username === state.currentUser?.username;
        const roleSelect = u.isOwner
          ? `<span class="pill pill-accent">Administrador (Dono)</span>`
          : `<select class="role-select-inline" data-user-role="${escapeHtml(u.username)}" aria-label="Cargo de ${escapeHtml(u.username)}">
               <option value="admin" ${u.role === 'admin' ? 'selected' : ''}>Administrador</option>
               <option value="moderator" ${u.role === 'moderator' ? 'selected' : ''}>Moderador</option>
               <option value="viewer" ${u.role === 'viewer' ? 'selected' : ''}>Visualizador</option>
             </select>`;

        return `
          <tr>
            <td>
              <strong>${escapeHtml(u.displayName)}</strong>
              <div class="muted-text mono-val">@${escapeHtml(u.username)} ${isSelf ? '(você)' : ''}</div>
            </td>
            <td>${roleSelect}</td>
            <td>
              <span class="pill ${u.enabled ? 'pill-ok' : 'pill-danger'}">${u.enabled ? 'Ativo' : 'Desativado'}</span>
            </td>
            <td>${u.lastLoginAt ? formatDate(u.lastLoginAt) : 'Nunca entrou'}</td>
            <td class="text-right">
              <div class="row-actions">
                <button type="button" class="btn btn-secondary btn-sm" data-user-resetpass="${escapeHtml(u.username)}">Nova Senha</button>
                ${
                  !u.isOwner
                    ? `<button type="button" class="btn btn-ghost btn-sm" data-user-toggle="${escapeHtml(u.username)}" data-enabled="${u.enabled ? '1' : '0'}">${
                        u.enabled ? 'Desativar' : 'Ativar'
                      }</button>`
                    : ''
                }
                ${
                  !u.isOwner && !isSelf
                    ? `<button type="button" class="btn btn-danger-outline btn-sm" data-user-del="${escapeHtml(u.username)}">Excluir</button>`
                    : ''
                }
              </div>
            </td>
          </tr>
        `;
      })
      .join('');
  } catch (err) {
    toast(`Erro ao carregar usuários: ${err.message}`, 'error');
  }
}

function generateStrongPassword() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%';
  const bytes = new Uint32Array(12);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => chars[b % chars.length]).join('');
}

// ----------------------------------------------------------------------------
// EVENT LISTENERS GLOBAIS
// ----------------------------------------------------------------------------
function bindEvents() {
  // Login
  $('#login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errEl = $('#login-error');
    const btn = $('#login-submit');
    errEl.classList.add('hidden');
    btn.disabled = true;
    btn.textContent = 'Autenticando...';
    try {
      await api('/api/auth/login', {
        method: 'POST',
        body: {
          username: $('#login-user').value,
          password: $('#login-pass').value,
        },
      });
      const me = await api('/api/auth/me');
      showApp(me);
    } catch (err) {
      errEl.textContent = err.message;
      errEl.classList.remove('hidden');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Entrar no Painel';
    }
  });

  // Logout & Tema
  $('#btn-logout').addEventListener('click', async () => {
    await api('/api/auth/logout', { method: 'POST' }).catch(() => {});
    showLogin();
  });
  $('#btn-theme-toggle').addEventListener('click', toggleColorScheme);

  // Sidebar navigation & mobile
  $$('.nav-item').forEach((btn) => btn.addEventListener('click', () => switchTab(btn.dataset.tab)));
  $('#btn-open-sidebar').addEventListener('click', openMobileSidebar);
  $('#btn-close-sidebar').addEventListener('click', closeMobileSidebar);
  $('#sidebar-overlay').addEventListener('click', closeMobileSidebar);

  // Botão atualizar global
  $('#btn-refresh-now').addEventListener('click', () => switchTab(state.activeTab));

  // Copiar IP Java/Bedrock
  $$('.copy-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const target = document.getElementById(btn.dataset.copyTarget);
      if (!target) return;
      try {
        await navigator.clipboard.writeText(target.textContent.trim());
        toast(`Copiado: ${target.textContent.trim()}`);
      } catch {
        toast('Não foi possível copiar automaticamente.', 'warn');
      }
    });
  });

  // Controles de Energia
  $$('[data-power]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const action = btn.dataset.power;
      if (action === 'stop' || action === 'restart') {
        const ok = await confirmDialog(
          action === 'stop' ? 'Parar o servidor?' : 'Reiniciar o servidor?',
          'O painel enviará um aviso no chat e executará save-all antes de concluir a ação.',
          action === 'stop' ? 'Parar Servidor' : 'Reiniciar',
          action === 'stop'
        );
        if (!ok) return;
      }
      btn.disabled = true;
      try {
        await api('/api/server/power', { method: 'POST', body: { action } });
        toast(`Comando "${action}" enviado com sucesso.`);
        setTimeout(loadOverview, 1500);
      } catch (err) {
        toast(err.message, 'error');
      } finally {
        btn.disabled = false;
      }
    });
  });

  $('#btn-quick-save').addEventListener('click', async () => {
    try {
      const res = await api('/api/console/command', { method: 'POST', body: { command: 'save-all' } });
      toast(res.output || 'Mundo salvo com sucesso!');
    } catch (err) {
      toast(err.message, 'error');
    }
  });
  $('#btn-quick-backup').addEventListener('click', () => {
    switchTab('backups');
    triggerBackupNow();
  });

  // Console
  $('#console-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const input = $('#console-input');
    sendConsoleCommand(input.value);
    input.value = '';
  });
  $('#console-input').addEventListener('keydown', (e) => {
    if (e.key === 'ArrowUp' && state.cmdHistory.length) {
      e.preventDefault();
      state.cmdHistoryIdx = Math.min(state.cmdHistory.length - 1, state.cmdHistoryIdx + 1);
      e.target.value = state.cmdHistory[state.cmdHistoryIdx];
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      state.cmdHistoryIdx = Math.max(-1, state.cmdHistoryIdx - 1);
      e.target.value = state.cmdHistoryIdx >= 0 ? state.cmdHistory[state.cmdHistoryIdx] : '';
    }
  });
  $$('[data-quick-cmd]').forEach((btn) =>
    btn.addEventListener('click', () => sendConsoleCommand(btn.dataset.quickCmd))
  );
  $('#console-filter').addEventListener('input', rerenderConsole);
  $('#btn-console-clear').addEventListener('click', () => {
    state.consoleLines = [];
    $('#console-output').innerHTML = '';
  });
  $('#btn-console-reconnect').addEventListener('click', () => {
    disconnectSse();
    connectSse();
  });

  // Jogadores
  $('#btn-reload-players').addEventListener('click', loadPlayers);
  $('#broadcast-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = $('#broadcast-input');
    await runPlayerAction('say', null, { message: input.value });
    input.value = '';
  });
  $('#btn-toggle-whitelist').addEventListener('click', (e) => {
    const nextAction = e.currentTarget.dataset.nextState || 'whitelist-on';
    runPlayerAction(nextAction);
  });
  $('#whitelist-add-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = $('#whitelist-player-input');
    await runPlayerAction('whitelist-add', input.value);
    input.value = '';
  });
  $('#op-add-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = $('#op-player-input');
    await runPlayerAction('op', input.value);
    input.value = '';
  });
  $('#ban-add-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = $('#ban-player-input');
    const ok = await confirmDialog('Banir jogador?', `Deseja banir "${input.value}" do servidor?`, 'Banir');
    if (!ok) return;
    await runPlayerAction('ban', input.value);
    input.value = '';
  });
  $('#tab-players').addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-paction]');
    if (!btn) return;
    const { paction, player } = btn.dataset;
    if (paction === 'whisper') {
      const msg = await promptDialog(`Mensagem para ${player}`, 'Digite a mensagem privada:', 'Olá!');
      if (msg) await runPlayerAction('whisper', player, { message: msg });
      return;
    }
    if (paction === 'ban' || paction === 'kick') {
      const ok = await confirmDialog(
        paction === 'ban' ? `Banir ${player}?` : `Expulsar ${player}?`,
        `Confirma executar "${paction}" em ${player}?`,
        paction === 'ban' ? 'Banir' : 'Expulsar'
      );
      if (!ok) return;
    }
    await runPlayerAction(paction, player);
  });

  // Configurações & Presets
  $('#btn-save-properties').addEventListener('click', saveProperties);
  $('#btn-apply-presets').addEventListener('click', async () => {
    const ok = await confirmDialog(
      'Aplicar Presets YacaCode?',
      'Isso otimizará Geyser-Spigot/config.yml (NetherNet + Floodgate + MOTD YacaCode), bukkit.yml, spigot.yml e paper-*.yml para Orange Pi 4GB. Arquivos .bak serão criados.',
      'Aplicar Presets',
      false
    );
    if (!ok) return;
    try {
      const res = await api('/api/presets/apply', { method: 'POST' });
      const applied = res.report.filter((r) => r.status === 'applied').length;
      const skipped = res.report.filter((r) => r.status === 'skipped').length;
      toast(`Presets aplicados em ${applied} arquivo(s) (${skipped} aguardando 1º boot). Reinicie o servidor!`);
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  // Plugins
  $('#btn-reload-plugins').addEventListener('click', loadPlugins);
  $('#btn-select-plugin').addEventListener('click', () => $('#plugin-file-input').click());
  $('#plugin-file-input').addEventListener('change', (e) => {
    uploadPluginFile(e.target.files?.[0]);
    e.target.value = '';
  });
  const dz = $('#plugin-dropzone');
  dz.addEventListener('dragover', (e) => {
    e.preventDefault();
    dz.classList.add('dragover');
  });
  dz.addEventListener('dragleave', () => dz.classList.remove('dragover'));
  dz.addEventListener('drop', (e) => {
    e.preventDefault();
    dz.classList.remove('dragover');
    uploadPluginFile(e.dataTransfer?.files?.[0]);
  });
  $('#plugins-tbody').addEventListener('click', async (e) => {
    const toggleBtn = e.target.closest('[data-plugin-toggle]');
    if (toggleBtn) {
      try {
        await api('/api/plugins/toggle', {
          method: 'POST',
          body: { fileName: toggleBtn.dataset.pluginToggle },
        });
        toast('Status do plugin atualizado! Reinicie o servidor para aplicar.');
        loadPlugins();
      } catch (err) {
        toast(err.message, 'error');
      }
      return;
    }
    const delBtn = e.target.closest('[data-plugin-del]');
    if (delBtn) {
      const name = delBtn.dataset.pluginDel;
      const ok = await confirmDialog('Excluir plugin?', `Remover permanentemente "${name}"?`, 'Excluir');
      if (!ok) return;
      try {
        await api(`/api/plugins?name=${encodeURIComponent(name)}`, { method: 'DELETE' });
        toast(`Plugin ${name} removido.`);
        loadPlugins();
      } catch (err) {
        toast(err.message, 'error');
      }
    }
  });

  // Arquivos
  $('#btn-files-refresh').addEventListener('click', () => loadFiles(state.currentDir));
  $('#btn-files-mkdir').addEventListener('click', async () => {
    const name = await promptDialog('Nova Pasta', 'Nome da pasta a criar no diretório atual:', 'minha-pasta');
    if (!name) return;
    const target = state.currentDir ? `${state.currentDir}/${name}` : name;
    try {
      await api('/api/files/mkdir', { method: 'POST', body: { path: target } });
      toast('Pasta criada!');
      loadFiles(state.currentDir);
    } catch (err) {
      toast(err.message, 'error');
    }
  });
  $('#files-breadcrumb').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-dir]');
    if (btn) loadFiles(btn.dataset.dir);
  });
  $('#files-tbody').addEventListener('click', async (e) => {
    const dirBtn = e.target.closest('[data-open-dir]');
    if (dirBtn) return loadFiles(dirBtn.dataset.openDir);

    const editBtn = e.target.closest('[data-edit-file]');
    if (editBtn) return openFileEditor(editBtn.dataset.editFile);

    const delBtn = e.target.closest('[data-del-file]');
    if (delBtn) {
      const p = delBtn.dataset.delFile;
      const ok = await confirmDialog('Excluir item?', `Excluir permanentemente "/data/${p}"?`, 'Excluir');
      if (!ok) return;
      try {
        await api(`/api/files?path=${encodeURIComponent(p)}`, { method: 'DELETE' });
        toast('Item excluído.');
        loadFiles(state.currentDir);
      } catch (err) {
        toast(err.message, 'error');
      }
    }
  });

  // Editor modal
  $('#btn-editor-close').addEventListener('click', () => $('#editor-dialog').close());
  $('#btn-editor-cancel').addEventListener('click', () => $('#editor-dialog').close());
  $('#btn-editor-save').addEventListener('click', saveEditorFile);
  $('#editor-textarea').addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      saveEditorFile();
    }
  });

  // Backups & Google Drive (UI ultra simples + modais)
  $('#btn-backup-now').addEventListener('click', triggerBackupNow);
  $('#btn-reload-backups').addEventListener('click', loadBackups);
  $('#btn-reload-gdrive').addEventListener('click', loadBackups);
  $('#btn-gd-quick-connect').addEventListener('click', handleQuickConnectGoogleDrive);
  $('#btn-gd-open-creds').addEventListener('click', openGdriveConnectModal);
  $('#btn-gd-options').addEventListener('click', openGdriveOptionsModal);

  // Modal Conectar Google Drive + Importar JSON
  $('#btn-gd-connect-close').addEventListener('click', () => $('#gdrive-connect-dialog').close());
  $('#btn-gd-connect-cancel').addEventListener('click', () => $('#gdrive-connect-dialog').close());
  $('#gdrive-connect-form').addEventListener('submit', submitGdriveConnectModal);
  $('#btn-gd-pick-json').addEventListener('click', () => $('#gd-json-file').click());
  $('#gd-json-file').addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const text = await file.text();
      const updated = await api('/api/backups/gdrive/config', {
        method: 'PUT',
        body: { credentialsJson: text },
      });
      state.gdriveStatus = updated;
      $('#gd-client-id').value = updated.clientId || '';
      $('#gd-client-secret').value = '';
      $('#gd-client-secret').placeholder = `Importado (${updated.maskedClientSecret})`;
      $('#gd-json-status').textContent = `✓ Credenciais importadas de ${file.name}! Redirecionando para o Google...`;
      toast('Credenciais importadas! Abrindo login do Google...');
      const { url } = await api('/api/backups/gdrive/auth-url');
      window.location.href = url;
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  // Modal Opções do Google Drive
  $('#btn-gd-options-close').addEventListener('click', () => $('#gdrive-options-dialog').close());
  $('#btn-gd-options-cancel').addEventListener('click', () => $('#gdrive-options-dialog').close());
  $('#gdrive-options-form').addEventListener('submit', saveGoogleDriveOptions);

  $('#btn-copy-gd-redirect').addEventListener('click', async () => {
    const val = $('#gd-redirect-uri').value;
    if (!val) return;
    try {
      await navigator.clipboard.writeText(val);
      toast('URL de retorno copiada!');
    } catch {
      toast('Selecione e copie a URL manualmente.', 'warn');
    }
  });
  $('#btn-gd-test').addEventListener('click', async () => {
    const btn = $('#btn-gd-test');
    btn.disabled = true;
    try {
      const res = await api('/api/backups/gdrive/test', { method: 'POST' });
      toast(`Conexão OK! Conta: ${res.status?.accountEmail || 'Google Drive'}`);
      loadBackups();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      btn.disabled = false;
    }
  });
  $('#btn-gd-disconnect').addEventListener('click', async () => {
    const ok = await confirmDialog(
      'Desconectar Google Drive?',
      'Os arquivos já enviados ao seu Google Drive serão mantidos, mas o envio automático será pausado.',
      'Desconectar'
    );
    if (!ok) return;
    try {
      await api('/api/backups/gdrive/disconnect', { method: 'POST', body: {} });
      $('#gdrive-options-dialog').close();
      toast('Conta Google Drive desconectada.');
      loadBackups();
    } catch (err) {
      toast(err.message, 'error');
    }
  });
  $('#backups-tbody').addEventListener('click', async (e) => {
    const upBtn = e.target.closest('[data-upload-gdrive]');
    if (upBtn) {
      return triggerGoogleDriveSync(upBtn.dataset.uploadGdrive);
    }
    const delBtn = e.target.closest('[data-del-backup]');
    if (!delBtn) return;
    const name = delBtn.dataset.delBackup;
    const ok = await confirmDialog('Excluir backup?', `Remover permanentemente "${name}" do Orange Pi?`, 'Excluir');
    if (!ok) return;
    try {
      await api(`/api/backups?name=${encodeURIComponent(name)}`, { method: 'DELETE' });
      toast('Backup local removido.');
      loadBackups();
    } catch (err) {
      toast(err.message, 'error');
    }
  });
  $('#gdrive-files-tbody').addEventListener('click', async (e) => {
    const delBtn = e.target.closest('[data-del-gdfile]');
    if (!delBtn) return;
    const id = delBtn.dataset.delGdfile;
    const name = delBtn.dataset.delGdname || id;
    const ok = await confirmDialog('Excluir backup da nuvem?', `Remover "${name}" do seu Google Drive?`, 'Excluir do Drive');
    if (!ok) return;
    try {
      await api(`/api/backups/gdrive/files?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
      toast('Backup removido do Google Drive.');
      loadBackups();
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  // Rede
  $('#btn-refresh-network').addEventListener('click', () => loadNetwork(true));

  // Usuários do Painel (RBAC)
  $('#btn-reload-users').addEventListener('click', loadUsers);
  $('#btn-gen-pass').addEventListener('click', () => {
    $('#new-user-password').value = generateStrongPassword();
  });
  $('#create-user-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api('/api/users', {
        method: 'POST',
        body: {
          username: $('#new-user-username').value,
          displayName: $('#new-user-display').value,
          role: $('#new-user-role').value,
          password: $('#new-user-password').value,
        },
      });
      toast(`Usuário "${$('#new-user-username').value.trim()}" criado com sucesso!`);
      $('#create-user-form').reset();
      loadUsers();
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  $('#change-own-pass-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api('/api/auth/password', {
        method: 'POST',
        body: {
          currentPassword: $('#own-current-pass').value,
          newPassword: $('#own-new-pass').value,
        },
      });
      toast('Sua senha foi atualizada com sucesso!');
      $('#change-own-pass-form').reset();
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  $('#users-tbody').addEventListener('change', async (e) => {
    const sel = e.target.closest('[data-user-role]');
    if (!sel) return;
    try {
      await api('/api/users', {
        method: 'PATCH',
        body: { username: sel.dataset.userRole, role: sel.value },
      });
      toast(`Cargo de "${sel.dataset.userRole}" atualizado para ${ROLE_LABELS[sel.value] || sel.value}.`);
      loadUsers();
    } catch (err) {
      toast(err.message, 'error');
      loadUsers();
    }
  });

  $('#users-tbody').addEventListener('click', async (e) => {
    const resetBtn = e.target.closest('[data-user-resetpass]');
    if (resetBtn) {
      const uname = resetBtn.dataset.userResetpass;
      const newPass = await promptDialog(
        `Nova senha para @${uname}`,
        'Digite a nova senha (mínimo 6 caracteres):',
        'NovaSenha123',
        generateStrongPassword()
      );
      if (!newPass) return;
      try {
        await api('/api/users', {
          method: 'PATCH',
          body: { username: uname, password: newPass },
        });
        toast(`Senha de @${uname} redefinida com sucesso!`);
      } catch (err) {
        toast(err.message, 'error');
      }
      return;
    }

    const toggleBtn = e.target.closest('[data-user-toggle]');
    if (toggleBtn) {
      const uname = toggleBtn.dataset.userToggle;
      const currentlyEnabled = toggleBtn.dataset.enabled === '1';
      try {
        await api('/api/users', {
          method: 'PATCH',
          body: { username: uname, enabled: !currentlyEnabled },
        });
        toast(`Conta @${uname} ${currentlyEnabled ? 'desativada' : 'ativada'}.`);
        loadUsers();
      } catch (err) {
        toast(err.message, 'error');
      }
      return;
    }

    const delBtn = e.target.closest('[data-user-del]');
    if (delBtn) {
      const uname = delBtn.dataset.userDel;
      const ok = await confirmDialog(
        `Excluir usuário @${uname}?`,
        `A conta @${uname} perderá o acesso ao painel imediatamente.`,
        'Excluir Usuário'
      );
      if (!ok) return;
      try {
        await api(`/api/users?username=${encodeURIComponent(uname)}`, { method: 'DELETE' });
        toast(`Usuário @${uname} removido.`);
        loadUsers();
      } catch (err) {
        toast(err.message, 'error');
      }
    }
  });

  // Navegação mobile bottom tab bar
  $$('.mobile-nav-btn[data-tab]').forEach((btn) => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });
  const btnMobileMore = $('#btn-mobile-more');
  if (btnMobileMore) btnMobileMore.addEventListener('click', openMobileSidebar);

  // Assistente IA Gemini (Histórico por usuário + Sync Real-Time)
  $('#btn-ai-clear').addEventListener('click', () => startNewAiConversation());
  const btnAiNew = $('#btn-ai-new-chat');
  if (btnAiNew) btnAiNew.addEventListener('click', () => startNewAiConversation());
  const btnAiHistToggle = $('#btn-ai-history-toggle');
  if (btnAiHistToggle) {
    btnAiHistToggle.addEventListener('click', () => {
      $('#ai-history-pane')?.classList.toggle('is-open');
    });
  }
  const aiHistList = $('#ai-history-list');
  if (aiHistList) {
    aiHistList.addEventListener('click', (e) => {
      const delBtn = e.target.closest('[data-ai-conv-del]');
      if (delBtn) {
        e.stopPropagation();
        deleteAiConversation(delBtn.dataset.aiConvDel);
        return;
      }
      const selectBtn = e.target.closest('[data-ai-conv-id]');
      if (selectBtn) {
        selectAiConversation(selectBtn.dataset.aiConvId);
        $('#ai-history-pane')?.classList.remove('is-open');
      }
    });
  }
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && state.currentUser && state.activeTab === 'ai') {
      loadAiConversations(false);
    }
  });
  $('#btn-ai-config').addEventListener('click', openAiConfigModal);
  $('#btn-ai-setup-now').addEventListener('click', openAiConfigModal);
  $('#btn-ai-config-close').addEventListener('click', () => $('#ai-config-dialog').close());
  $('#btn-ai-config-cancel').addEventListener('click', () => $('#ai-config-dialog').close());
  $('#ai-config-form').addEventListener('submit', saveAiConfig);

  $('#ai-chat-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const input = $('#ai-chat-input');
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    input.style.height = 'auto';
    sendAiMessage(text);
  });

  $('#ai-chat-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      $('#ai-chat-form').requestSubmit();
    }
  });

  $('#ai-chat-input').addEventListener('input', (e) => {
    const el = e.currentTarget;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 130)}px`;
  });

  $('#tab-ai').addEventListener('click', (e) => {
    const chip = e.target.closest('[data-ai-prompt]');
    if (chip) {
      sendAiMessage(chip.dataset.aiPrompt);
      return;
    }
    const confirmBtn = e.target.closest('[data-ai-confirm]');
    if (confirmBtn) {
      handleAiPendingDecision(confirmBtn.dataset.aiConfirm, confirmBtn.dataset.decision);
    }
  });
}

// ----------------------------------------------------------------------------
// ASSISTENTE IA GEMINI (CHAT + FUNCTION CALLING + CONFIRMAÇÃO 1-CLIQUE)
// ----------------------------------------------------------------------------
function formatAiMarkdown(rawText) {
  const escaped = escapeHtml(rawText || '');
  const lines = escaped.split('\n');
  let html = '';
  let inList = false;

  const inline = (line) =>
    line
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

  for (const rawLine of lines) {
    const bullet = rawLine.match(/^\s*[-*•]\s+(.*)$/);
    if (bullet) {
      if (!inList) {
        html += '<ul>';
        inList = true;
      }
      html += `<li>${inline(bullet[1])}</li>`;
    } else {
      if (inList) {
        html += '</ul>';
        inList = false;
      }
      html += rawLine.trim() === '' ? '<br>' : `${inline(rawLine)}<br>`;
    }
  }
  if (inList) html += '</ul>';
  return html.replace(/(<br>)+$/g, '');
}

async function loadAiStatus() {
  try {
    const status = await api('/api/ai/status');
    state.aiStatus = status;
    renderAiStatus(status);
    if (state.aiMessages.length === 0) {
      renderAiMessages();
    }
  } catch (err) {
    toast(`Erro ao carregar status da IA: ${err.message}`, 'error');
  }
}

function formatConvDate(iso) {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    const now = new Date();
    const sameDay =
      d.getFullYear() === now.getFullYear() &&
      d.getMonth() === now.getMonth() &&
      d.getDate() === now.getDate();
    return sameDay
      ? d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
      : d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
  } catch {
    return '';
  }
}

function renderAiConversationsList() {
  const listEl = $('#ai-history-list');
  const userEl = $('#ai-history-user');
  if (userEl && state.currentUser?.username) {
    userEl.textContent = `@${state.currentUser.username} • PC & Celular`;
  }
  if (!listEl) return;

  if (!Array.isArray(state.aiConversations) || state.aiConversations.length === 0) {
    listEl.innerHTML = `<div class="ai-history-empty">Nenhuma conversa salva ainda.<br>Envie uma mensagem para começar.</div>`;
    return;
  }

  listEl.innerHTML = state.aiConversations
    .map((c) => {
      const isActive = c.id === state.aiActiveConversationId;
      const meta = `${c.messageCount || 0} msg • ${formatConvDate(c.updatedAt)}`;
      return `
        <div class="ai-history-item${isActive ? ' is-active' : ''}" role="listitem" data-ai-conv-id="${escapeHtml(c.id)}">
          <button type="button" class="ai-history-item-main" data-ai-conv-id="${escapeHtml(c.id)}">
            <span class="ai-history-item-title">${escapeHtml(c.title || 'Nova conversa')}</span>
            <span class="ai-history-item-meta">${escapeHtml(meta)}</span>
          </button>
          <button type="button" class="ai-history-del" data-ai-conv-del="${escapeHtml(c.id)}" title="Excluir conversa" aria-label="Excluir conversa">✕</button>
        </div>
      `;
    })
    .join('');
}

async function loadAiConversations(silent = true) {
  try {
    const data = await api('/api/ai/conversations');
    state.aiConversations = Array.isArray(data.conversations) ? data.conversations : [];
    const targetId =
      state.aiActiveConversationId && state.aiConversations.some((c) => c.id === state.aiActiveConversationId)
        ? state.aiActiveConversationId
        : data.activeConversationId || null;

    if (!state.aiSending) {
      if (targetId && data.activeConversation && data.activeConversation.id === targetId) {
        state.aiActiveConversationId = targetId;
        state.aiMessages = Array.isArray(data.activeConversation.messages) ? data.activeConversation.messages : [];
        state.aiLastAnimatedIdx = state.aiMessages.length - 1;
      } else if (targetId) {
        const detail = await api(`/api/ai/conversations/${encodeURIComponent(targetId)}`);
        state.aiActiveConversationId = targetId;
        state.aiMessages = Array.isArray(detail.conversation?.messages) ? detail.conversation.messages : [];
        state.aiLastAnimatedIdx = state.aiMessages.length - 1;
      } else {
        state.aiActiveConversationId = null;
        state.aiMessages = [];
        state.aiLastAnimatedIdx = -1;
      }
      renderAiMessages();
    }
    renderAiConversationsList();
  } catch (err) {
    if (!silent) toast(`Erro ao sincronizar conversas: ${err.message}`, 'warn');
  }
}

async function selectAiConversation(convId) {
  if (!convId || state.aiSending) return;
  try {
    const detail = await api(`/api/ai/conversations/${encodeURIComponent(convId)}?select=1`);
    state.aiActiveConversationId = detail.conversation.id;
    state.aiMessages = Array.isArray(detail.conversation.messages) ? detail.conversation.messages : [];
    state.aiLastAnimatedIdx = state.aiMessages.length - 1;
    renderAiConversationsList();
    renderAiMessages();
  } catch (err) {
    toast(`Erro ao abrir conversa: ${err.message}`, 'error');
  }
}

async function startNewAiConversation() {
  if (state.aiSending) return;
  try {
    const created = await api('/api/ai/conversations', { method: 'POST', body: {} });
    state.aiConversations = created.conversations || [];
    state.aiActiveConversationId = created.conversation?.id || null;
    state.aiMessages = [];
    state.aiLastAnimatedIdx = -1;
    renderAiConversationsList();
    renderAiMessages();
    $('#ai-chat-input')?.focus();
  } catch (err) {
    toast(`Erro ao criar conversa: ${err.message}`, 'error');
  }
}

async function deleteAiConversation(convId) {
  if (!convId || state.aiSending) return;
  try {
    const res = await api(`/api/ai/conversations/${encodeURIComponent(convId)}`, { method: 'DELETE' });
    state.aiConversations = res.conversations || [];
    state.aiActiveConversationId = res.activeConversationId || null;
    state.aiMessages = Array.isArray(res.activeConversation?.messages) ? res.activeConversation.messages : [];
    state.aiLastAnimatedIdx = state.aiMessages.length - 1;
    renderAiConversationsList();
    renderAiMessages();
    toast('Conversa excluída.');
  } catch (err) {
    toast(`Erro ao excluir conversa: ${err.message}`, 'error');
  }
}

function connectAiSync() {
  if (state.aiSyncSse || !state.currentUser) return;
  const syncPill = $('#ai-sync-pill');
  try {
    const es = new EventSource('/api/ai/events');
    state.aiSyncSse = es;

    es.addEventListener('connected', () => {
      if (syncPill) syncPill.classList.remove('hidden');
    });

    es.addEventListener('sync', () => {
      if (!state.aiSending) {
        loadAiConversations(true);
      }
    });

    es.onerror = () => {
      if (syncPill) syncPill.classList.add('hidden');
      disconnectAiSync();
      if (state.currentUser) {
        state.aiSyncReconnectTimer = setTimeout(() => {
          state.aiSyncReconnectTimer = null;
          if (state.currentUser) connectAiSync();
        }, 4000);
      }
    };
  } catch {
    // fallback silencioso
  }
}

function disconnectAiSync() {
  if (state.aiSyncReconnectTimer) {
    clearTimeout(state.aiSyncReconnectTimer);
    state.aiSyncReconnectTimer = null;
  }
  if (state.aiSyncSse) {
    state.aiSyncSse.close();
    state.aiSyncSse = null;
  }
  $('#ai-sync-pill')?.classList.add('hidden');
}

function renderAiStatus(status) {
  const dot = $('#ai-status-dot');
  const modelPill = $('#ai-model-pill');
  const permPill = $('#ai-perm-pill');
  const inGamePill = $('#ai-ingame-pill');
  const sub = $('#ai-status-sub');
  const setupBanner = $('#ai-setup-banner');
  const setupDesc = $('#ai-setup-desc');
  const btnConfig = $('#btn-ai-config');
  const btnSetupNow = $('#btn-ai-setup-now');

  const isAdmin = Boolean(status.permissions?.canConfigure);
  const canCmd = Boolean(status.permissions?.canRunCommands);

  modelPill.textContent = status.model || 'gemini-3.5-flash-lite';
  permPill.textContent = isAdmin
    ? 'Acesso Total (Admin)'
    : canCmd
    ? 'Comandos de Jogo (Mod)'
    : 'Somente Consultas (Viewer)';
  permPill.className = `pill ${isAdmin ? 'pill-accent' : canCmd ? 'pill-info' : 'pill-muted'}`;

  btnConfig.classList.toggle('hidden', !isAdmin);
  btnSetupNow.classList.toggle('hidden', !isAdmin);
  if (inGamePill) {
    inGamePill.classList.toggle('hidden', !status.configured);
    inGamePill.textContent = status.inGameChatEnabled
      ? 'Chat no jogo: Jorge ON'
      : 'Chat no jogo: Jorge OFF';
    inGamePill.className = `pill ${status.inGameChatEnabled ? 'pill-ok' : 'pill-muted'}`;
  }

  if (status.configured) {
    dot.className = 'dot dot-ok';
    sub.textContent =
      status.source === 'panel'
        ? 'Ativo • Chave salva no painel • Consultas ao vivo e comandos habilitados'
        : 'Ativo • Chave configurada via .env • Consultas ao vivo e comandos habilitados';
    setupBanner.classList.add('hidden');
  } else {
    dot.className = 'dot dot-warn';
    sub.textContent = 'Aguardando configuração da Gemini API Key';
    setupBanner.classList.remove('hidden');
    setupDesc.textContent = isAdmin
      ? 'Clique em "Configurar Chave API" e cole sua chave gratuita do Google AI Studio (aistudio.google.com/apikey).'
      : 'Peça a um Administrador do painel para cadastrar a Gemini API Key.';
  }
}

function renderAiMessages() {
  const box = $('#ai-messages');
  if (!box) return;

  if (state.aiMessages.length === 0) {
    const roleHint =
      state.currentUser?.role === 'viewer'
        ? 'Como Visualizador, você pode perguntar quem está online, níveis de XP, status, temperatura e logs.'
        : 'Pergunte o que está acontecendo no mundo ou peça ações como "deixe de dia", "dê op para Nycolazs", "mande um aviso no chat" ou "quem está online e em qual nível?".';
    box.innerHTML = `
      <div class="ai-msg ai-msg-model">
        <div class="ai-bubble">
          <strong>Olá, ${escapeHtml(state.currentUser?.displayName || state.currentUser?.username || 'Admin')}!</strong><br>
          Sou o Assistente IA Gemini do servidor <strong>YacaCode</strong>. ${escapeHtml(roleHint)}
        </div>
        <span class="ai-msg-meta">YacaCode AI • Pronto</span>
      </div>
    `;
    return;
  }

  const parts = state.aiMessages.map((msg, idx) => {
    const isNew = idx > state.aiLastAnimatedIdx;
    const roleClass = msg.role === 'user' ? 'ai-msg-user' : 'ai-msg-model';
    const animClass = isNew ? ' is-new' : '';
    const bubbleContent = msg.role === 'user' ? escapeHtml(msg.text).replace(/\n/g, '<br>') : formatAiMarkdown(msg.text);

    let actionsHtml = '';
    if (Array.isArray(msg.actions) && msg.actions.length > 0) {
      const pills = msg.actions
        .map((a) => {
          const cls = a.status === 'denied' ? 'is-denied' : a.status === 'error' ? 'is-error' : '';
          const icon = a.status === 'ok' ? '✓' : a.status === 'denied' ? '✕' : '!';
          const title = a.output ? ` title="${escapeHtml(a.output)}"` : '';
          return `<span class="ai-action-pill ${cls}"${title}>${icon} ${escapeHtml(a.label)}</span>`;
        })
        .join('');
      actionsHtml = `<div class="ai-actions-list">${pills}</div>`;
    }

    let pendingHtml = '';
    if (Array.isArray(msg.pendingActions) && msg.pendingActions.length > 0) {
      pendingHtml = msg.pendingActions
        .map((p) => {
          const stateCls =
            p.resolution === 'executed'
              ? 'is-done'
              : p.resolution === 'rejected'
              ? 'is-rejected'
              : '';
          const cmdDisplay = p.command ? `/${p.command}` : p.label;
          let footer = '';
          const resolvedOut = p.resolvedOutput || p.output;
          if (p.resolution === 'executed') {
            footer = `<small class="muted-text">✓ Executado${resolvedOut ? `: ${escapeHtml(resolvedOut)}` : ''}</small>`;
          } else if (p.resolution === 'rejected') {
            footer = `<small class="muted-text">✕ Ação cancelada pelo usuário.</small>`;
          } else {
            footer = `
              <div class="ai-pending-buttons">
                <button type="button" class="btn btn-danger btn-sm" data-ai-confirm="${escapeHtml(p.id)}" data-decision="approve">Confirmar e executar</button>
                <button type="button" class="btn btn-secondary btn-sm" data-ai-confirm="${escapeHtml(p.id)}" data-decision="reject">Cancelar</button>
              </div>
            `;
          }
          return `
            <div class="ai-pending-card ${stateCls}">
              <div class="ai-pending-head">
                <strong>⚠ Confirmação necessária</strong>
                <span class="pill pill-warn">Ação destrutiva</span>
              </div>
              <small class="muted-text">${escapeHtml(p.reason || p.label)}</small>
              <code class="ai-pending-cmd">${escapeHtml(cmdDisplay)}</code>
              ${footer}
            </div>
          `;
        })
        .join('');
    }

    const meta =
      msg.role === 'user'
        ? `Você • ${escapeHtml(msg.time || '')}`
        : `YacaCode AI (${escapeHtml(msg.model || state.aiStatus?.model || 'Gemini')}) • ${escapeHtml(msg.time || '')}`;

    return `
      <div class="ai-msg ${roleClass}${animClass}">
        ${actionsHtml}
        <div class="ai-bubble">${bubbleContent}</div>
        ${pendingHtml}
        <span class="ai-msg-meta">${meta}</span>
      </div>
    `;
  });
  state.aiLastAnimatedIdx = state.aiMessages.length - 1;

  if (state.aiSending) {
    const phrase = AI_THINKING_PHRASES[state.aiThinkingPhase % AI_THINKING_PHRASES.length];
    parts.push(`
      <div class="ai-msg ai-msg-model is-new" id="ai-thinking-bubble">
        <div class="ai-bubble ai-bubble-thinking">
          <span class="ai-typing">
            <span class="ai-sparkle" aria-hidden="true">✦</span>
            <span id="ai-thinking-text" class="ai-typing-label">${escapeHtml(phrase)}</span>
            <span class="ai-typing-dots" aria-hidden="true"><i></i><i></i><i></i></span>
          </span>
        </div>
        <span class="ai-msg-meta">YacaCode AI • processando</span>
      </div>
    `);
  }

  box.innerHTML = parts.join('');
  box.scrollTop = box.scrollHeight;
}

function startAiThinkingIndicator() {
  stopAiThinkingIndicator();
  state.aiThinkingPhase = 0;
  const sendBtn = $('#btn-ai-send');
  if (sendBtn) {
    sendBtn.disabled = true;
    sendBtn.innerHTML = '<span class="btn-spinner" aria-hidden="true"></span> Pensando';
  }
  state.aiThinkingTimer = setInterval(() => {
    state.aiThinkingPhase = (state.aiThinkingPhase + 1) % AI_THINKING_PHRASES.length;
    const label = $('#ai-thinking-text');
    if (label) {
      label.textContent = AI_THINKING_PHRASES[state.aiThinkingPhase];
    }
  }, 1500);
}

function stopAiThinkingIndicator() {
  if (state.aiThinkingTimer) {
    clearInterval(state.aiThinkingTimer);
    state.aiThinkingTimer = null;
  }
  const sendBtn = $('#btn-ai-send');
  if (sendBtn) {
    sendBtn.disabled = false;
    sendBtn.textContent = 'Enviar';
  }
}

function nowTimeStr() {
  return new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

async function sendAiMessage(text) {
  if (state.aiSending) return;
  const clean = String(text || '').trim();
  if (!clean) return;

  if (state.aiStatus && !state.aiStatus.configured) {
    toast('Configure a Gemini API Key primeiro.', 'warn');
    if (state.aiStatus.permissions?.canConfigure) openAiConfigModal();
    return;
  }

  const history = state.aiMessages
    .filter((m) => m.role === 'user' || m.role === 'model')
    .slice(-14)
    .map((m) => ({ role: m.role, text: m.text }));

  state.aiMessages.push({ role: 'user', text: clean, time: nowTimeStr() });
  state.aiSending = true;
  startAiThinkingIndicator();
  renderAiMessages();

  try {
    const res = await api('/api/ai/chat', {
      method: 'POST',
      body: {
        message: clean,
        history,
        conversationId: state.aiActiveConversationId || undefined,
      },
    });
    if (res.conversationId) {
      state.aiActiveConversationId = res.conversationId;
    }
    state.aiMessages.push({
      id: res.assistantMessage?.id,
      role: 'model',
      text: res.reply,
      model: res.model,
      actions: res.actions || [],
      pendingActions: res.pendingActions || [],
      time: res.assistantMessage?.time || nowTimeStr(),
    });
    loadAiConversations(true);
  } catch (err) {
    state.aiMessages.push({
      role: 'model',
      text: `Não consegui concluir: ${err.message}`,
      actions: [{ label: 'Erro na solicitação', status: 'error', output: err.message }],
      time: nowTimeStr(),
    });
    toast(err.message, 'error');
  } finally {
    state.aiSending = false;
    stopAiThinkingIndicator();
    renderAiMessages();
  }
}

async function handleAiPendingDecision(actionId, decision) {
  try {
    const res = await api('/api/ai/confirm', {
      method: 'POST',
      body: { actionId, decision },
    });
    for (const msg of state.aiMessages) {
      if (!Array.isArray(msg.pendingActions)) continue;
      const found = msg.pendingActions.find((p) => p.id === actionId);
      if (found) {
        found.resolution = res.status;
        found.resolvedOutput = res.output || res.summary;
        found.output = res.output || res.summary;
      }
    }
    renderAiMessages();
    toast(res.summary || 'Ação processada.', res.status === 'executed' ? 'ok' : 'warn');
  } catch (err) {
    toast(err.message, 'error');
  }
}

function openAiConfigModal() {
  const dialog = $('#ai-config-dialog');
  const status = state.aiStatus || {};
  $('#ai-config-key').value = '';
  const sel = $('#ai-config-model');
  if (Array.isArray(status.availableModels) && status.availableModels.length > 0) {
    sel.innerHTML = status.availableModels
      .map((m) => `<option value="${escapeHtml(m.id)}">${escapeHtml(m.label)}</option>`)
      .join('');
  }
  if (status.model) {
    if (!Array.from(sel.options).some((o) => o.value === status.model)) {
      const opt = document.createElement('option');
      opt.value = status.model;
      opt.textContent = status.model;
      sel.appendChild(opt);
    }
    sel.value = status.model;
  }
  $('#ai-config-current').textContent = status.configured
    ? `Chave atual (${status.source}): ${status.maskedKey || 'configurada'}`
    : 'Nenhuma chave configurada ainda.';
  const inGameChk = $('#ai-config-ingame');
  if (inGameChk) inGameChk.checked = status.inGameChatEnabled !== false;
  dialog.showModal();
  $('#ai-config-key').focus();
}

async function saveAiConfig(e) {
  e.preventDefault();
  const apiKey = $('#ai-config-key').value.trim();
  const model = $('#ai-config-model').value;
  const inGameChatEnabled = $('#ai-config-ingame')?.checked;
  try {
    const updated = await api('/api/ai/config', {
      method: 'PUT',
      body: { apiKey: apiKey || undefined, model, inGameChatEnabled },
    });
    state.aiStatus = updated;
    renderAiStatus(updated);
    $('#ai-config-dialog').close();
    toast('Configuração da IA Gemini salva com sucesso!');
  } catch (err) {
    toast(err.message, 'error');
  }
}

// ----------------------------------------------------------------------------
// WHATSAPP IA (QR Code + Grupo + Notificações + Logs)
// ----------------------------------------------------------------------------
function stopWhatsAppPolling() {
  if (state.waPollTimer) {
    clearInterval(state.waPollTimer);
    state.waPollTimer = null;
  }
}

function ensureWhatsAppPolling() {
  if (state.waPollTimer) return;
  state.waPollTimer = setInterval(() => {
    if (state.activeTab !== 'whatsapp') {
      stopWhatsAppPolling();
      return;
    }
    loadWhatsAppStatus(true);
  }, 3000);
}

function renderWhatsAppGroupOptions(selectedJid, selectedName) {
  const sel = $('#wa-cfg-group');
  if (!sel) return;
  const groups = Array.isArray(state.waGroups) ? state.waGroups : [];
  const opts = ['<option value="">Nenhum grupo selecionado</option>'];
  let foundSelected = false;
  for (const g of groups) {
    const isSel = selectedJid && g.jid === selectedJid;
    if (isSel) foundSelected = true;
    opts.push(
      `<option value="${escapeHtml(g.jid)}" data-name="${escapeHtml(g.subject)}" ${isSel ? 'selected' : ''}>${escapeHtml(g.subject)} (${g.participantsCount || 0})</option>`
    );
  }
  if (selectedJid && !foundSelected) {
    opts.push(
      `<option value="${escapeHtml(selectedJid)}" data-name="${escapeHtml(selectedName || selectedJid)}" selected>${escapeHtml(selectedName || selectedJid)}</option>`
    );
  }
  sel.innerHTML = opts.join('');
}

function renderWhatsAppStatus(data) {
  if (!data) return;
  state.waStatus = data;
  const bridge = data.bridge || {};
  const cfg = data.config || {};
  const st = bridge.state || 'disconnected';

  const navBadge = $('#nav-wa-badge');
  if (navBadge) {
    navBadge.textContent = st === 'connected' ? 'ON' : st === 'qr' ? 'QR' : 'OFF';
  }

  const pill = $('#wa-status-pill');
  const qrBox = $('#wa-qr-container');
  const qrImg = $('#wa-qr-img');
  const connBox = $('#wa-connected-info');
  const noteEl = $('#wa-status-note');
  const btnConnect = $('#btn-wa-connect');
  const btnDisconnect = $('#btn-wa-disconnect');
  const btnLogout = $('#btn-wa-logout');
  const aiWarn = $('#wa-ai-warning');

  if (aiWarn) aiWarn.classList.toggle('hidden', Boolean(data.aiConfigured));

  if (pill) {
    if (st === 'connected') {
      pill.textContent = 'Conectado';
      pill.className = 'pill pill-ok';
    } else if (st === 'qr') {
      pill.textContent = 'Aguardando QR Code';
      pill.className = 'pill pill-warn';
    } else if (st === 'connecting') {
      pill.textContent = 'Conectando...';
      pill.className = 'pill pill-info';
    } else if (st === 'offline') {
      pill.textContent = 'Serviço offline';
      pill.className = 'pill pill-danger';
    } else {
      pill.textContent = 'Desconectado';
      pill.className = 'pill pill-muted';
    }
  }

  if (qrBox && qrImg) {
    if (st === 'qr' && bridge.qrDataUrl) {
      qrImg.src = bridge.qrDataUrl;
      qrBox.classList.remove('hidden');
    } else {
      qrBox.classList.add('hidden');
    }
  }

  if (connBox) {
    if (st === 'connected') {
      connBox.classList.remove('hidden');
      $('#wa-account-name').textContent = bridge.pushName || 'WhatsApp conectado';
      $('#wa-account-phone').textContent = bridge.phone ? `+${bridge.phone}` : 'Sessão ativa';
    } else {
      connBox.classList.add('hidden');
    }
  }

  if (noteEl) {
    if (bridge.lastError) {
      noteEl.textContent = bridge.lastError;
    } else if (st === 'connected') {
      noteEl.textContent = 'Sessão conectada e pronta para responder perguntas e enviar avisos automáticos.';
    } else if (st === 'qr') {
      noteEl.textContent = 'Escaneie o QR Code acima com o WhatsApp. Esta tela atualiza sozinha assim que conectar.';
    } else if (st === 'connecting') {
      noteEl.textContent = 'Inicializando conexão segura com o WhatsApp...';
    } else {
      noteEl.textContent = 'Clique em "Conectar / Gerar QR" para parear o WhatsApp com a IA do servidor.';
    }
  }

  if (btnConnect) btnConnect.classList.toggle('hidden', st === 'connected');
  if (btnDisconnect) btnDisconnect.classList.toggle('hidden', st !== 'connected' && st !== 'qr' && st !== 'connecting');
  if (btnLogout) btnLogout.classList.toggle('hidden', st !== 'connected' && !bridge.hasSession);

  if (st === 'qr' || st === 'connecting') {
    ensureWhatsAppPolling();
  } else {
    stopWhatsAppPolling();
  }

  // Preenche formulário apenas se o usuário não estiver digitando nele
  const form = $('#wa-config-form');
  if (form && !form.contains(document.activeElement)) {
    $('#wa-cfg-enabled').checked = cfg.enabled !== false;
    $('#wa-cfg-bot-name').value = cfg.botName || 'Jorge';
    $('#wa-cfg-respond-group').checked = cfg.respondInGroup !== false;
    $('#wa-cfg-respond-private').checked = cfg.respondInPrivate !== false;
    $('#wa-cfg-notify-backup').checked = cfg.notifyBackup !== false;
    $('#wa-cfg-notify-status').checked = cfg.notifyServerStatus !== false;
    $('#wa-cfg-notify-players').checked = Boolean(cfg.notifyPlayerJoinLeave);
    const dailyChk = $('#wa-cfg-daily-report');
    if (dailyChk) dailyChk.checked = Boolean(cfg.dailyReportEnabled);
    const dailyHour = $('#wa-cfg-daily-hour');
    if (dailyHour && cfg.dailyReportHour !== undefined) {
      dailyHour.value = String(cfg.dailyReportHour);
    }
    $('#wa-cfg-allowed-private').value = Array.isArray(cfg.allowedPrivateNumbers)
      ? cfg.allowedPrivateNumbers.join(', ')
      : '';
    renderWhatsAppGroupOptions(cfg.groupJid || '', cfg.groupName || '');
  }

  // Logs recentes
  const logsEl = $('#wa-logs-list');
  if (logsEl) {
    const logs = Array.isArray(data.recentLogs) ? data.recentLogs : [];
    if (!logs.length) {
      logsEl.innerHTML = '<p class="muted-text">Nenhuma atividade registrada ainda.</p>';
    } else {
      logsEl.innerHTML = logs
        .map(
          (l) => `
          <div class="wa-log-item">
            <div class="wa-log-head">
              <strong>${escapeHtml(l.summary)}</strong>
              <small class="muted-text">${escapeHtml(formatDate(l.ts))}</small>
            </div>
            ${l.details ? `<div class="wa-log-details">${escapeHtml(l.details)}</div>` : ''}
          </div>`
        )
        .join('');
    }
  }
}

async function loadWhatsAppStatus(silent = false) {
  try {
    const data = await api('/api/whatsapp/status');
    renderWhatsAppStatus(data);
    if (data.bridge?.state === 'connected' && state.waGroups.length === 0 && state.activeTab === 'whatsapp') {
      loadWhatsAppGroups(true);
    }
  } catch (err) {
    if (!silent) toast(`WhatsApp IA: ${err.message}`, 'warn');
  }
}

async function loadWhatsAppGroups(silent = false) {
  try {
    const data = await api('/api/whatsapp/groups');
    state.waGroups = Array.isArray(data.groups) ? data.groups : [];
    const cfg = state.waStatus?.config || {};
    renderWhatsAppGroupOptions(cfg.groupJid || '', cfg.groupName || '');
    if (!silent) toast(`${state.waGroups.length} grupo(s) carregado(s).`);
  } catch (err) {
    if (!silent) toast(err.message, 'warn');
  }
}

async function connectWhatsApp() {
  try {
    await api('/api/whatsapp/connect', { method: 'POST', body: {} });
    toast('Gerando QR Code do WhatsApp...');
    await loadWhatsAppStatus(false);
    ensureWhatsAppPolling();
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function disconnectWhatsApp(logout = false) {
  if (logout) {
    const ok = await confirmDialog(
      'Trocar número do WhatsApp',
      'Isso encerrará a sessão atual e apagará as credenciais salvas para parear outro número via QR Code. Deseja continuar?',
      'Desconectar e Limpar',
      true
    );
    if (!ok) return;
  }
  try {
    await api('/api/whatsapp/disconnect', { method: 'POST', body: { logout } });
    toast(logout ? 'Sessão removida. Você já pode parear outro número.' : 'WhatsApp desconectado.');
    state.waGroups = [];
    await loadWhatsAppStatus(true);
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function saveWhatsAppConfig(e) {
  e.preventDefault();
  const sel = $('#wa-cfg-group');
  const selectedOpt = sel?.options?.[sel.selectedIndex];
  const groupJid = sel?.value || '';
  const groupName = selectedOpt?.dataset?.name || (groupJid ? selectedOpt?.textContent || '' : '');

  try {
    await api('/api/whatsapp/config', {
      method: 'PUT',
      body: {
        enabled: $('#wa-cfg-enabled').checked,
        botName: $('#wa-cfg-bot-name').value.trim() || 'Jorge',
        groupJid,
        groupName,
        respondInGroup: $('#wa-cfg-respond-group').checked,
        respondInPrivate: $('#wa-cfg-respond-private').checked,
        notifyBackup: $('#wa-cfg-notify-backup').checked,
        notifyServerStatus: $('#wa-cfg-notify-status').checked,
        notifyPlayerJoinLeave: $('#wa-cfg-notify-players').checked,
        dailyReportEnabled: Boolean($('#wa-cfg-daily-report')?.checked),
        dailyReportHour: Number($('#wa-cfg-daily-hour')?.value || 21),
        allowedPrivateNumbers: $('#wa-cfg-allowed-private').value,
      },
    });
    toast('Configurações do WhatsApp IA salvas!');
    await loadWhatsAppStatus(true);
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function sendWhatsAppTest() {
  try {
    await api('/api/whatsapp/test', { method: 'POST', body: {} });
    toast('Mensagem de teste enviada no grupo do WhatsApp!');
    await loadWhatsAppStatus(true);
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function sendWhatsAppDailyReportNow() {
  try {
    await api('/api/whatsapp/daily-report', { method: 'POST', body: {} });
    toast('Resumo diário enviado no grupo do WhatsApp!');
    await loadWhatsAppStatus(true);
  } catch (err) {
    toast(err.message, 'error');
  }
}

function bindWhatsAppEvents() {
  $('#btn-wa-connect')?.addEventListener('click', connectWhatsApp);
  $('#btn-wa-refresh')?.addEventListener('click', () => loadWhatsAppStatus(false));
  $('#btn-wa-disconnect')?.addEventListener('click', () => disconnectWhatsApp(false));
  $('#btn-wa-logout')?.addEventListener('click', () => disconnectWhatsApp(true));
  $('#btn-wa-load-groups')?.addEventListener('click', () => loadWhatsAppGroups(false));
  $('#wa-config-form')?.addEventListener('submit', saveWhatsAppConfig);
  $('#btn-wa-test')?.addEventListener('click', sendWhatsAppTest);
  $('#btn-wa-daily-now')?.addEventListener('click', sendWhatsAppDailyReportNow);
}

bindEvents();
bindWhatsAppEvents();
bootstrap();


// ----------------------------------------------------------------------------
// CONSOLE: LATERAL "SERVER AGORA" (TPS, TEMPO POR TICK, CPU, RAM, JOGADORES)
// ----------------------------------------------------------------------------
function cmLevel(el, level) {
  el.classList.remove('cm-ok', 'cm-warn', 'cm-bad');
  if (level) el.classList.add(`cm-${level}`);
}

function fmtGb(bytes) {
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

async function refreshConsoleMetrics() {
  try {
    const m = await api('/api/console/metrics');
    const tpsEl = $('#cm-tps');
    if (!m.running) {
      tpsEl.textContent = 'offline';
      cmLevel(tpsEl, 'bad');
      ['#cm-mspt', '#cm-cpu', '#cm-ram', '#cm-players'].forEach((id) => ($(id).textContent = '—'));
    } else {
      if (m.tps) {
        tpsEl.textContent = m.tps.m1.toFixed(1);
        cmLevel(tpsEl, m.tps.m1 >= 19 ? 'ok' : m.tps.m1 >= 15 ? 'warn' : 'bad');
        $('#cm-tps-sub').textContent = `${m.tps.m1.toFixed(1)} / ${m.tps.m5.toFixed(1)} / ${m.tps.m15.toFixed(1)} (1m / 5m / 15m)`;
      }
      if (m.mspt) {
        const el = $('#cm-mspt');
        el.textContent = `${m.mspt.avg.toFixed(1)} ms`;
        cmLevel(el, m.mspt.avg < 35 ? 'ok' : m.mspt.avg < 50 ? 'warn' : 'bad');
        $('#cm-mspt-sub').textContent = `média ${m.mspt.avg.toFixed(1)} · pior ${m.mspt.max.toFixed(0)} ms (10s) · limite 50 ms`;
      }
      if (m.cpuPercent != null) {
        const el = $('#cm-cpu');
        el.textContent = `${m.cpuPercent.toFixed(0)}%${m.cpuCoresUsed != null ? ` · ${m.cpuCoresUsed} núcleos` : ''}`;
        cmLevel(el, m.cpuPercent < 60 ? 'ok' : m.cpuPercent < 85 ? 'warn' : 'bad');
        $('#cm-cpu-bar').style.width = `${Math.min(100, m.cpuPercent)}%`;
      }
      if (m.memUsedBytes != null && m.memLimitBytes) {
        const pct = (m.memUsedBytes / m.memLimitBytes) * 100;
        const el = $('#cm-ram');
        el.textContent = `${fmtGb(m.memUsedBytes)} de ${fmtGb(m.memLimitBytes)}`;
        cmLevel(el, pct < 80 ? 'ok' : pct < 92 ? 'warn' : 'bad');
        $('#cm-ram-bar').style.width = `${Math.min(100, pct)}%`;
      }
      if (m.players) {
        $('#cm-players').textContent = `${m.players.online} / ${m.players.max}`;
        $('#cm-players-list').textContent = m.players.names.length ? m.players.names.join(', ') : 'Ninguém online';
      }
    }
    const tempEl = $('#cm-temp');
    if (m.tempC != null) {
      tempEl.textContent = `${Math.round(m.tempC)} °C`;
      cmLevel(tempEl, m.tempC < 65 ? 'ok' : m.tempC < 75 ? 'warn' : 'bad');
    }
    $('#cm-updated').textContent = `atualizado ${new Date().toLocaleTimeString('pt-BR')}`;
  } catch {
    $('#cm-updated').textContent = 'sem dados';
  }
}

function startConsoleMetrics() {
  stopConsoleMetrics();
  refreshConsoleMetrics();
  state.consoleMetricsTimer = setInterval(() => {
    if (!document.hidden) refreshConsoleMetrics();
  }, 5000);
}

function stopConsoleMetrics() {
  if (state.consoleMetricsTimer) {
    clearInterval(state.consoleMetricsTimer);
    state.consoleMetricsTimer = null;
  }
}

// ----------------------------------------------------------------------------
// CONFIGURAÇÕES: PARÂMETROS DA JVM
// ----------------------------------------------------------------------------
async function loadJvmArgs() {
  const card = $('#jvm-card');
  if (!card) return;
  const isAdmin = state.currentUser?.role === 'admin';
  card.classList.toggle('hidden', !isAdmin);
  if (!isAdmin) return;
  try {
    const data = await api('/api/config/jvm');
    $('#jvm-args').value = data.args || '';
    $('#jvm-status').textContent = data.rejected
      ? `O Java recusou estes parâmetros no último início e o server subiu com os padrões: ${data.rejected.replace(/\s+/g, ' ')}`
      : data.args
      ? ''
      : 'Nenhum parâmetro extra (usando os padrões do server).';
  } catch (err) {
    $('#jvm-status').textContent = `Não foi possível ler: ${err.message}`;
  }
}

async function saveJvmArgs() {
  const btn = $('#btn-save-jvm');
  btn.disabled = true;
  try {
    const data = await api('/api/config/jvm', { method: 'PUT', body: { args: $('#jvm-args').value } });
    $('#jvm-args').value = data.args || '';
    $('#jvm-status').textContent = 'Salvo. Reinicie o server para aplicar.';
    toast('Parâmetros da JVM salvos — reinicie o server para aplicar.');
  } catch (err) {
    $('#jvm-status').textContent = err.message;
    toast(err.message, 'error');
  } finally {
    btn.disabled = false;
  }
}

document.addEventListener('DOMContentLoaded', () => {
  $('#btn-save-jvm')?.addEventListener('click', saveJvmArgs);
});
