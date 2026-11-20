import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const TEXT_EXTENSIONS = new Set([
  '.yml',
  '.yaml',
  '.json',
  '.properties',
  '.txt',
  '.toml',
  '.conf',
  '.cfg',
  '.ini',
  '.log',
  '.md',
  '.sh',
]);

const MAX_EDIT_BYTES = 2 * 1024 * 1024; // 2 MB
const MAX_PLUGIN_BYTES = 100 * 1024 * 1024; // 100 MB

export function resolveSafePath(rootDir, relativePath = '') {
  const rootResolved = path.resolve(rootDir);
  if (typeof relativePath !== 'string' || relativePath.includes('\0')) {
    throw new Error('Caminho inválido.');
  }
  const cleaned = relativePath.replace(/^\/+/, '');
  const target = path.resolve(rootResolved, cleaned);
  if (target !== rootResolved && !target.startsWith(rootResolved + path.sep)) {
    throw new Error('Acesso negado: tentativa de sair do diretório permitido.');
  }
  return target;
}

export function parseServerProperties(content) {
  const result = {};
  const lines = String(content || '').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1);
    result[key] = value;
  }
  return result;
}

export function updateServerProperties(originalContent, updates) {
  const remaining = { ...updates };
  const lines = String(originalContent || '').split(/\r?\n/);
  const updatedLines = lines.map((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return line;
    const eq = line.indexOf('=');
    if (eq <= 0) return line;
    const key = line.slice(0, eq).trim();
    if (Object.prototype.hasOwnProperty.call(remaining, key)) {
      const val = String(remaining[key]).replace(/[\r\n]/g, '');
      delete remaining[key];
      return `${key}=${val}`;
    }
    return line;
  });

  for (const [key, val] of Object.entries(remaining)) {
    if (!/^[a-zA-Z0-9._-]+$/.test(key)) continue;
    updatedLines.push(`${key}=${String(val).replace(/[\r\n]/g, '')}`);
  }

  return updatedLines.join('\n').replace(/\n*$/, '\n');
}

export function applyYamlReplacements(yamlContent, replacements) {
  const lines = String(yamlContent || '').split(/\r?\n/);
  const applied = [];

  // Rastreia hierarquia de seções YAML por nível de indentação
  const sectionStack = [];
  const lineSections = lines.map((line) => {
    const match = line.match(/^(\s*)([a-zA-Z0-9_.-]+)\s*:(.*)$/);
    if (!match || line.trim().startsWith('#')) {
      return { indent: -1, key: null, sectionPath: null };
    }
    const indent = match[1].length;
    const key = match[2];
    const rest = match[3].trim();

    while (sectionStack.length > 0 && sectionStack[sectionStack.length - 1].indent >= indent) {
      sectionStack.pop();
    }
    const parentPath = sectionStack.map((s) => s.key).join('.') || 'root';
    if (rest === '' || rest.startsWith('#')) {
      sectionStack.push({ indent, key });
    }
    return { indent, key, sectionPath: parentPath };
  });

  for (const rule of replacements) {
    for (let i = 0; i < lines.length; i += 1) {
      const meta = lineSections[i];
      if (!meta.key) continue;
      if (meta.key === rule.key && meta.sectionPath === rule.section) {
        const prefix = ' '.repeat(meta.indent);
        lines[i] = `${prefix}${rule.key}: ${rule.value}`;
        applied.push(`${rule.section}.${rule.key} = ${rule.value}`);
        break;
      }
    }
  }

  return { content: lines.join('\n'), applied };
}

