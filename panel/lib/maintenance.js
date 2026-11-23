// ============================================================================
// Manutenção automática do server
// 1. Pré-geração do mapa com o Chunky: só roda com o server vazio. Pausa quando
//    alguém entra e retoma alguns minutos depois que o último sai (depois do
//    backup pós-logout). Para sozinha quando termina.
// 2. Reinício diário: num horário fixo, só se ninguém estiver online e o server
//    estiver rodando há tempo suficiente (um processo Java de muitas horas acumula
//    custo e fica mais lento; reiniciado volta a ficar leve).
// ============================================================================
import fs from 'node:fs';

const DEFAULTS = {
  pregen: {
    enabled: false,
    world: 'world',
    centerX: 0,
    centerZ: 0,
    radius: 1500,
    state: 'idle', // idle | starting | running | paused | done
    startedAt: null,
    finishedAt: null,
  },
  dailyRestart: {
    enabled: true,
    hour: 5,
    minUptimeHours: 6,
    lastRestartDate: null,
  },
};

const plain = (s) => String(s || '').replace(/\x1b\[[0-9;]*m/g, '').replace(/§./g, '');

export function createMaintenanceManager({
  configFile,
  sendCommand,
  getOnlineCount,
  getUptimeMs,
  restartServer,
  log = (msg) => console.log(`[YacaCode Manutenção] ${msg}`),
  resumeDelayMs = 5 * 60 * 1000,
  now = () => new Date(),
  timeZone = process.env.TZ || 'America/Fortaleza',
}) {
  let resumeTimer = null;
  let tickTimer = null;
  let backupHoldUntil = 0; // enquanto houver backup compactando, a pré-geração não retoma

  function load() {
    let raw = {};
    try {
      if (configFile && fs.existsSync(configFile)) raw = JSON.parse(fs.readFileSync(configFile, 'utf8'));
    } catch {
      raw = {};
    }
    return {
      pregen: { ...DEFAULTS.pregen, ...(raw.pregen || {}) },
      dailyRestart: { ...DEFAULTS.dailyRestart, ...(raw.dailyRestart || {}) },
    };
  }

  function save(cfg) {
    if (!configFile) return;
    fs.writeFileSync(configFile, JSON.stringify(cfg, null, 2), 'utf8');
  }

  function update(mutator) {
    const cfg = load();
    mutator(cfg);
    save(cfg);
    return cfg;
  }

  async function online() {
    try {
      return Number(await getOnlineCount()) || 0;
    } catch {
      return 0;
    }
  }

  // ---------------------------------------------------------------- pré-geração
  async function chunky(cmd) {
    return plain(await sendCommand(`chunky ${cmd}`));
  }

  async function startOrResumePregen() {
    const cfg = load();
    if (!cfg.pregen.enabled || ['done', 'running', 'starting'].includes(cfg.pregen.state)) return false;
    if (Date.now() < backupHoldUntil) return false;
    if ((await online()) > 0) return false;
    const p = cfg.pregen;
    const previousState = p.state;
    // "starting" já conta como ativo: se alguém entrar no meio dos comandos, o join pausa
    update((c) => {
      c.pregen.state = 'starting';
    });
    let out;
    try {
      if (previousState === 'paused') {
        out = await chunky('continue');
        if (/no tasks|nenhuma/i.test(out)) out = null; // tarefa perdida: recomeça (chunks prontos são pulados)
      }
      if (!out) {
        await chunky(`world ${p.world}`);
        await chunky(`center ${p.centerX} ${p.centerZ}`);
        await chunky(`radius ${p.radius}`);
        out = await chunky('start');
      }
    } catch (err) {
      // RCON fora do ar: volta ao estado anterior para o tick tentar de novo
      update((c) => {
        if (c.pregen.state === 'starting') c.pregen.state = previousState === 'idle' ? 'idle' : 'paused';
      });
      throw err;
    }
    if (load().pregen.state !== 'starting') {
      // alguém entrou enquanto os comandos rodavam: o join já mudou o estado para "paused"
      await chunky('pause').catch(() => '');
      return false;
    }
    update((c) => {
      c.pregen.state = 'running';
      c.pregen.startedAt = c.pregen.startedAt || now().toISOString();
    });
    if ((await online()) > 0) {
      await pausePregen('jogador entrou durante o início');
      return false;
    }
    log(`pré-geração ${previousState === 'paused' ? 'retomada' : 'iniciada'} (raio ${p.radius} blocos)`);
    return true;
  }

  async function pausePregen(reason) {
    const cfg = load();
    if (!['running', 'starting'].includes(cfg.pregen.state)) return false;
    update((c) => {
      c.pregen.state = 'paused';
    });
    await chunky('pause').catch(() => '');
    update((c) => {
      c.pregen.state = 'paused';
    });
    log(`pré-geração pausada (${reason})`);
    return true;
  }

  // Linha de log do Chunky avisando que terminou
  function onLogLine(line) {
    if (/\[Chunky\].*(Task finished|completed|Tarefa concluída)/i.test(plain(line))) {
      const cfg = load();
      if (cfg.pregen.state === 'running') {
        update((c) => {
          c.pregen.state = 'done';
          c.pregen.finishedAt = now().toISOString();
        });
        log('pré-geração concluída');
      }
    }
  }

  async function onPlayerJoin() {
    if (resumeTimer) {
      clearTimeout(resumeTimer);
      resumeTimer = null;
    }
    if (await pausePregen('jogador entrou')) return true;
    // estado pode estar desatualizado (ex.: painel reiniciou): pausar é inofensivo se não houver tarefa
    if (load().pregen.enabled && load().pregen.state !== 'done') await chunky('pause').catch(() => '');
    return false;
  }

  function onPlayerLeave() {
    if (resumeTimer) clearTimeout(resumeTimer);
    resumeTimer = setTimeout(() => {
      resumeTimer = null;
      startOrResumePregen().catch((err) => log(`erro ao retomar pré-geração: ${err.message}`));
    }, resumeDelayMs);
    resumeTimer.unref?.();
  }

  // ------------------------------------------------------------ reinício diário
  function localDateHour(d) {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      hour12: false,
    }).formatToParts(d);
    const get = (t) => parts.find((p) => p.type === t)?.value;
    return { date: `${get('year')}-${get('month')}-${get('day')}`, hour: Number(get('hour')) % 24 };
  }

  async function maybeDailyRestart() {
    const cfg = load();
    const r = cfg.dailyRestart;
    if (!r.enabled) return false;
    const { date, hour } = localDateHour(now());
    if (hour !== Number(r.hour) || r.lastRestartDate === date) return false;
    if ((await online()) > 0) return false;
    const uptime = Number(await getUptimeMs().catch(() => 0)) || 0;
    if (uptime < Number(r.minUptimeHours) * 3600 * 1000) return false;
    update((c) => {
      c.dailyRestart.lastRestartDate = date;
      if (c.pregen.state === 'running') c.pregen.state = 'paused'; // o Chunky é retomado depois do boot
    });
    log(`reinício diário (server vazio, ${(uptime / 3600000).toFixed(1)}h rodando)`);
    await sendCommand('chunky pause').catch(() => '');
    await restartServer();
    return true;
  }

  async function tick() {
    await maybeDailyRestart().catch((err) => log(`erro no reinício diário: ${err.message}`));
    // "rodando" no arquivo mas o Chunky não tem tarefa (crash, reinício fora do diário): volta para pausada
    if (load().pregen.state === 'running') {
      const out = await chunky('progress').catch(() => null);
      if (out !== null && /no tasks running|nenhuma tarefa/i.test(out)) {
        update((c) => {
          c.pregen.state = 'paused';
        });
        log('pré-geração estava parada no Chunky; será retomada');
      }
    }
    // retoma depois de reinícios/boot (o painel pode ter reiniciado junto)
    const cfg = load();
    if (cfg.pregen.enabled && cfg.pregen.state !== 'done' && cfg.pregen.state !== 'running' && !resumeTimer) {
      if ((await online()) === 0) await startOrResumePregen().catch(() => false);
    }
  }

  function start(intervalMs = 60 * 1000) {
    stop();
    // painel pode ter reiniciado no meio de um início
    if (load().pregen.state === 'starting') update((c) => { c.pregen.state = 'paused'; });
    tickTimer = setInterval(() => tick().catch(() => {}), intervalMs);
    tickTimer.unref?.();
  }

  function stop() {
    if (tickTimer) clearInterval(tickTimer);
    if (resumeTimer) clearTimeout(resumeTimer);
    tickTimer = null;
    resumeTimer = null;
  }

  async function holdForBackup() {
    backupHoldUntil = Date.now() + 30 * 60 * 1000; // trava de segurança: libera sozinha em 30 min
    return pausePregen('backup');
  }

  function releaseBackupHold() {
    backupHoldUntil = 0;
  }

  function configurePregen(patch = {}) {
    return update((c) => {
      for (const k of ['enabled', 'world', 'centerX', 'centerZ', 'radius']) {
        if (patch[k] !== undefined) c.pregen[k] = patch[k];
      }
      if (patch.reset) {
        c.pregen.state = 'idle';
        c.pregen.startedAt = null;
        c.pregen.finishedAt = null;
      }
    }).pregen;
  }

  return {
    start,
    stop,
    tick,
    onLogLine,
    onPlayerJoin,
    onPlayerLeave,
    startOrResumePregen,
    pausePregen,
    holdForBackup,
    releaseBackupHold,
    maybeDailyRestart,
    configurePregen,
    getStatus: () => load(),
  };
}
