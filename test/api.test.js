'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { createApp } = require('../server');
const { LocalStore, createStore } = require('../lib/storage');
const { passwordHash } = require('../lib/auth');

async function fixture(t, extra = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'tools-portal-test-'));
  const env = { NODE_ENV: 'development', PORTAL_SESSION_SECRET: 's'.repeat(64), PORTAL_ADMIN_PASSWORD_HASH: passwordHash('testing-only-secure-password'), ...extra };
  const store = new LocalStore(dir);
  const server = createApp({ env, store }).listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => { await new Promise(resolve => server.close(resolve)); await fs.rm(dir, { recursive: true, force: true }); });
  let cookie = '', csrf = '';
  async function call(url, { method = 'GET', data, body, headers = {}, authorized = true } = {}) {
    const h = { ...headers };
    if (authorized && cookie) h.Cookie = cookie;
    if (method !== 'GET') { h.Origin ??= origin; if (authorized) h['X-Portal-CSRF'] ??= csrf; }
    if (data !== undefined) { h['Content-Type'] = 'application/json'; body = JSON.stringify(data); }
    const response = await fetch(origin + url, { method, headers: h, body });
    const text = await response.text();
    let value; try { value = JSON.parse(text); } catch { value = text; }
    return { status: response.status, value, response, text };
  }
  async function login() {
    const result = await call('/api/login', { method: 'POST', data: { password: 'testing-only-secure-password' } });
    assert.equal(result.status, 200);
    cookie = result.response.headers.get('set-cookie').split(';')[0]; csrf = result.value.csrfToken;
  }
  async function preview(tool = 'aoai-deploy', content = '## v2.1.0 - 2026-10-09\n\n1. 新功能。', fields = {}, filename = 'release.md') {
    const body = new FormData();
    body.append('file', new Blob([content], { type: 'text/markdown' }), filename);
    for (const [key, value] of Object.entries({ date: '2026-10-09', version: '2.1.0', summary: '更新说明', mode: 'merge', setCurrent: 'true', ...fields })) body.append(key, value);
    return call(`/api/admin/tools/${tool}/changelog/preview`, { method: 'POST', body });
  }
  const publish = (tool, previewId, extras = {}) => call(`/api/admin/tools/${tool}/changelog/publish`, { method: 'POST', data: { previewId, confirmed: true, ...extras } });
  return { dir, env, store, origin, call, login, preview, publish };
}

