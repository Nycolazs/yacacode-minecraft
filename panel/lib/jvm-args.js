// Parâmetros extras da JVM do servidor (lidos pelo Java via @arquivo a cada inicialização).
// O compose passa `@/data/.yacacode-jvm-args.txt` no JVM_OPTS; estes parâmetros vêm por último,
// então também podem ajustar a memória (-Xmx/-Xms), limitada ao que cabe no container.
import fs from 'node:fs';
import path from 'node:path';

export const JVM_ARGS_FILENAME = '.yacacode-jvm-args.txt';
const MAX_HEAP_MB = 2048; // container tem 2560 MB; sobra espaço para a memória fora do heap
const FORBIDDEN = [/^-jar$/i, /^-cp$/i, /^-classpath$/i, /^--class-path$/i, /^@/, /^-javaagent:/i, /^-agentlib:/i, /^-agentpath:/i];

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
  for (const t of tokens) {
    if (!t.startsWith('-')) return { ok: false, error: `"${t}" não é um parâmetro da JVM (todo parâmetro começa com "-").` };
    if (FORBIDDEN.some((re) => re.test(t))) return { ok: false, error: `"${t}" não é permitido aqui.` };
    if (/[`$;|&<>"'\\]/.test(t)) return { ok: false, error: `"${t}" tem caracteres não permitidos.` };
    const mem = t.match(/^-Xm[xs](.+)$/);
    if (mem) {
      const mb = toMb(mem[1]);
      if (mb === null) return { ok: false, error: `Valor de memória inválido em "${t}" (use ex.: -Xmx2G ou -Xmx1536M).` };
      if (mb > MAX_HEAP_MB) return { ok: false, error: `"${t}" passa do máximo de ${MAX_HEAP_MB} MB que cabe no container (2,5 GB).` };
      if (mb < 512) return { ok: false, error: `"${t}" é pouco demais (mínimo 512 MB).` };
    }
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

  function write(text) {
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

  return { file, ensureFile, read, write };
}
