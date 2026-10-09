'use strict';

const { randomBytes, createHmac, timingSafeEqual, scryptSync } = require('node:crypto');
const { PortalError } = require('./changelog');
const COOKIE = 'portal_admin';
const SESSION_MS = 8 * 60 * 60 * 1000;
function equal(a, b) { const x = Buffer.from(String(a)); const y = Buffer.from(String(b)); return x.length === y.length && timingSafeEqual(x, y); }
function passwordHash(password, salt = randomBytes(16).toString('hex')) { return `scrypt:${salt}:${scryptSync(password, salt, 64).toString('hex')}`; }
function verifyPassword(password, encoded) {
  const parts = encoded.split(':');
  if (parts.length !== 3 || parts[0] !== 'scrypt' || !/^[a-f0-9]{32}$/.test(parts[1]) || !/^[a-f0-9]{128}$/.test(parts[2])) return false;
  return equal(passwordHash(password, parts[1]), encoded);
}
function cookieValue(req) {
  const cookie = req.headers.cookie || '';
  const part = cookie.split(';').find(value => value.trim().startsWith(`${COOKIE}=`));
  return part ? part.trim().slice(COOKIE.length + 1) : '';
}
function createAuth(env = process.env) {
  const secret = env.PORTAL_SESSION_SECRET || '';
  const encodedPassword = env.PORTAL_ADMIN_PASSWORD_HASH || '';
  if (env.PORTAL_ADMIN_PASSWORD) throw new Error('Use PORTAL_ADMIN_PASSWORD_HASH rather than a plaintext password');
  const trustEntra = env.PORTAL_TRUST_APP_SERVICE_AUTH === 'true' && !!env.WEBSITE_SITE_NAME && String(env.WEBSITE_AUTH_ENABLED).toLowerCase() === 'true';
  const tenant = env.PORTAL_ADMIN_TENANT_ID || '';
  const objectIds = (env.PORTAL_ADMIN_OBJECT_IDS || '').split(',').map(value => value.trim()).filter(Boolean);
  const adminRole = env.PORTAL_ADMIN_ROLE || 'PortalAdmin';
  const mode = trustEntra && tenant ? 'entra' : encodedPassword ? 'password' : 'disabled';
  if (mode !== 'disabled' && secret.length < 32) throw new Error('PORTAL_SESSION_SECRET must contain at least 32 characters');
  if (encodedPassword && !/^scrypt:[a-f0-9]{32}:[a-f0-9]{128}$/.test(encodedPassword)) throw new Error('Invalid PORTAL_ADMIN_PASSWORD_HASH');
  if (mode !== 'disabled' && (env.NODE_ENV === 'production' || env.WEBSITE_SITE_NAME) && !env.PORTAL_ORIGIN) throw new Error('PORTAL_ORIGIN is required for production administrator authentication');
  const origin = env.PORTAL_ORIGIN ? new URL(env.PORTAL_ORIGIN).origin : null;
  if (origin && !origin.startsWith('https://') && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) throw new Error('PORTAL_ORIGIN must use HTTPS outside localhost');
  const sign = value => createHmac('sha256', secret).update(value).digest('base64url');
  function session(req) {
    try {
      const value = cookieValue(req); if (value.length > 3000) return null;
      const [payload, signature] = value.split('.');
      if (!payload || !signature || !equal(sign(payload), signature)) return null;
      const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
      if (!data.id || !data.actor || !Number.isFinite(data.expires) || data.expires <= Date.now()) return null;
      return data;
    } catch { return null; }
  }
  function identity(req) {
    if (mode === 'password') { const data = session(req); return data?.actor === 'password-admin' ? { actor: data.actor, displayName: '管理员', data } : null; }
    if (mode !== 'entra') return null;
    try {
      const header = req.headers['x-ms-client-principal']; if (!header || header.length > 24000) return null;
      const principal = JSON.parse(Buffer.from(header, 'base64').toString('utf8'));
      if (principal.auth_typ !== 'aad' || !Array.isArray(principal.claims)) return null;
      const values = (...types) => principal.claims.filter(claim => types.includes(claim.typ)).map(claim => claim.val);
      const tid = values('tid', 'http://schemas.microsoft.com/identity/claims/tenantid')[0];
      const oid = values('oid', 'http://schemas.microsoft.com/identity/claims/objectidentifier')[0];
      const roles = values('roles', 'role', 'http://schemas.microsoft.com/ws/2008/06/identity/claims/role');
      if (tid !== tenant || !oid || (!objectIds.includes(oid) && !roles.includes(adminRole))) return null;
      const actor = `entra:${tid}:${oid}`;
      const data = session(req);
      return { actor, displayName: values('name', 'preferred_username')[0] || '管理员', data: data?.actor === actor ? data : null };
    } catch { return null; }
  }
  function setSession(req, res, actor) {
    const data = { id: randomBytes(24).toString('base64url'), actor, expires: Date.now() + SESSION_MS };
    const payload = Buffer.from(JSON.stringify(data)).toString('base64url');
    res.cookie(COOKIE, `${payload}.${sign(payload)}`, { httpOnly: true, secure: !!env.WEBSITE_SITE_NAME || env.NODE_ENV === 'production' || origin?.startsWith('https://'), sameSite: 'strict', maxAge: SESSION_MS, path: '/api' });
    return data;
  }
  function enforceOrigin(req) {
    const actual = req.headers.origin;
    const expected = origin || `${req.protocol}://${req.get('host')}`;
    if (!actual || actual !== expected) throw new PortalError(403, '请求来源校验失败。请从 Portal 网站管理页面操作。', 'CSRF');
    if (req.headers['sec-fetch-site'] && !['same-origin', 'none'].includes(req.headers['sec-fetch-site'])) throw new PortalError(403, '不允许跨站管理请求。', 'CSRF');
  }
  const csrf = data => sign(`csrf:${data.id}:${data.actor}`);
  function protect(req, res, next) {
    try {
      if (mode === 'disabled') throw new PortalError(503, '管理员登录尚未配置，上传接口已安全关闭。', 'AUTH_NOT_CONFIGURED');
      const user = identity(req);
      if (!user) throw new PortalError(401, '请先使用管理员账号登录。', 'UNAUTHENTICATED');
      if (!user.data) throw new PortalError(401, '登录会话已过期，请重新登录。', 'UNAUTHENTICATED');
      enforceOrigin(req);
      if (!equal(req.headers['x-portal-csrf'] || '', csrf(user.data))) throw new PortalError(403, '安全令牌失效，请刷新后重试。', 'CSRF');
      req.admin = user; next();
    } catch (error) { next(error); }
  }
  const attempts = new Map();
  function login(req, res) {
    if (mode !== 'password') throw new PortalError(400, '当前不是密码登录模式。');
    enforceOrigin(req);
    const key = req.socket.remoteAddress;
    if (attempts.size > 10000) for (const [id, value] of attempts) if (value.reset < Date.now()) attempts.delete(id);
    const rate = attempts.get(key);
    if (rate && rate.reset > Date.now() && rate.count >= 5) throw new PortalError(429, '登录尝试过多，请在 15 分钟后重试。', 'RATE_LIMITED');
    const password = req.body?.password;
    if (typeof password !== 'string' || password.length > 256 || !verifyPassword(password, encodedPassword)) {
      const current = !rate || rate.reset < Date.now() ? { count: 0, reset: Date.now() + 15 * 60 * 1000 } : rate;
      current.count++; attempts.set(key, current);
      throw new PortalError(401, '管理员密码不正确。', 'UNAUTHENTICATED');
    }
    attempts.delete(key); const data = setSession(req, res, 'password-admin');
    res.json({ isAdmin: true, displayName: '管理员', csrfToken: csrf(data) });
  }
  function me(req, res) {
    const user = identity(req);
    if (user && !user.data) user.data = setSession(req, res, user.actor);
    res.json({ mode, isAdmin: !!user, displayName: user?.displayName || '', csrfToken: user ? csrf(user.data) : '', loginUrl: mode === 'entra' ? '/.auth/login/aad?post_login_redirect_uri=%2F%23manage' : null });
  }
  return { mode, protect, me, login, identity, logout(req, res) { enforceOrigin(req); res.clearCookie(COOKIE, { path: '/api', httpOnly: true, sameSite: 'strict', secure: !!env.WEBSITE_SITE_NAME || env.NODE_ENV === 'production' || origin?.startsWith('https://') }); res.json({ ok: true }); } };
}
module.exports = { createAuth, passwordHash, verifyPassword };
