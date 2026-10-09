'use strict';

const pageContent = document.getElementById('pageContent');
const searchInput = document.getElementById('searchInput');
const statusBanner = document.getElementById('globalStatus');
const state = { tools: [], me: { mode: 'disabled', isAdmin: false }, health: {}, record: null, page: 'home', selected: 'aoai-deploy', category: 'all', query: '', view: 'grid', showAll: false, preview: null, busy: false, generation: 0, draftGeneration: 0 };
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const icon = name => `<i class="fas fa-${name}" aria-hidden="true"></i>`;
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const selectedTool = () => state.tools.find(tool => tool.id === state.selected) || state.tools[0];
const versionBadge = version => version ? `<span class="version-badge">Version ${escapeHtml(version)}</span>` : '<span class="version-badge unset">版本未设置</span>';
const button = (action, label, glyph, primary = false) => `<button type="button" data-action="${action}" class="portal-button${primary ? ' primary' : ''}">${icon(glyph)} ${label}</button>`;

async function request(url, options = {}) {
  const headers = new Headers(options.headers || {});
  if (options.method && options.method !== 'GET') headers.set('X-Portal-CSRF', state.me.csrfToken || '');
  const response = await fetch(url, { ...options, headers, credentials: 'same-origin', cache: 'no-store' });
  const result = await response.json().catch(() => ({ error: '服务器返回异常，请检查服务是否已更新。' }));
  if (!response.ok) {
    if (response.status === 401 && state.me.isAdmin) { state.me.isAdmin = false; state.me.csrfToken = ''; }
    throw new Error(result.error || '请求失败，请稍后重试。');
  }
  return result;
}
const postJson = (url, data, method = 'POST') => request(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
function announce(message, error = false) {
  statusBanner.hidden = !message;
  statusBanner.textContent = message;
  statusBanner.classList.toggle('error', error);
  statusBanner.setAttribute('role', error ? 'alert' : 'status');
}
function report(error) { announce(error.message, true); }
async function loadTools() { state.tools = (await request('/api/tools')).tools; document.getElementById('appCount').textContent = `共 ${state.tools.length} 个工具`; }
function navigate(page, toolId = state.selected) { location.hash = page === 'home' ? state.category : `${page}/${toolId}`; }
function heading(title, description, actions) { return `<div class="page-heading"><div><h1>${title}</h1><p>${description}</p></div><div class="heading-actions">${actions}</div></div>`; }

function renderHome() {
  const visible = state.tools.filter(tool => (state.category === 'all' || state.category === tool.category) && (!state.query || `${tool.name} ${tool.description}`.toLowerCase().includes(state.query.toLowerCase())));
  pageContent.innerHTML = `${heading('Tools Portal', '内部工具与服务集合 · 点击卡片直达对应平台', `<a class="portal-button" href="#logs/${state.selected}">${icon('history')} 更新日志</a><a class="portal-button${state.me.isAdmin ? ' primary' : ''}" href="#manage/${state.selected}">${icon(state.me.isAdmin ? 'upload' : 'lock')} ${state.me.isAdmin ? '管理更新' : '管理员登录'}</a>`)}
    <section class="filter-section"><div class="filter-tabs">${[['all', '全部', 'th-large'], ['ai', 'AI 工具', 'brain'], ['azure', 'Azure 工具', 'cloud'], ['tool', '效率工具', 'wrench']].map(([id, label, glyph]) => `<a class="filter-tab${state.category === id ? ' active' : ''}" href="#${id}" aria-current="${state.category === id ? 'page' : 'false'}">${icon(glyph)} ${label}<span class="filter-count">${state.tools.filter(tool => id === 'all' || tool.category === id).length}</span></a>`).join('')}</div><div class="section-actions">${button('grid', '网格', 'th-large')}${button('list', '列表', 'list')}</div></section>
    <section class="apps-grid${state.view === 'list' ? ' list-view' : ''}" id="appsGrid">${visible.map(tool => `<article class="app-card" data-tool="${tool.id}"><a class="card-main-link" href="${tool.url}" target="_blank" rel="noopener noreferrer"><div class="app-card-header"><div class="app-icon ${tool.category}-icon">${icon(tool.icon)}</div><span class="app-badge ${tool.category}-badge">${tool.badge}</span></div><div class="app-card-body"><h3>${escapeHtml(tool.name)}</h3><p>${escapeHtml(tool.description)}</p></div></a><div class="card-version-row">${versionBadge(tool.version)}${tool.latestDate ? `<span class="card-updated">${tool.latestDate}</span>` : ''}</div><div class="app-card-footer"><a class="changelog-link" href="#logs/${tool.id}">${icon('history')} ${tool.logCount ? '更新日志' : '暂无日志'}</a><a class="open-tool-link" href="${tool.url}" target="_blank" rel="noopener noreferrer">打开工具 ${icon('external-link-alt')}</a></div></article>`).join('')}</section>${!visible.length ? '<div class="empty-panel"><h3>未找到匹配的工具</h3><p>尝试其他关键词或分类。</p></div>' : ''}`;
}

function entriesHtml(entries, count) {
  return entries.slice(0, count).map((entry, index) => `<article class="timeline-entry"><div class="entry-heading"><strong>${entry.date}</strong>${index === 0 ? '<span class="small-badge">最新记录</span>' : ''}${entry.version ? `<span class="small-badge neutral">v${escapeHtml(entry.version)}</span>` : ''}</div>${entry.title !== entry.date && entry.title !== `v${entry.version} - ${entry.date}` ? `<div class="entry-title">${escapeHtml(entry.title)}</div>` : ''}<div class="markdown-body">${entry.html}</div></article>`).join('');
}
function renderLogs() {
  const tool = selectedTool(), record = state.record;
  pageContent.innerHTML = `${heading('更新日志', '每条记录都明确关联到对应工具与网站', `<a class="portal-button" href="#all">${icon('arrow-left')} 返回工具</a>${state.me.isAdmin ? `<a class="portal-button primary" href="#manage/${tool.id}">${icon('upload')} 上传日志</a>` : `<a class="portal-button" href="#manage/${tool.id}">${icon('lock')} 管理员登录</a>`}`)}
    <div class="log-layout"><nav class="tool-list" aria-label="选择工具"><div class="tool-list-label">工具网站 · ${state.tools.length}</div>${state.tools.map(item => `<a class="tool-list-item${item.id === tool.id ? ' selected' : ''}" href="#logs/${item.id}" aria-current="${item.id === tool.id ? 'page' : 'false'}">${icon(item.icon)}<span>${escapeHtml(item.name)}<small>${item.logCount ? `${item.logCount} 条记录` : '暂无更新日志'}</small></span></a>`).join('')}</nav><section class="detail-panel"><div class="tool-identity"><div class="app-icon ${tool.category}-icon">${icon(tool.icon)}</div><div><h2>${escapeHtml(tool.name)}</h2><a class="tool-url" href="${tool.url}" target="_blank" rel="noopener noreferrer">${tool.url.replace('https://', '').replace(/\/$/, '')} ${icon('external-link-alt')}</a></div></div><div class="detail-meta">${versionBadge(record.version)}${record.entries.length ? `<span>最后更新 ${record.entries[0].date} · ${record.entries.length} 条记录</span>` : ''}</div>${record.version ? '<p class="field-hint">展示版本由管理员维护。</p>' : ''}${record.summary ? `<p class="record-summary">${escapeHtml(record.summary)}</p>` : ''}${record.source ? `<div class="record-source">${icon('file-alt')} 来源：${escapeHtml(record.source.label)} · ${escapeHtml(record.source.filename)}</div>` : ''}${record.entries.length ? `<div class="timeline">${entriesHtml(record.entries, state.showAll ? record.entries.length : 5)}</div>${record.entries.length > 5 ? button('more', state.showAll ? '收起历史记录' : `展开其余 ${record.entries.length - 5} 条记录`, state.showAll ? 'chevron-up' : 'chevron-down') : ''}` : `<div class="empty-panel">${icon('file-alt')}<h3>这个工具还没有更新日志</h3><p>日志上传后将在这里展示，不影响工具跳转。</p>${state.me.isAdmin ? `<a class="portal-button" href="#manage/${tool.id}">${icon('upload')} 上传第一份日志</a>` : ''}</div>`}</section></div>`;
}

function renderLogin() {
  pageContent.innerHTML = `${heading('日志管理', '只有管理员可以上传日志、修改版本或恢复备份', '<a class="portal-button" href="#all">返回工具</a>')}<section class="login-panel"><h2>${icon('lock')} 管理员登录</h2>${state.me.mode === 'disabled' ? '<div class="warning-panel">管理员登录尚未配置，上传接口已安全关闭。请在服务器配置密码哈希与会话密钥，或启用 Microsoft Entra 管理员登录。</div><p class="field-hint">普通用户可以继续查看已发布日志和使用工具。</p>' : state.me.mode === 'entra' ? `<p>请使用授权的 Microsoft 账号登录。</p><a class="portal-button primary" href="${escapeHtml(state.me.loginUrl)}">${icon('sign-in-alt')} Microsoft 登录</a>` : '<form id="loginForm"><label class="form-field"><span>管理员密码</span><input type="password" name="password" autocomplete="current-password" required maxlength="256"></label><div class="form-error" role="alert" id="loginError"></div><button class="portal-button primary" type="submit">登录</button></form>'}</section>`;
}
function renderManage() {
  if (!state.me.isAdmin) { renderLogin(); return; }
  const tool = selectedTool(), record = state.record;
  state.preview = null;
  pageContent.innerHTML = `${heading('日志管理', '选择工具 → 上传文件 → 填写版本 → 预览确认 → 发布', `<span class="small-badge neutral">${icon('user-shield')} 管理员</span><a class="portal-button" href="#logs/${tool.id}">${icon('arrow-left')} 返回日志</a>${button('logout', '退出', 'sign-out-alt')}`)}
    ${state.health.storage === 'readonly' ? '<div class="warning-panel">持久存储尚未配置。当前可以阅读历史日志，但无法上传或保存版本，请先配置 Blob Storage。</div>' : ''}
    <div class="management-layout"><form id="uploadForm" class="form-panel" enctype="multipart/form-data"><h2>${icon('upload')} 上传更新日志</h2><label class="form-field"><span>对应工具网站 *</span><select name="toolId" id="manageTool">${state.tools.map(item => `<option value="${item.id}"${item.id === tool.id ? ' selected' : ''}>${escapeHtml(item.name)}</option>`).join('')}</select><small>日志通过工具 ID 关联网站，不会因改名而错绑。</small></label><div class="form-row"><label class="form-field"><span>当前版本号</span><input name="version" maxlength="40" placeholder="如 1.0、2.0.0" value="${escapeHtml(record.version)}"><small>可手动填写；不从日期推算版本。</small></label><label class="form-field"><span>发布日期 *</span><input type="date" name="date" value="${record.entries[0]?.date || today()}" required><small>有日期标题时以日志条目日期为准。</small></label></div><label class="upload-zone">${icon('cloud-upload-alt')}<span>选择更新日志文件 *</span><input type="file" name="file" accept=".md,.txt,text/plain,text/markdown" required><small>UTF-8 .md / .txt · 最大 1 MB</small></label><label class="form-field"><span>更新摘要</span><textarea name="summary" maxlength="240" placeholder="简要说明本次更新内容">${escapeHtml(record.summary || '')}</textarea></label><label class="form-field"><span>历史记录处理方式</span><select name="mode"><option value="merge">智能合并：新增 / 修订，不重复导入</option><option value="replace">替换全部历史记录（保留备份）</option></select></label><label class="form-check"><input type="checkbox" name="setCurrent" checked><span>将版本号同步到工具卡片，不改写无版本历史日志</span></label><div class="form-error" role="alert" id="uploadError"></div><div class="form-actions"><button type="submit" class="portal-button primary">${icon('eye')} 生成发布预览</button><a class="portal-button" href="#logs/${tool.id}">取消</a></div></form><section class="preview-panel" id="releasePreview" aria-live="polite"><h2>${icon('eye')} 发布预览</h2><div class="empty-panel"><h3>等待选择日志文件</h3><p>上传并生成预览后，在这里确认对应网站与内容。</p></div></section></div>
    <section class="version-panel"><h2>${icon('tag')} 单独修改版本号</h2><p class="field-hint">不上传新日志，也可以修改卡片上展示的当前版本。</p><form id="versionForm" class="inline-form"><label class="form-field"><span>${escapeHtml(tool.name)} 当前版本</span><input name="version" maxlength="40" value="${escapeHtml(record.version)}" placeholder="如 2.0.0；留空清除版本"></label><button type="submit" class="portal-button">保存版本</button></form></section>
    <section class="backup-panel"><div class="backup-heading"><div><h2>${icon('history')} 历史备份与恢复</h2><p class="field-hint">每次发布或修改版本都保留修改前的数据。</p></div>${button('backups', '查看备份', 'archive')}</div><div id="backupList"></div></section>`;
}
function renderPreview(preview) {
  const target = document.getElementById('releasePreview');
  target.innerHTML = `<h2>${icon('eye')} 发布预览</h2><div class="tool-identity"><div class="app-icon ${preview.tool.category}-icon">${icon(preview.tool.icon)}</div><div><h3>${escapeHtml(preview.tool.name)}</h3><a class="tool-url" href="${preview.tool.url}" target="_blank" rel="noopener noreferrer">${preview.tool.url.replace('https://', '').replace(/\/$/, '')} ${icon('external-link-alt')}</a></div></div><div class="detail-meta">${versionBadge(preview.setCurrent ? preview.version : state.record.version)}<span>${preview.latestDate}</span></div><div class="import-stats">${icon('file-alt')} ${escapeHtml(preview.filename)} · 识别 ${preview.entries.length} 条记录<br>新增 ${preview.stats.added} · 修订 ${preview.stats.changed} · 未变化 ${preview.stats.unchanged}<br>发布后共 ${preview.stats.total} 条${preview.stats.removed ? ` · 移除 ${preview.stats.removed} 条` : ''}</div>${preview.summary ? `<p class="record-summary">${escapeHtml(preview.summary)}</p>` : ''}${preview.mode === 'replace' ? '<div class="warning-panel">将替换该工具全部历史日志，修改前的数据会保留为备份。</div>' : ''}<div class="timeline">${entriesHtml(preview.entries, 3)}</div>${preview.entries.length > 3 ? `<p class="field-hint">另有 ${preview.entries.length - 3} 条记录随发布保留。</p>` : ''}<label class="form-check"><input type="checkbox" id="publishConfirmed"><span>我已确认对应网站、版本号和更新内容</span></label>${preview.mode === 'replace' ? '<label class="form-check"><input type="checkbox" id="replaceConfirmed"><span>我确认替换该工具全部历史日志</span></label>' : ''}<div class="form-error" role="alert" id="publishError"></div><div class="form-actions">${button('publish', '确认发布', 'check', true)}</div><p class="field-hint">预览有效期为 10 分钟；修改左侧字段后需要重新生成。</p>`;
}
function invalidatePreview() {
  state.preview = null; state.draftGeneration++;
  const panel = document.getElementById('releasePreview');
  if (panel) panel.innerHTML = '<h2>发布预览</h2><div class="empty-panel"><p>表单内容已变更，请重新生成发布预览。</p></div>';
}

async function route() {
  const generation = ++state.generation;
  const parts = location.hash.replace(/^#/, '').split('/');
  const oldPage = state.page, oldTool = state.selected;
  state.page = ['logs', 'manage'].includes(parts[0]) ? parts[0] : 'home';
  state.category = ['ai', 'azure', 'tool'].includes(parts[0]) ? parts[0] : 'all';
  state.selected = state.tools.some(tool => tool.id === parts[1]) ? parts[1] : state.selected;
  if (state.page !== oldPage || oldTool !== state.selected) state.showAll = false;
  state.preview = null;
  state.draftGeneration++;
  document.querySelectorAll('.sidebar-item').forEach(item => { const active = state.page === 'home' ? item.dataset.filter === state.category : item.dataset.page === state.page; item.classList.toggle('active', active); if (active) item.setAttribute('aria-current', 'page'); else item.removeAttribute('aria-current'); });
  searchInput.disabled = state.page !== 'home';
  if (state.page === 'home') { renderHome(); return; }
  pageContent.innerHTML = '<div class="loading-state">正在加载更新记录…</div>';
  try {
    const record = await request(`/api/tools/${state.selected}/changelog`);
    if (generation !== state.generation) return;
    state.record = record;
    if (state.page === 'manage') { state.me = await request('/api/me'); if (generation !== state.generation) return; renderManage(); } else renderLogs();
  } catch (error) { if (generation === state.generation) { pageContent.innerHTML = `<div class="empty-panel"><h3>加载失败</h3><p>${escapeHtml(error.message)}</p>${button('retry', '重试', 'redo')}</div>`; } }
}

pageContent.addEventListener('input', event => { if (event.target.closest('#uploadForm')) invalidatePreview(); });
pageContent.addEventListener('change', event => {
  if (event.target.id === 'manageTool') { navigate('manage', event.target.value); return; }
  if (event.target.closest('#uploadForm')) invalidatePreview();
});
pageContent.addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.target;
  if (state.busy) return;
  const submit = form.querySelector('button[type="submit"]');
  const generation = state.generation, draftGeneration = state.draftGeneration, toolId = state.selected;
  state.busy = true; if (submit) submit.disabled = true;
  try {
    if (form.id === 'loginForm') {
      await postJson('/api/login', { password: new FormData(form).get('password') });
      state.me = await request('/api/me');
      announce('管理员登录成功。'); await route();
    } else if (form.id === 'uploadForm') {
      const file = form.elements.file.files[0];
      if (!file || !/\.(md|txt)$/i.test(file.name)) throw new Error('请选择 .md 或 .txt 文件。');
      if (file.size > 1024 * 1024) throw new Error('日志文件不能超过 1 MB。');
      const data = new FormData(form);
      data.delete('toolId'); data.set('setCurrent', String(form.elements.setCurrent.checked));
      const preview = await request(`/api/admin/tools/${toolId}/changelog/preview`, { method: 'POST', body: data });
      if (generation !== state.generation || draftGeneration !== state.draftGeneration) return;
      state.preview = preview; renderPreview(preview); document.getElementById('uploadError').textContent = '';
    } else if (form.id === 'versionForm') {
      await postJson(`/api/admin/tools/${toolId}/version`, { version: new FormData(form).get('version'), revision: state.record.revision }, 'PATCH');
      await loadTools(); announce('当前版本已保存，工具卡片已同步更新。'); await route();
    }
  } catch (error) {
    const id = form.id === 'loginForm' ? 'loginError' : form.id === 'uploadForm' ? 'uploadError' : '';
    const target = id && document.getElementById(id);
    if (generation === state.generation && target) target.textContent = error.message; else report(error);
  } finally { state.busy = false; if (submit?.isConnected) submit.disabled = false; }
});
pageContent.addEventListener('click', async event => {
  const control = event.target.closest('[data-action]'); if (!control) return;
  const action = control.dataset.action;
  if (action === 'grid' || action === 'list') { state.view = action; renderHome(); return; }
  if (action === 'more') { state.showAll = !state.showAll; renderLogs(); return; }
  if (action === 'retry') { await route(); return; }
  if (state.busy) return;
  state.busy = true; control.disabled = true;
  const toolId = state.selected, generation = state.generation;
  try {
    if (action === 'publish') {
      if (!state.preview) throw new Error('请重新生成发布预览。');
      const confirmed = document.getElementById('publishConfirmed').checked;
      const replaceConfirmed = document.getElementById('replaceConfirmed')?.checked || false;
      if (!confirmed) throw new Error('请确认对应网站、版本和内容。');
      if (state.preview.mode === 'replace' && !replaceConfirmed) throw new Error('请单独确认替换全部历史记录。');
      await postJson(`/api/admin/tools/${toolId}/changelog/publish`, { previewId: state.preview.previewId, confirmed, replaceConfirmed });
      await loadTools(); announce('日志已发布并持久保存；工具卡片版本已按你的选择同步。'); navigate('logs', toolId);
    } else if (action === 'logout') {
      if (state.me.mode === 'entra') { location.href = '/.auth/logout?post_logout_redirect_uri=%2F'; return; }
      await postJson('/api/logout', {}); state.me = await request('/api/me'); state.preview = null;
      announce('已退出管理员会话。'); await route();
    } else if (action === 'backups') {
      const result = await request(`/api/admin/tools/${toolId}/archives`);
      if (generation !== state.generation) return;
      document.getElementById('backupList').innerHTML = result.archives.length ? result.archives.map(archive => `<div class="backup-row"><div><strong>${new Date(archive.createdAt).toLocaleString('zh-CN')}</strong><p>${escapeHtml(archive.filename || ({ version: '修改版本', restore: '恢复备份', merge: '合并日志', replace: '替换日志' }[archive.action] || archive.action))} · 修改前 ${archive.beforeCount} 条 · 版本 ${escapeHtml(archive.beforeVersion || '未设置')}</p></div><button type="button" class="portal-button" data-action="restore" data-archive="${archive.archiveId}">恢复修改前</button></div>`).join('') : '<p class="field-hint">暂无备份；首次修改后会自动创建。</p>';
    } else if (action === 'restore') {
      if (!confirm('确认恢复此次操作之前的日志和版本？当前数据也会保留为新备份。')) return;
      await postJson(`/api/admin/tools/${toolId}/restore`, { archiveId: control.dataset.archive, revision: state.record.revision, confirmed: true });
      await loadTools(); announce('已恢复备份，恢复前的数据也已保留。'); await route();
    }
  } catch (error) { const target = action === 'publish' && document.getElementById('publishError'); if (target) target.textContent = error.message; else report(error); }
  finally { state.busy = false; if (control.isConnected) control.disabled = false; }
});

