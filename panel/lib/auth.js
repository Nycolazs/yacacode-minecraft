import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const SESSION_COOKIE = 'yacacode_session';
const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24 horas
const RATE_WINDOW_MS = 15 * 60 * 1000; // 15 minutos
const MAX_LOGIN_ATTEMPTS = 5;

const ROLE_RANK = {
  viewer: 1,
  moderator: 2,
  admin: 3,
};

const VALID_ROLES = new Set(Object.keys(ROLE_RANK));
const loginAttempts = new Map();

export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return `scrypt$${salt}$${derived}`;
}

export function verifyPasswordHash(password, storedHash) {
  if (!storedHash || typeof storedHash !== 'string') return false;
  let parts = null;
  if (storedHash.startsWith('scrypt$')) parts = storedHash.split('$');
  else if (storedHash.startsWith('scrypt:')) parts = storedHash.split(':');
  if (!parts || parts.length !== 3) return false;
  const [, salt, hexKey] = parts;
  if (!salt || !hexKey) return false;
  try {
    const derived = crypto.scryptSync(String(password), salt, 64);
    const expected = Buffer.from(hexKey, 'hex');
    if (derived.length !== expected.length) return false;
    return crypto.timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}

export function hasRole(userRole, requiredRole) {
  return (ROLE_RANK[userRole] || 0) >= (ROLE_RANK[requiredRole] || 99);
}

export function createAuthManager(config) {
  const ownerUsername = (config.adminUser || 'admin').trim().toLowerCase();
  const sessionSecret = config.sessionSecret || crypto.randomBytes(32).toString('hex');
  const cfAccessEnabled = String(config.cfAccessEnabled || 'false').toLowerCase() === 'true';
  const usersFile = config.usersFile || null;

  let envOwnerHash = (config.adminPasswordHash || '').trim();
  if (!envOwnerHash && config.adminPassword) {
    envOwnerHash = hashPassword(config.adminPassword);
  }

  // Store em memória sincronizado com disco (quando usersFile é informado)
  let users = new Map();

  function loadUsers() {
    users = new Map();
    if (usersFile && fs.existsSync(usersFile)) {
      try {
        const raw = JSON.parse(fs.readFileSync(usersFile, 'utf8'));
        const list = Array.isArray(raw) ? raw : Array.isArray(raw?.users) ? raw.users : [];
        for (const u of list) {
          if (!u || typeof u.username !== 'string' || !u.passwordHash) continue;
          const uname = u.username.trim().toLowerCase();
          users.set(uname, {
            username: uname,
            displayName: String(u.displayName || uname),
            passwordHash: u.passwordHash,
            role: VALID_ROLES.has(u.role) ? u.role : 'viewer',
            enabled: u.enabled !== false,
            isOwner: uname === ownerUsername,
            createdAt: u.createdAt || new Date().toISOString(),
            lastLoginAt: u.lastLoginAt || null,
          });
        }
      } catch {
        // Ignora arquivo corrompido e recria com o owner
      }
    }

    // Garante que o owner do .env exista sempre como admin ativo
    const existingOwner = users.get(ownerUsername);
    if (!existingOwner) {
      if (envOwnerHash) {
        users.set(ownerUsername, {
          username: ownerUsername,
          displayName: config.adminUser || 'Administrador',
          passwordHash: envOwnerHash,
          role: 'admin',
          enabled: true,
          isOwner: true,
          createdAt: new Date().toISOString(),
          lastLoginAt: null,
        });
        saveUsers();
      }
    } else {
      existingOwner.isOwner = true;
      existingOwner.role = 'admin';
      existingOwner.enabled = true;
      // Se o .env tiver senha diferente e o owner ainda não foi alterado pelo painel, mantém sincronia
      if (!existingOwner.customPassword && envOwnerHash) {
        existingOwner.passwordHash = envOwnerHash;
      }
    }
  }

  function saveUsers() {
    if (!usersFile) return;
    try {
      fs.mkdirSync(path.dirname(usersFile), { recursive: true });
      const data = JSON.stringify({ users: Array.from(users.values()) }, null, 2);
      fs.writeFileSync(usersFile, data, { encoding: 'utf8', mode: 0o600 });
      try {
        fs.chmodSync(usersFile, 0o600);
      } catch {
        // ignore
      }
    } catch {
      // fallback apenas em memória se disco estiver read-only
    }
  }

  loadUsers();

  function getClientIp(req) {
    const cfIp = req.headers['cf-connecting-ip'];
    if (typeof cfIp === 'string' && cfIp.trim()) return cfIp.trim();
    const xff = req.headers['x-forwarded-for'];
    if (typeof xff === 'string' && xff.trim()) return xff.split(',')[0].trim();
    return req.socket?.remoteAddress || 'unknown';
  }

  function isBehindHttps(req) {
    const xfProto = req.headers['x-forwarded-proto'];
    if (typeof xfProto === 'string' && xfProto.toLowerCase().includes('https')) return true;
    if (req.headers['cf-visitor']) {
      try {
        const parsed = JSON.parse(String(req.headers['cf-visitor']));
        if (parsed.scheme === 'https') return true;
      } catch {
        // ignore
      }
    }
    return false;
  }

  function checkRateLimit(ip) {
    const now = Date.now();
    const record = loginAttempts.get(ip);
    if (!record || now > record.resetAt) {
      return { allowed: true, remaining: MAX_LOGIN_ATTEMPTS, retryAfterSec: 0 };
    }
    if (record.count >= MAX_LOGIN_ATTEMPTS) {
      return {
        allowed: false,
        remaining: 0,
        retryAfterSec: Math.ceil((record.resetAt - now) / 1000),
      };
    }
    return { allowed: true, remaining: MAX_LOGIN_ATTEMPTS - record.count, retryAfterSec: 0 };
  }

  function recordLoginFailure(ip) {
    const now = Date.now();
    const record = loginAttempts.get(ip);
    if (!record || now > record.resetAt) {
      loginAttempts.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS });
    } else {
      record.count += 1;
    }
  }

  function clearLoginFailures(ip) {
    loginAttempts.delete(ip);
  }

  function signSession(username, role) {
    const payload = {
      u: username,
      r: role,
      iat: Date.now(),
      exp: Date.now() + SESSION_TTL_MS,
      nonce: crypto.randomBytes(8).toString('hex'),
    };
    const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const sig = crypto.createHmac('sha256', sessionSecret).update(encoded).digest('base64url');
    return `${encoded}.${sig}`;
  }

  function verifySessionToken(token) {
    if (!token || typeof token !== 'string') return null;
    const dot = token.indexOf('.');
    if (dot <= 0) return null;
    const encoded = token.slice(0, dot);
    const sig = token.slice(dot + 1);
    const expectedSig = crypto
      .createHmac('sha256', sessionSecret)
      .update(encoded)
      .digest('base64url');

    const sigBuf = Buffer.from(sig);
    const expBuf = Buffer.from(expectedSig);
    if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
      return null;
    }

    try {
      const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
      if (!payload || typeof payload.u !== 'string' || typeof payload.exp !== 'number') {
        return null;
      }
      if (Date.now() > payload.exp) return null;
      return payload;
    } catch {
      return null;
    }
  }

  function parseCookies(req) {
    const header = req.headers.cookie;
    const out = {};
    if (!header) return out;
    for (const part of header.split(';')) {
      const idx = part.indexOf('=');
      if (idx > 0) {
        const k = part.slice(0, idx).trim();
        const v = part.slice(idx + 1).trim();
        out[k] = decodeURIComponent(v);
      }
    }
    return out;
  }

  function getSession(req) {
    const cookies = parseCookies(req);
    const token = cookies[SESSION_COOKIE];
    const verified = verifySessionToken(token);
    const cfEmail =
      typeof req.headers['cf-access-authenticated-user-email'] === 'string'
        ? req.headers['cf-access-authenticated-user-email'].trim()
        : null;
    const viaCloudflare = Boolean(req.headers['cf-ray'] || req.headers['cf-connecting-ip']);

    if (verified) {
      const userObj = users.get(verified.u.toLowerCase());
      if (userObj && userObj.enabled) {
        return {
          authenticated: true,
          username: userObj.username,
          displayName: userObj.displayName,
          role: userObj.role,
          isOwner: userObj.isOwner,
          expiresAt: verified.exp,
          cfEmail,
          viaCloudflare,
          cfAccessEnabled,
        };
      }
    }

    return {
      authenticated: false,
      username: null,
      displayName: null,
      role: null,
      isOwner: false,
      expiresAt: null,
      cfEmail,
      viaCloudflare,
      cfAccessEnabled,
    };
  }

  function authenticate(username, password, ip) {
    const rate = checkRateLimit(ip);
    if (!rate.allowed) {
      return {
        ok: false,
        status: 429,
        error: `Muitas tentativas de login. Aguarde ${Math.ceil(rate.retryAfterSec / 60)} min.`,
        retryAfterSec: rate.retryAfterSec,
      };
    }

    if (users.size === 0) {
      return {
        ok: false,
        status: 500,
        error: 'Nenhum administrador configurado no arquivo .env.',
      };
    }

    const uname = String(username || '').trim().toLowerCase();
    const userObj = users.get(uname);

    if (!userObj || !userObj.enabled || !verifyPasswordHash(password, userObj.passwordHash)) {
      recordLoginFailure(ip);
      return {
        ok: false,
        status: 401,
        error: userObj && !userObj.enabled ? 'Esta conta está desativada.' : 'Usuário ou senha inválidos.',
      };
    }

    clearLoginFailures(ip);
    userObj.lastLoginAt = new Date().toISOString();
    saveUsers();

    return {
      ok: true,
      token: signSession(userObj.username, userObj.role),
      username: userObj.username,
      displayName: userObj.displayName,
      role: userObj.role,
    };
  }

  function listUsers() {
    return Array.from(users.values())
      .map((u) => ({
        username: u.username,
        displayName: u.displayName,
        role: u.role,
        enabled: u.enabled,
        isOwner: u.isOwner,
        createdAt: u.createdAt,
        lastLoginAt: u.lastLoginAt,
      }))
      .sort((a, b) => {
        if (a.isOwner !== b.isOwner) return a.isOwner ? -1 : 1;
        return a.username.localeCompare(b.username);
      });
  }

  function createUser({ username, displayName, password, role = 'moderator' }) {
    const uname = String(username || '').trim().toLowerCase();
    if (!/^[a-z0-9._-]{3,32}$/.test(uname)) {
      throw Object.assign(
        new Error('Usuário inválido. Use 3 a 32 caracteres (letras, números, ponto, hífen ou _).'),
        { status: 400 }
      );
    }
    if (users.has(uname)) {
      throw Object.assign(new Error(`O usuário "${uname}" já existe.`), { status: 409 });
    }
    const pass = String(password || '');
    if (pass.length < 6) {
      throw Object.assign(new Error('A senha deve ter pelo menos 6 caracteres.'), { status: 400 });
    }
    if (!VALID_ROLES.has(role)) {
      throw Object.assign(new Error('Cargo inválido (use admin, moderator ou viewer).'), { status: 400 });
    }

    const cleanDisplay = String(displayName || uname).trim().slice(0, 48) || uname;
    users.set(uname, {
      username: uname,
      displayName: cleanDisplay,
      passwordHash: hashPassword(pass),
      role,
      enabled: true,
      isOwner: false,
      createdAt: new Date().toISOString(),
      lastLoginAt: null,
    });
    saveUsers();
    return { ok: true, users: listUsers() };
  }

  function updateUser(targetUsername, updates = {}) {
    const uname = String(targetUsername || '').trim().toLowerCase();
    const userObj = users.get(uname);
    if (!userObj) {
      throw Object.assign(new Error('Usuário não encontrado.'), { status: 404 });
    }

    if (updates.displayName !== undefined) {
      userObj.displayName = String(updates.displayName).trim().slice(0, 48) || userObj.username;
    }

    if (updates.role !== undefined) {
      if (!VALID_ROLES.has(updates.role)) {
        throw Object.assign(new Error('Cargo inválido.'), { status: 400 });
      }
      if (userObj.isOwner && updates.role !== 'admin') {
        throw Object.assign(new Error('O administrador principal não pode ter o cargo rebaixado.'), {
          status: 400,
        });
      }
      userObj.role = updates.role;
    }

    if (updates.enabled !== undefined) {
      const nextEnabled = Boolean(updates.enabled);
      if (userObj.isOwner && !nextEnabled) {
        throw Object.assign(new Error('O administrador principal não pode ser desativado.'), {
          status: 400,
        });
      }
      userObj.enabled = nextEnabled;
    }

    if (updates.password !== undefined && String(updates.password).length > 0) {
      const pass = String(updates.password);
      if (pass.length < 6) {
        throw Object.assign(new Error('A nova senha deve ter pelo menos 6 caracteres.'), {
          status: 400,
        });
      }
      userObj.passwordHash = hashPassword(pass);
      userObj.customPassword = true;
    }

    saveUsers();
    return { ok: true, users: listUsers() };
  }

  function deleteUser(targetUsername, actorUsername) {
    const uname = String(targetUsername || '').trim().toLowerCase();
    const userObj = users.get(uname);
    if (!userObj) {
      throw Object.assign(new Error('Usuário não encontrado.'), { status: 404 });
    }
    if (userObj.isOwner) {
      throw Object.assign(new Error('O administrador principal não pode ser excluído.'), {
        status: 400,
      });
    }
    if (uname === String(actorUsername || '').toLowerCase()) {
      throw Object.assign(new Error('Você não pode excluir a própria conta logada.'), {
        status: 400,
      });
    }
    users.delete(uname);
    saveUsers();
    return { ok: true, users: listUsers() };
  }

  function changeOwnPassword(username, currentPassword, newPassword) {
    const uname = String(username || '').trim().toLowerCase();
    const userObj = users.get(uname);
    if (!userObj) {
      throw Object.assign(new Error('Usuário não encontrado.'), { status: 404 });
    }
    if (!verifyPasswordHash(currentPassword, userObj.passwordHash)) {
      throw Object.assign(new Error('Senha atual incorreta.'), { status: 401 });
    }
    const next = String(newPassword || '');
    if (next.length < 6) {
      throw Object.assign(new Error('A nova senha deve ter pelo menos 6 caracteres.'), {
        status: 400,
      });
    }
    userObj.passwordHash = hashPassword(next);
    userObj.customPassword = true;
    saveUsers();
    return { ok: true };
  }

  function buildSessionCookie(token, req) {
    const parts = [
      `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
      'Path=/',
      'HttpOnly',
      'SameSite=Lax',
      `Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`,
    ];
    if (isBehindHttps(req)) {
      parts.push('Secure');
    }
    return parts.join('; ');
  }

  function buildClearCookie(req) {
    const parts = [`${SESSION_COOKIE}=`, 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0'];
    if (isBehindHttps(req)) {
      parts.push('Secure');
    }
    return parts.join('; ');
  }

  function validateCsrf(req) {
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') {
      return true;
    }
    if (req.headers['x-requested-with'] === 'YacaCodePanel') {
      return true;
    }
    const origin = req.headers.origin;
    const host = req.headers['x-forwarded-host'] || req.headers.host;
    if (origin && host) {
      try {
        const originHost = new URL(origin).host;
        return originHost === host;
      } catch {
        return false;
      }
    }
    return false;
  }

  return {
    getClientIp,
    getSession,
    authenticate,
    listUsers,
    createUser,
    updateUser,
    deleteUser,
    changeOwnPassword,
    buildSessionCookie,
    buildClearCookie,
    validateCsrf,
  };
}
