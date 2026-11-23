// Parâmetros extras da JVM do servidor (lidos pelo Java via @arquivo a cada inicialização).
// O compose passa `@/data/.yacacode-jvm-args.txt` no JVM_OPTS; estes parâmetros vêm por último,
// então também podem ajustar a memória (-Xmx/-Xms), limitada ao que cabe no container.
import fs from 'node:fs';
import path from 'node:path';

export const JVM_ARGS_FILENAME = '.yacacode-jvm-args.txt';
const MAX_HEAP_MB = 2048; // container tem 2560 MB; sobra espaço para a memória fora do heap
const DEFAULT_XMS_MB = 1024; // INIT_MEMORY do compose (o itzg põe -Xms antes destes parâmetros)
const DEFAULT_XMX_MB = 2048; // MAX_MEMORY do compose

// Só estes formatos são aceitos (lista do que é permitido, não do que é proibido)
const ALLOWED = [
  /^-XX:[+-][A-Za-z][A-Za-z0-9]{1,80}$/, // liga/desliga: -XX:+UseG1GC
  /^-XX:[A-Za-z][A-Za-z0-9]{1,80}=[A-Za-z0-9.,:%_-]{1,80}$/, // valor: -XX:MaxGCPauseMillis=200
  /^-D[A-Za-z][A-Za-z0-9._-]{0,80}=[A-Za-z0-9.,:%_/-]{0,120}$/, // propriedade: -Dpaper.x=true
  /^-Xm[sx]\d+[kKmMgG]?$/, // memória
  /^-Xss\d+[kKmM]?$/, // pilha das threads
];
// Executam comandos ou trocam classes do Java: nunca
const FORBIDDEN = /OnError|OnOutOfMemoryError|bootclasspath|agentlib|agentpath|javaagent|^@/i;

function toMb(value) {
  const m = String(value).match(/^(\d+)([kKmMgG]?)$/);
  if (!m) return null;
  const n = Number(m[1]);
  const unit = m[2].toLowerCase();
  if (unit === 'g') return n * 1024;
  if (unit === 'm') return n;
  if (unit === 'k') return n / 1024;
  return n / (1024 * 1024);
}

export function validateJvmArgs(text) {
  const clean = String(text ?? '').replace(/\r/g, '').trim();
  if (clean.length > 2000) return { ok: false, error: 'Texto grande demais (máximo 2000 caracteres).' };
  const tokens = clean ? clean.split(/\s+/) : [];
  let xms = DEFAULT_XMS_MB;
  let xmx = DEFAULT_XMX_MB;
  for (const t of tokens) {
    if (!t.startsWith('-')) return { ok: false, error: `"${t}" não é um parâmetro da JVM (todo parâmetro começa com "-").` };
    if (FORBIDDEN.test(t)) return { ok: false, error: `"${t}" não é permitido aqui.` };
    if (!ALLOWED.some((re) => re.test(t))) {
      return { ok: false, error: `"${t}" não está num formato aceito (use -XX:+Flag, -XX:Nome=valor, -Dprop=valor, -Xmx/-Xms ou -Xss).` };
    }
    const mem = t.match(/^-Xm([xs])(.+)$/);
    if (mem) {
      const mb = toMb(mem[2]);
      if (mb === null) return { ok: false, error: `Valor de memória inválido em "${t}" (use ex.: -Xmx2G ou -Xmx1536M).` };
      if (mb > MAX_HEAP_MB) return { ok: false, error: `"${t}" passa do máximo de ${MAX_HEAP_MB} MB que cabe no container (2,5 GB).` };
      if (mb < 512) return { ok: false, error: `"${t}" é pouco demais (mínimo 512 MB).` };
      if (mem[1] === 'x') xmx = mb;
      else xms = mb;
    }
  }
  if (xms > xmx) {
    return { ok: false, error: `Memória inicial (${xms} MB) maior que a máxima (${xmx} MB): o Java não inicia. O padrão do server é -Xms${DEFAULT_XMS_MB}M; ajuste -Xms junto.` };
  }
  return { ok: true, args: tokens.join('\n') };
}

export function createJvmArgsStore(dataDir) {
  const file = path.join(dataDir, JVM_ARGS_FILENAME);

  function ensureFile() {
    // O Java não inicia se o @arquivo não existir: garante sempre um arquivo (vazio) no lugar.
    if (!fs.existsSync(file)) {
      fs.writeFileSync(file, '', 'utf8');
      try {
        fs.chmodSync(file, 0o644);
      } catch {
        // ignore
      }
    }
  }

  function read() {
    ensureFile();
    return fs.readFileSync(file, 'utf8').trim();
  }

  function writeValidated(text) {
    const v = validateJvmArgs(text);
    if (!v.ok) throw Object.assign(new Error(v.error), { status: 400 });
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, v.args ? `${v.args}\n` : '', 'utf8');
    fs.renameSync(tmp, file);
    try {
      fs.chmodSync(file, 0o644);
    } catch {
      // ignore
    }
    return v.args;
  }

  // Parâmetros que o Java recusou no último boot (o jvm-guard.sh guarda como .invalido)
  function readRejected() {
    try {
      return fs.readFileSync(`${file}.invalido`, 'utf8').trim() || null;
    } catch {
      return null;
    }
  }

  function write(text) {
    const args = writeValidated(text);
    try {
      fs.rmSync(`${file}.invalido`, { force: true });
    } catch {
      // ignore
    }
    return args;
  }

  return { file, ensureFile, read, write, readRejected };
}