export function createFileManager({ dataDir, backupsDir, presetsFile }) {
  function ensureDir(dir) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  function listDirectory(relPath = '') {
    ensureDir(dataDir);
    const dirPath = resolveSafePath(dataDir, relPath);
    const stat = fs.statSync(dirPath);
    if (!stat.isDirectory()) {
      throw new Error('O caminho especificado não é um diretório.');
    }

    const entries = fs.readdirSync(dirPath, { withFileTypes: true }).map((entry) => {
      const fullPath = path.join(dirPath, entry.name);
      let size = 0;
      let mtime = null;
      try {
        const st = fs.statSync(fullPath);
        size = st.size;
        mtime = st.mtime.toISOString();
      } catch {
        // ignore
      }
      const ext = path.extname(entry.name).toLowerCase();
      return {
        name: entry.name,
        path: path.posix.join(relPath.replace(/\\/g, '/'), entry.name).replace(/^\/+/, ''),
        isDirectory: entry.isDirectory(),
        size,
        mtime,
        editable: !entry.isDirectory() && TEXT_EXTENSIONS.has(ext) && size <= MAX_EDIT_BYTES,
      };
    });

    entries.sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    return {
      path: relPath.replace(/^\/+/, ''),
      entries,
    };
  }

  function readTextFile(relPath) {
    const filePath = resolveSafePath(dataDir, relPath);
    const st = fs.statSync(filePath);
    if (st.isDirectory()) throw new Error('Não é possível abrir uma pasta como texto.');
    if (st.size > MAX_EDIT_BYTES) {
      throw new Error('Arquivo excede o limite de 2 MB para edição no painel.');
    }
    const ext = path.extname(filePath).toLowerCase();
    if (!TEXT_EXTENSIONS.has(ext)) {
      throw new Error(`Extensão não suportada para edição de texto (${ext || 'sem extensão'}).`);
    }
    return {
      path: relPath,
      size: st.size,
      mtime: st.mtime.toISOString(),
      content: fs.readFileSync(filePath, 'utf8'),
    };
  }

  function writeTextFile(relPath, content) {
    const filePath = resolveSafePath(dataDir, relPath);
    if (typeof content !== 'string') throw new Error('Conteúdo inválido.');
    if (Buffer.byteLength(content, 'utf8') > MAX_EDIT_BYTES) {
      throw new Error('Conteúdo excede o limite máximo de 2 MB.');
    }
    ensureDir(path.dirname(filePath));
    fs.writeFileSync(filePath, content, 'utf8');
    return { ok: true, path: relPath, size: Buffer.byteLength(content, 'utf8') };
  }

  function createFolder(relPath) {
    const dirPath = resolveSafePath(dataDir, relPath);
    fs.mkdirSync(dirPath, { recursive: true });
    return { ok: true, path: relPath };
  }

  function deleteItem(relPath) {
    if (!relPath || relPath === '/' || relPath === '.') {
      throw new Error('Não é permitido excluir o diretório raiz do servidor.');
    }
    const target = resolveSafePath(dataDir, relPath);
    fs.rmSync(target, { recursive: true, force: true });
    return { ok: true };
  }

  function getServerProperties() {
    const pumpkinPath = resolveSafePath(dataDir, 'pumpkin.toml');
    if (fs.existsSync(pumpkinPath)) {
      const toml = fs.readFileSync(pumpkinPath, 'utf8');
      const getVal = (regex, fallback = '') => {
        const m = toml.match(regex);
        return m ? m[1] : fallback;
      };
      return {
        exists: true,
        engine: 'rust-pumpkin',
        properties: {
          motd: getVal(/^motd\s*=\s*"([^"]*)"/m, '§a§lYacaCode §8| §6Minecraft 26.3 (Rust)'),
          'max-players': getVal(/^max_players\s*=\s*(\d+)/m, '6'),
          difficulty: getVal(/^default_difficulty\s*=\s*"([^"]*)"/m, 'Normal').toLowerCase(),
          gamemode: getVal(/^default_gamemode\s*=\s*"([^"]*)"/m, 'Survival').toLowerCase(),
          'view-distance': getVal(/^view_distance\s*=\s*(\d+)/m, '8'),
          'simulation-distance': getVal(/^simulation_distance\s*=\s*(\d+)/m, '6'),
          'spawn-protection': getVal(/^spawn_protection\s*=\s*(\d+)/m, '0'),
          pvp: getVal(/^\[pvp\][\s\S]*?^enabled\s*=\s*(true|false)/m, 'true'),
          'online-mode': getVal(/^online_mode\s*=\s*(true|false)/m, 'true'),
          'white-list': getVal(/^white_list\s*=\s*(true|false)/m, 'false'),
          'allow-nether': getVal(/^allow_nether\s*=\s*(true|false)/m, 'true'),
          'allow-flight': 'true',
          'level-seed': getVal(/^seed\s*=\s*"([^"]*)"/m, ''),
        },
      };
    }

    const filePath = resolveSafePath(dataDir, 'server.properties');
    if (!fs.existsSync(filePath)) {
      return { exists: false, properties: {} };
    }
    const content = fs.readFileSync(filePath, 'utf8');
    return { exists: true, properties: parseServerProperties(content) };
  }

  function saveServerProperties(updates) {
    ensureDir(dataDir);
    const pumpkinPath = resolveSafePath(dataDir, 'pumpkin.toml');
    if (fs.existsSync(pumpkinPath)) {
      let toml = fs.readFileSync(pumpkinPath, 'utf8');
      const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : s);
      if (updates.motd !== undefined) {
        const safeMotd = String(updates.motd).replace(/"/g, '\\"');
        toml = toml.replace(/^motd\s*=\s*"[^"]*"/gm, `motd = "${safeMotd}"`);
      }
      if (updates['max-players'] !== undefined) {
        const n = Math.max(1, Number(updates['max-players']) || 6);
        toml = toml.replace(/^max_players\s*=\s*\d+/gm, `max_players = ${n}`);
      }
      if (updates.difficulty !== undefined) {
        toml = toml.replace(/^default_difficulty\s*=\s*"[^"]*"/m, `default_difficulty = "${cap(updates.difficulty)}"`);
      }
      if (updates.gamemode !== undefined) {
        toml = toml.replace(/^default_gamemode\s*=\s*"[^"]*"/m, `default_gamemode = "${cap(updates.gamemode)}"`);
      }
      if (updates['view-distance'] !== undefined) {
        const n = Math.max(2, Number(updates['view-distance']) || 8);
        toml = toml.replace(/^view_distance\s*=\s*\d+/gm, `view_distance = ${n}`);
      }
      if (updates['simulation-distance'] !== undefined) {
        const n = Math.max(2, Number(updates['simulation-distance']) || 6);
        toml = toml.replace(/^simulation_distance\s*=\s*\d+/gm, `simulation_distance = ${n}`);
      }
      if (updates['spawn-protection'] !== undefined) {
        const n = Math.max(0, Number(updates['spawn-protection']) || 0);
        toml = toml.replace(/^spawn_protection\s*=\s*\d+/m, `spawn_protection = ${n}`);
      }
      if (updates['online-mode'] !== undefined) {
        const b = String(updates['online-mode']) === 'true' ? 'true' : 'false';
        toml = toml.replace(/^online_mode\s*=\s*(true|false)/gm, `online_mode = ${b}`);
      }
      if (updates['white-list'] !== undefined) {
        const b = String(updates['white-list']) === 'true' ? 'true' : 'false';
        toml = toml.replace(/^white_list\s*=\s*(true|false)/m, `white_list = ${b}`);
        toml = toml.replace(/^enforce_whitelist\s*=\s*(true|false)/m, `enforce_whitelist = ${b}`);
      }
      if (updates['allow-nether'] !== undefined) {
        const b = String(updates['allow-nether']) === 'true' ? 'true' : 'false';
        toml = toml.replace(/^allow_nether\s*=\s*(true|false)/m, `allow_nether = ${b}`);
      }
      if (updates['level-seed'] !== undefined) {
        const s = String(updates['level-seed']).replace(/"/g, '');
        toml = toml.replace(/^seed\s*=\s*"[^"]*"/m, `seed = "${s}"`);
      }
      fs.writeFileSync(pumpkinPath, toml, 'utf8');
    }

    const filePath = resolveSafePath(dataDir, 'server.properties');
    const existing = fs.existsSync(filePath)
      ? fs.readFileSync(filePath, 'utf8')
      : '# YacaCode Minecraft Server Properties\n';
    const next = updateServerProperties(existing, updates);
    fs.writeFileSync(filePath, next, 'utf8');
    return { ok: true, properties: getServerProperties().properties };
  }

  function readJsonList(filename) {
    const pumpkinDataFile = resolveSafePath(dataDir, path.join('data', filename));
    const filePath = fs.existsSync(pumpkinDataFile)
      ? pumpkinDataFile
      : resolveSafePath(dataDir, filename);
    if (!fs.existsSync(filePath)) return [];
    try {
      const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  function listPlugins() {
    const isRustPumpkin = fs.existsSync(resolveSafePath(dataDir, 'pumpkin.toml'));
    const pluginsDir = resolveSafePath(dataDir, 'plugins');
    const plugins = [];

    if (isRustPumpkin) {
      const st = fs.statSync(resolveSafePath(dataDir, 'pumpkin.toml'));
      plugins.push(
        {
          fileName: 'pumpkin-bedrock-nethernet.native',
          displayName: '🦀 Pumpkin Native Bedrock (1.26.63 NetherNet)',
          enabled: true,
          size: 0,
          mtime: st.mtime.toISOString(),
          isCoreCrossplay: true,
        },
        {
          fileName: 'pumpkin-xbox-auth.native',
          displayName: '🦀 Pumpkin Native Xbox/Bedrock Auth (Floodgate-free)',
          enabled: true,
          size: 0,
          mtime: st.mtime.toISOString(),
          isCoreCrossplay: true,
        },
        {
          fileName: 'pumpkin-pump-chunks.native',
          displayName: '🦀 Pumpkin Multi-Thread Worldgen & Pump Chunks',
          enabled: true,
          size: 0,
          mtime: st.mtime.toISOString(),
          isCoreCrossplay: false,
        }
      );
    }

    if (!fs.existsSync(pluginsDir)) {
      return {
        exists: isRustPumpkin,
        plugins,
        geyserConfigured: isRustPumpkin,
        floodgateInstalled: isRustPumpkin,
      };
    }
    const entries = fs.readdirSync(pluginsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) continue;
      if (!entry.name.endsWith('.jar') && !entry.name.endsWith('.jar.disabled') && !entry.name.endsWith('.wasm')) continue;
      const full = path.join(pluginsDir, entry.name);
      const st = fs.statSync(full);
      const enabled = !entry.name.endsWith('.disabled');
      const displayName = entry.name.replace(/\.(jar|wasm)(\.disabled)?$/, '');
      plugins.push({
        fileName: entry.name,
        displayName,
        enabled,
        size: st.size,
        mtime: st.mtime.toISOString(),
        isCoreCrossplay:
          /geyser/i.test(entry.name) || /floodgate/i.test(entry.name),
      });
    }
    plugins.sort((a, b) => a.displayName.localeCompare(b.displayName));

    const geyserConfigPath = path.join(pluginsDir, 'Geyser-Spigot', 'config.yml');
    const geyserConfigured = isRustPumpkin || fs.existsSync(geyserConfigPath);
    const floodgateInstalled =
      isRustPumpkin || plugins.some((p) => /floodgate/i.test(p.fileName) && p.enabled);

    return {
      exists: true,
      plugins,
      geyserConfigured,
      floodgateInstalled,
    };
  }

  function togglePlugin(fileName) {
    const safeName = path.basename(String(fileName || ''));
    if (!safeName.endsWith('.jar') && !safeName.endsWith('.jar.disabled')) {
      throw new Error('Arquivo de plugin inválido.');
    }
    const src = resolveSafePath(dataDir, path.join('plugins', safeName));
    if (!fs.existsSync(src)) throw new Error('Plugin não encontrado.');
    const nextName = safeName.endsWith('.jar.disabled')
      ? safeName.replace(/\.disabled$/, '')
      : `${safeName}.disabled`;
    const dst = resolveSafePath(dataDir, path.join('plugins', nextName));
    fs.renameSync(src, dst);
    return { ok: true, fileName: nextName, enabled: nextName.endsWith('.jar') };
  }

  function saveUploadedPlugin(fileName, buffer) {
    const safeName = path.basename(String(fileName || '')).replace(/[^a-zA-Z0-9._-]/g, '_');
    if (!safeName.toLowerCase().endsWith('.jar')) {
      throw new Error('Apenas arquivos .jar são aceitos.');
    }
    if (!Buffer.isBuffer(buffer) || buffer.length < 4 || buffer.length > MAX_PLUGIN_BYTES) {
      throw new Error('Arquivo .jar inválido ou maior que 100 MB.');
    }
    // Valida assinatura ZIP/JAR (PK\x03\x04)
    if (buffer[0] !== 0x50 || buffer[1] !== 0x4b || buffer[2] !== 0x03 || buffer[3] !== 0x04) {
      throw new Error('Arquivo inválido: não é um pacote JAR/ZIP válido.');
    }
    const pluginsDir = resolveSafePath(dataDir, 'plugins');
    ensureDir(pluginsDir);
    const dst = resolveSafePath(dataDir, path.join('plugins', safeName));
    fs.writeFileSync(dst, buffer);
    return { ok: true, fileName: safeName, size: buffer.length };
  }

  function deletePlugin(fileName) {
    const safeName = path.basename(String(fileName || ''));
    if (!safeName.endsWith('.jar') && !safeName.endsWith('.jar.disabled')) {
      throw new Error('Arquivo de plugin inválido.');
    }
    const target = resolveSafePath(dataDir, path.join('plugins', safeName));
    if (!fs.existsSync(target)) throw new Error('Plugin não encontrado.');
    fs.unlinkSync(target);
    return { ok: true };
  }

  function listBackups() {
    ensureDir(backupsDir);
    const entries = fs.readdirSync(backupsDir, { withFileTypes: true });
    const files = [];
    for (const entry of entries) {
      if (entry.isDirectory()) continue;
      if (!/\.(tgz|tar\.gz|zip)$/i.test(entry.name)) continue;
      const full = path.join(backupsDir, entry.name);
      const st = fs.statSync(full);
      files.push({
        name: entry.name,
        size: st.size,
        mtime: st.mtime.toISOString(),
      });
    }
    files.sort((a, b) => b.mtime.localeCompare(a.mtime));
    const totalBytes = files.reduce((acc, f) => acc + f.size, 0);
    return { backups: files, totalBytes };
  }

  function getBackupFilePath(name) {
    const safeName = path.basename(String(name || ''));
    if (!/\.(tgz|tar\.gz|zip)$/i.test(safeName)) {
      throw new Error('Nome de backup inválido.');
    }
    const full = resolveSafePath(backupsDir, safeName);
    if (!fs.existsSync(full)) throw new Error('Backup não encontrado.');
    return { fullPath: full, safeName };
  }

  function deleteBackup(name) {
    const { fullPath } = getBackupFilePath(name);
    fs.unlinkSync(fullPath);
    return { ok: true };
  }

  function getWorldLastModifiedMs() {
    let latest = 0;
    const scan = (dir, depth = 0) => {
      if (depth > 4 || !fs.existsSync(dir)) return;
      try {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          const full = path.join(dir, entry.name);
          try {
            const st = fs.statSync(full);
            if (st.mtimeMs > latest) latest = st.mtimeMs;
            if (entry.isDirectory()) scan(full, depth + 1);
          } catch {
            // ignore
          }
        }
      } catch {
        // ignore
      }
    };
    scan(path.join(dataDir, 'world'), 0);
    return latest;
  }

  function estimateDirBytes(dir, maxDepth = 4) {
    let total = 0;
    const walk = (cur, depth) => {
      if (depth > maxDepth || !fs.existsSync(cur)) return;
      try {
        for (const entry of fs.readdirSync(cur, { withFileTypes: true })) {
          const full = path.join(cur, entry.name);
          try {
            if (entry.isDirectory()) walk(full, depth + 1);
            else total += fs.statSync(full).size;
          } catch {
            // ignore
          }
        }
      } catch {
        // ignore
      }
    };
    walk(dir, 0);
    return total;
  }

  async function createWorldBackupArchive({
    prefix = 'yacacode-world',
    maxLocalBackups = 10,
    destDir = null,
    onProgress = null,
  } = {}) {
    const targetDir = destDir || backupsDir;
    ensureDir(targetDir);
    const candidates = [
      'world',
      'world_nether',
      'world_the_end',
      'pumpkin.toml',
      'server.properties',
      'ops.json',
      'whitelist.json',
      'banned-players.json',
      'banned-ips.json',
      'usercache.json',
      'data',
      'icon.png',
    ];
    const items = candidates.filter((item) => fs.existsSync(path.join(dataDir, item)));
    if (items.length === 0) {
      throw new Error('Nenhum arquivo de mundo encontrado em /mc-data para criar backup.');
    }

    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
    const fileName = `${prefix}-${stamp}.tar.gz`;
    const finalPath = path.join(targetDir, fileName);
    const tmpPath = path.join(targetDir, `.${fileName}.tmp`);

    const estimatedRawBytes = Math.max(1024 * 1024, estimateDirBytes(path.join(dataDir, 'world')));
    onProgress?.({ stage: 'compressing', fileName, currentBytes: 0, estimatedTotalBytes: estimatedRawBytes });

    let progressTimer = null;
    if (typeof onProgress === 'function') {
      progressTimer = setInterval(() => {
        try {
          if (fs.existsSync(tmpPath)) {
            const cur = fs.statSync(tmpPath).size;
            onProgress({ stage: 'compressing', fileName, currentBytes: cur, estimatedTotalBytes: estimatedRawBytes });
          }
        } catch {
          // ignore
        }
      }, 700);
      progressTimer.unref();
    }

    try {
      await execFileAsync('tar', ['-czf', tmpPath, '-C', dataDir, ...items], {
        timeout: 10 * 60 * 1000,
        maxBuffer: 4 * 1024 * 1024,
      });
      fs.renameSync(tmpPath, finalPath);
    } catch (err) {
      try {
        if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
      } catch {
        // ignore
      }
      throw new Error(`Falha ao compactar backup do mundo: ${err.message}`);
    } finally {
      if (progressTimer) clearInterval(progressTimer);
    }

    // Rotação automática de backups locais excedentes (apenas quando gravando em backupsDir)
    if (!destDir && maxLocalBackups > 0) {
      const { backups } = listBackups();
      if (backups.length > maxLocalBackups) {
        for (const old of backups.slice(maxLocalBackups)) {
          try {
            fs.unlinkSync(path.join(backupsDir, old.name));
          } catch {
            // ignore
          }
        }
      }
    }

    const st = fs.statSync(finalPath);
    return {
      name: fileName,
      fullPath: finalPath,
      size: st.size,
      mtime: st.mtime.toISOString(),
      included: items,
      isTemporary: Boolean(destDir),
    };
  }

  function applyPresets() {
    if (!presetsFile || !fs.existsSync(presetsFile)) {
      throw new Error('Arquivo presets.json não encontrado.');
    }
    const presets = JSON.parse(fs.readFileSync(presetsFile, 'utf8'));
    const report = [];

    for (const [presetName, spec] of Object.entries(presets)) {
      if (!spec || typeof spec !== 'object' || !spec.file || !Array.isArray(spec.replacements)) {
        continue;
      }
      const targetPath = resolveSafePath(dataDir, spec.file);
      if (!fs.existsSync(targetPath)) {
        report.push({
          preset: presetName,
          file: spec.file,
          status: 'skipped',
          reason: 'Arquivo ainda não gerado pelo servidor (inicie o servidor 1 vez primeiro).',
        });
        continue;
      }

      const original = fs.readFileSync(targetPath, 'utf8');
      const { content, applied } = applyYamlReplacements(original, spec.replacements);
      if (applied.length > 0 && content !== original) {
        fs.writeFileSync(`${targetPath}.bak`, original, 'utf8');
        fs.writeFileSync(targetPath, content, 'utf8');
      }
      report.push({
        preset: presetName,
        file: spec.file,
        status: 'applied',
        changes: applied.length,
        details: applied,
      });
    }

    return { ok: true, report };
  }

  return {
    listDirectory,
    readTextFile,
    writeTextFile,
    createFolder,
    deleteItem,
    getServerProperties,
    saveServerProperties,
    readJsonList,
    listPlugins,
    togglePlugin,
    saveUploadedPlugin,
    deletePlugin,
    listBackups,
    getBackupFilePath,
    deleteBackup,
    createWorldBackupArchive,
    getWorldLastModifiedMs,
    applyPresets,
    resolveDataDownload: (relPath) => resolveSafePath(dataDir, relPath),
  };
}
