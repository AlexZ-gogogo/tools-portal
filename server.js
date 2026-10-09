'use strict';
const express = require('express');
const multer = require('multer');
const path = require('node:path');
const { createStore } = require('./lib/storage');
const { createAuth } = require('./lib/auth');
const { PortalService } = require('./lib/service');
const { PortalError, MAX_FILE_SIZE } = require('./lib/changelog');
const { version } = require('./package.json');

function createApp(options = {}) {
  const env = options.env || process.env;
  const app = express();
  const store = options.store || createStore(env);
  const service = new PortalService(store);
  const auth = createAuth(env);
  if (env.WEBSITE_SITE_NAME) app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    res.set({ 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'same-origin', 'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' https://cdnjs.cloudflare.com; font-src 'self' https://cdnjs.cloudflare.com; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'" });
    if (req.path.startsWith('/api/')) res.set('Cache-Control', 'no-store');
    next();
  });
  const json = express.json({ limit: '16kb', strict: true });
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_FILE_SIZE, files: 1, fields: 6, fieldSize: 2048, parts: 8 } }).single('file');
  const writable = (req, res, next) => store.kind === 'readonly' ? next(new PortalError(503, '持久存储尚未配置，上传已关闭。', 'STORAGE_NOT_CONFIGURED')) : next();
  app.get('/api/health', (req, res) => res.json({ ok: true, version, storage: store.kind, uploadsConfigured: auth.mode !== 'disabled' && store.kind !== 'readonly' }));
  app.get('/api/tools', async (req, res) => res.json({ tools: await service.tools() }));
  app.get('/api/tools/:toolId/changelog', async (req, res) => res.json(await service.record(req.params.toolId)));
  app.get('/api/me', (req, res) => auth.me(req, res));
  app.post('/api/login', json, (req, res) => auth.login(req, res));
  app.post('/api/logout', auth.protect, (req, res) => auth.logout(req, res));
  app.get('/api/admin/tools/:toolId/archives', (req, res, next) => {
    if (!auth.identity(req)) return next(new PortalError(401, '请先以管理员身份登录。', 'UNAUTHENTICATED'));
    next();
  }, async (req, res) => res.json({ archives: await service.archives(req.params.toolId) }));
  app.post('/api/admin/tools/:toolId/changelog/preview', auth.protect, writable, upload, async (req, res) => res.json(await service.preview(req.params.toolId, req.file, req.body, req.admin)));
  app.post('/api/admin/tools/:toolId/changelog/publish', auth.protect, writable, json, async (req, res) => res.json(await service.publish(req.params.toolId, req.body, req.admin)));
  app.patch('/api/admin/tools/:toolId/version', auth.protect, writable, json, async (req, res) => res.json(await service.setVersion(req.params.toolId, req.body, req.admin)));
  app.post('/api/admin/tools/:toolId/restore', auth.protect, writable, json, async (req, res) => res.json(await service.restore(req.params.toolId, req.body, req.admin)));
  app.use('/api', (req, res) => res.status(404).json({ error: '接口不存在。', code: 'NOT_FOUND' }));

  // Public allowlist: backend source, secrets, uploads, archives and .git are never static files.
  const assets = new Map([['/', 'index.html'], ['/index.html', 'index.html'], ['/styles.css', 'styles.css'], ['/app.js', 'app.js'], ['/favicon.svg', 'favicon.svg']]);
  app.use((req, res, next) => {
    if (!['GET', 'HEAD'].includes(req.method)) return next(new PortalError(405, '请求方法不支持。'));
    const filename = assets.get(req.path);
    if (!filename) return res.status(404).type('text').send('Not Found');
    res.set('Cache-Control', 'no-cache');
    res.sendFile(path.join(__dirname, filename));
  });
  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    let status = error.status || 500;
    let message = error.message;
    if (error instanceof multer.MulterError) { status = error.code === 'LIMIT_FILE_SIZE' ? 413 : 400; message = error.code === 'LIMIT_FILE_SIZE' ? '日志文件不能超过 1 MB。' : '上传格式不正确，请上传一份日志文件。'; }
    if (error.type === 'entity.too.large') { status = 413; message = '请求体过大。'; }
    if (status >= 500 && !(error instanceof PortalError)) { console.error('Portal request failed:', error.code || error.name); message = '服务器暂时无法处理请求，请稍后重试或检查存储配置。'; }
    res.status(status).json({ error: message, code: error.code || 'SERVER_ERROR' });
  });
  return app;
}

if (require.main === module) {
  const server = createApp().listen(process.env.PORT || 8080, process.env.WEBSITE_SITE_NAME ? '0.0.0.0' : (process.env.HOST || '127.0.0.1'), () => console.log(`Tools Portal ${version} running on port ${server.address().port}`));
  server.requestTimeout = 30000;
  server.headersTimeout = 15000;
}
module.exports = { createApp };