test('Public reads work; source files, git, archives and unknown APIs are not public', async t => {
  const f = await fixture(t);
  const tools = await f.call('/api/tools'); assert.equal(tools.status, 200); assert.equal(tools.value.tools.length, 7);
  const aoai = await f.call('/api/tools/aoai-deploy/changelog'); assert.equal(aoai.value.entries.length, 18); assert.equal(aoai.value.version, '');
  const home = await f.call('/'); assert.equal(home.status, 200); assert.match(home.response.headers.get('content-security-policy'), /script-src 'self'/);
  for (const url of ['/server.js', '/package.json', '/.env', '/.git/config', '/lib/auth.js', '/data/aoai-changelog.md', '/.portal-data/records/aoai-deploy.json']) assert.equal((await f.call(url)).status, 404, url);
  assert.equal((await f.call('/app.js?v=2')).status, 200);
  const unknown = await f.call('/api/not-found'); assert.equal(unknown.status, 404); assert.equal(unknown.value.code, 'NOT_FOUND');
  assert.equal((await f.call('/api/tools/unknown/changelog')).status, 404);
});
test('Writes require login, valid CSRF, same origin and configured auth', async t => {
  const f = await fixture(t);
  assert.equal((await f.preview()).status, 401);
  assert.equal((await f.call('/api/admin/tools/aoai-deploy/archives')).status, 401);
  await f.login();
  const me = await f.call('/api/me'); assert.equal(me.value.isAdmin, true);
  assert.equal((await f.call('/api/admin/tools/aoai-deploy/version', { method: 'PATCH', data: { version: '1.0', revision: 0 }, headers: { 'X-Portal-CSRF': 'bad' } })).status, 403);
  assert.equal((await f.call('/api/admin/tools/aoai-deploy/version', { method: 'PATCH', data: { version: '1.0', revision: 0 }, headers: { Origin: 'https://attacker.test' } })).status, 403);
  assert.equal((await f.call('/api/logout', { method: 'POST', data: {} })).status, 200);
  const cookieHeader = me.response.headers.get('set-cookie'); assert.equal(cookieHeader, null);
});
test('Disabled auth rejects writes and forged identity headers', async t => {
  const f = await fixture(t, { PORTAL_ADMIN_PASSWORD_HASH: '', PORTAL_SESSION_SECRET: '' });
  assert.equal((await f.call('/api/me')).value.mode, 'disabled');
  assert.equal((await f.preview()).status, 503);
  const headers = { 'x-ms-client-principal': Buffer.from(JSON.stringify({ auth_typ: 'aad', claims: [{ typ: 'roles', val: 'PortalAdmin' }] })).toString('base64') };
  assert.equal((await f.call('/api/me', { headers })).value.isAdmin, false);
});
test('Login enforces origin, session cookies and password rate limiting', async t => {
  const f = await fixture(t);
  assert.equal((await f.call('/api/login', { method: 'POST', data: { password: 'testing-only-secure-password' }, headers: { Origin: 'https://attacker.test' } })).status, 403);
  for (let index = 0; index < 5; index++) assert.equal((await f.call('/api/login', { method: 'POST', data: { password: 'wrong' } })).status, 401);
  assert.equal((await f.call('/api/login', { method: 'POST', data: { password: 'wrong' } })).status, 429);
});
test('Real multipart upload merges history, persists after service recreation, and reimport deduplicates', async t => {
  const f = await fixture(t); await f.login();
  const preview = await f.preview(); assert.equal(preview.status, 200); assert.equal(preview.value.stats.total, 19);
  const published = await f.publish('aoai-deploy', preview.value.previewId); assert.equal(published.status, 200); assert.equal(published.value.record.version, '2.1.0');
  assert.equal(published.value.record.entries.length, 19);
  const record = (await new LocalStore(f.dir).read('records/aoai-deploy.json')).value;
  assert.equal(record.version, '2.1.0'); assert.equal(record.entries.length, 19);
  const second = await f.preview(); assert.equal(second.value.stats.added, 0); assert.equal(second.value.stats.unchanged, 1);
  assert.equal((await f.publish('poe-flow', second.value.previewId)).status, 410);
  assert.equal((await f.publish('aoai-deploy', preview.value.previewId)).status, 410);
  const archives = await f.call('/api/admin/tools/aoai-deploy/archives'); assert.equal(archives.value.archives.length, 1);
});
test('Stale preview and concurrent publishing cannot overwrite a newer version', async t => {
  const f = await fixture(t); await f.login();
  const first = await f.preview(); const second = await f.preview();
  const results = await Promise.all([f.publish('aoai-deploy', first.value.previewId), f.publish('aoai-deploy', second.value.previewId)]);
  assert.deepEqual(results.map(result => result.status).sort(), [200, 409]);
  assert.equal((await f.call('/api/tools/aoai-deploy/changelog')).value.revision, 1);
});
test('Replacement needs separate confirmation and backups restore the pre-operation state', async t => {
  const f = await fixture(t); await f.login();
  const preview = await f.preview('aoai-deploy', '## 2026-10-09\n替换', { mode: 'replace' });
  assert.equal((await f.publish('aoai-deploy', preview.value.previewId)).status, 400);
  assert.equal((await f.publish('aoai-deploy', preview.value.previewId, { replaceConfirmed: true })).status, 200);
  const archives = await f.call('/api/admin/tools/aoai-deploy/archives');
  const restored = await f.call('/api/admin/tools/aoai-deploy/restore', { method: 'POST', data: { archiveId: archives.value.archives[0].archiveId, revision: 1, confirmed: true } });
  assert.equal(restored.status, 200); assert.equal(restored.value.entries.length, 18); assert.equal(restored.value.version, ''); assert.equal(restored.value.revision, 2);
  assert.equal((await f.call('/api/admin/tools/aoai-deploy/archives')).value.archives.length, 2);
});
test('Manual version edit does not rewrite log content, and conflict is detected', async t => {
  const f = await fixture(t); await f.login();
  const response = await f.call('/api/admin/tools/aoai-deploy/version', { method: 'PATCH', data: { version: 'v2.0', revision: 0 } });
  assert.equal(response.status, 200); assert.equal(response.value.version, '2.0'); assert.equal(response.value.entries.length, 18);
  assert.ok(response.value.entries.every(entry => !entry.version));
  assert.equal((await f.call('/api/admin/tools/aoai-deploy/version', { method: 'PATCH', data: { version: '1.0', revision: 0 } })).status, 409);
});
test('Older historical uploads can preserve the current card version', async t => {
  const f = await fixture(t); await f.login();
  await f.call('/api/admin/tools/aoai-deploy/version', { method: 'PATCH', data: { version: '3.0', revision: 0 } });
  const preview = await f.preview('aoai-deploy', '## 2026-04-01\n早期记录', { version: '', setCurrent: 'false' });
  assert.equal(preview.status, 200);
  const result = await f.publish('aoai-deploy', preview.value.previewId);
  assert.equal(result.value.record.version, '3.0'); assert.equal(result.value.record.entries.length, 19);
});
test('Expired previews cannot publish and invalid files fail server-side', async t => {
  const f = await fixture(t); await f.login();
  assert.equal((await f.preview('unknown')).status, 404);
  assert.equal((await f.preview('poe-flow', '## 2026-02-30\n错误')).status, 400);
  assert.equal((await f.preview('poe-flow', '<script>x</script>', {}, 'unsafe.html')).status, 400);
  assert.equal((await f.preview('poe-flow', Buffer.alloc(1024 * 1024 + 1, 65))).status, 413);
  const preview = await f.preview();
  const stored = await f.store.read(`previews/${preview.value.previewId}.json`); stored.value.expiresAt = 0;
  await f.store.write(`previews/${preview.value.previewId}.json`, stored.value, stored.etag);
  assert.equal((await f.publish('aoai-deploy', preview.value.previewId)).status, 410);
});
test('Unconfigured App Service can safely serve read-only seed logs', async t => {
  const env = { WEBSITE_SITE_NAME: 'tools-portal-site', NODE_ENV: 'production' };
  const store = createStore(env); assert.equal(store.kind, 'readonly');
  const app = createApp({ env }); const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  assert.equal((await (await fetch(base + '/api/tools')).json()).tools.find(tool => tool.id === 'aoai-deploy').logCount, 18);
  assert.equal((await (await fetch(base + '/api/health')).json()).uploadsConfigured, false);
});
test('Chinese upload filenames survive real browser multipart encoding', async t => {
  const f = await fixture(t); await f.login();
  const preview = await f.preview('aoai-deploy', '## 2026-10-09\n更新', {}, '更新日志.md');
  assert.equal(preview.status, 200); assert.equal(preview.value.filename, '更新日志.md');
  const result = await f.publish('aoai-deploy', preview.value.previewId);
  assert.equal(result.status, 200); assert.equal(result.value.record.source.filename, '更新日志.md');
});
test('Entra identity is trusted only on configured App Service and with tenant/admin authorization', async t => {
  const tenant = 'tenant-test', oid = 'admin-test';
  const f = await fixture(t, { PORTAL_ADMIN_PASSWORD_HASH: '', PORTAL_TRUST_APP_SERVICE_AUTH: 'true', WEBSITE_SITE_NAME: 'test', WEBSITE_AUTH_ENABLED: 'True', PORTAL_ADMIN_TENANT_ID: tenant, PORTAL_ADMIN_OBJECT_IDS: oid, PORTAL_ORIGIN: 'https://test.azurewebsites.net' });
  const headers = claims => ({ 'x-ms-client-principal': Buffer.from(JSON.stringify({ auth_typ: 'aad', claims })).toString('base64') });
  const admin = await f.call('/api/me', { headers: headers([{ typ: 'tid', val: tenant }, { typ: 'oid', val: oid }]) });
  assert.equal(admin.value.mode, 'entra'); assert.equal(admin.value.isAdmin, true);
  assert.match(admin.response.headers.get('set-cookie'), /HttpOnly/); assert.match(admin.response.headers.get('set-cookie'), /Secure/);
  assert.equal((await f.call('/api/me', { headers: headers([{ typ: 'tid', val: 'wrong' }, { typ: 'oid', val: oid }]) })).value.isAdmin, false);
  assert.equal((await f.call('/api/me', { headers: headers([{ typ: 'tid', val: tenant }, { typ: 'oid', val: 'normal-user' }]) })).value.isAdmin, false);
});
test('Production auth requires explicit origin and a session secret; unsafe storage paths fail closed', () => {
  assert.throws(() => createApp({ env: { NODE_ENV: 'production', PORTAL_ADMIN_PASSWORD_HASH: passwordHash('long-test-password'), PORTAL_SESSION_SECRET: 'a'.repeat(64) }, store: new LocalStore(os.tmpdir()) }), /PORTAL_ORIGIN/);
  assert.throws(() => createApp({ env: { PORTAL_ADMIN_PASSWORD_HASH: passwordHash('long-test-password'), PORTAL_SESSION_SECRET: 'short' }, store: new LocalStore(os.tmpdir()) }), /32 characters/);
  assert.throws(() => createStore({ WEBSITE_SITE_NAME: 'test', PORTAL_STORAGE: 'local', PORTAL_DATA_DIR: path.resolve(__dirname, '..') }), /deployment directory/);
  assert.throws(() => createStore({ PORTAL_STORAGE: 'blob' }), /ACCOUNT_URL/);
});