document.getElementById('menuToggle').addEventListener('click', () => {
  const expanded = document.getElementById('sidebar').classList.toggle('expanded');
  document.querySelector('.main-layout').classList.toggle('sidebar-expanded', expanded);
  document.getElementById('menuToggle').setAttribute('aria-expanded', String(expanded));
});
searchInput.addEventListener('input', () => { state.query = searchInput.value; if (state.page === 'home') renderHome(); });
document.addEventListener('keydown', event => {
  if ((event.ctrlKey || event.metaKey) && event.key === '/' && state.page === 'home') { event.preventDefault(); searchInput.focus(); }
  if (event.key === 'Escape' && document.activeElement === searchInput) { searchInput.value = ''; state.query = ''; renderHome(); searchInput.blur(); }
});
document.getElementById('fullscreenButton').addEventListener('click', async () => { try { if (!document.fullscreenElement) await document.documentElement.requestFullscreen(); else await document.exitFullscreen(); } catch { announce('当前浏览器环境不支持全屏。'); } });
document.getElementById('themeButton').addEventListener('click', () => {
  const theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = theme;
  try { localStorage.setItem('tools-portal-theme', theme); } catch { /* Preference storage is optional. */ }
});
try { const theme = localStorage.getItem('tools-portal-theme'); if (theme === 'dark' || theme === 'light') document.documentElement.dataset.theme = theme; } catch { /* No persistence available. */ }
document.getElementById('currentDate').textContent = new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', dateStyle: 'full' }).format(new Date());
window.addEventListener('hashchange', () => { announce(''); route(); });
(async () => {
  try { await loadTools(); [state.me, state.health] = await Promise.all([request('/api/me'), request('/api/health')]); await route(); }
  catch (error) { pageContent.innerHTML = `<div class="empty-panel"><h3>工具门户加载失败</h3><p>${escapeHtml(error.message)}</p><button type="button" class="portal-button" data-action="reload">重新加载</button></div>`; pageContent.querySelector('[data-action="reload"]').addEventListener('click', () => location.reload()); }
})();
