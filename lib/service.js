'use strict';

const { readFileSync } = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { tools, getTool } = require('./tools');
const { PortalError, decodeFile, parseDocument, normalizeVersion, normalizeUploadFilename, validDate, emptyRecord, mergeEntries, publicRecord, hash } = require('./changelog');
const seedText = readFileSync(path.join(__dirname, '..', 'data', 'aoai-changelog.md'), 'utf8').replace(/\r\n?/g, '\n').trim();
const seedRecord = { ...emptyRecord('aoai-deploy'), entries: parseDocument(seedText, '2026-09-30'), source: { filename: '更新日志.md', label: '管理员提供的历史日志' } };
const copy = value => structuredClone(value);
const keyFor = id => `records/${id}.json`;
const UUID = /^[a-f0-9-]{36}$/;
const ARCHIVE = /^\d{17}-[a-f0-9-]{36}$/;

class PortalService {
  constructor(store) { this.store = store; }
  checkTool(id) { if (!getTool(id)) throw new PortalError(404, '工具不存在。', 'NOT_FOUND'); }
  async read(id) {
    this.checkTool(id);
    const stored = await this.store.read(keyFor(id));
    return stored || { value: id === 'aoai-deploy' ? copy(seedRecord) : emptyRecord(id), etag: null };
  }
  async tools() {
    return Promise.all(tools.map(async tool => {
      const { value } = await this.read(tool.id);
      return { ...tool, version: value.version, latestDate: value.entries[0]?.date || null, logCount: value.entries.length, revision: value.revision };
    }));
  }
  async record(id) { return publicRecord((await this.read(id)).value); }
  async preview(id, file, body, admin) {
    this.checkTool(id);
    if (!file) throw new PortalError(400, '请选择日志文件。');
    const filename = normalizeUploadFilename(file.originalname);
    const text = decodeFile(file.buffer, filename);
    const date = body.date;
    if (!validDate(date)) throw new PortalError(400, '请填写有效发布日期。');
    const entries = parseDocument(text, date);
    const version = normalizeVersion(body.version || entries[0].version || '');
    const setCurrent = body.setCurrent === 'true';
    if (!['true', 'false'].includes(body.setCurrent)) throw new PortalError(400, '请确认是否同步卡片版本。');
    if (setCurrent && !version) throw new PortalError(400, '同步卡片版本前请填写版本号。');
    const mode = body.mode;
    if (!['merge', 'replace'].includes(mode)) throw new PortalError(400, '请选择有效的导入模式。');
    const summary = body.summary || '';
    if (typeof summary !== 'string' || summary.length > 240) throw new PortalError(400, '更新摘要不能超过 240 字。');
    const current = await this.read(id);
    const merged = mergeEntries(current.value.entries, entries, mode);
    const previewId = randomUUID();
    const preview = { previewId, toolId: id, actor: admin.actor, sessionId: admin.data.id, expiresAt: Date.now() + 10 * 60 * 1000, baseEtag: current.etag, baseRevision: current.value.revision, entries, text, filename, fileHash: hash(file.buffer), version, setCurrent, mode, summary: summary.trim(), stats: merged.stats };
    await this.store.write(`previews/${previewId}.json`, preview, null);
    return { previewId, expiresAt: preview.expiresAt, tool: getTool(id), version, setCurrent, mode, summary: preview.summary, filename: preview.filename, latestDate: entries[0].date, stats: merged.stats, baseRevision: preview.baseRevision, entries: publicRecord({ entries }).entries };
  }
  async archiveAndCommit(id, before, after, operation, expectedEtag) {
    const archiveId = `${new Date().toISOString().replace(/\D/g, '')}-${randomUUID()}`;
    const archiveKey = `archives/${id}/${archiveId}.json`;
    after.lastArchiveId = archiveId;
    const archive = { archiveId, toolId: id, createdAt: new Date().toISOString(), committed: false, before, after, ...operation };
    await this.store.write(archiveKey, archive, null);
    try { await this.store.write(keyFor(id), after, expectedEtag); }
    catch (error) { await this.store.delete(archiveKey).catch(() => {}); throw error; }
    await this.store.write(archiveKey, { ...archive, committed: true }).catch(error => console.error('Archive receipt update failed', error.code || error.name));
    return publicRecord(after);
  }
  async publish(id, body, admin) {
    this.checkTool(id);
    if (body.confirmed !== true) throw new PortalError(400, '请确认工具网站与预览内容后发布。');
    if (typeof body.previewId !== 'string' || !UUID.test(body.previewId)) throw new PortalError(400, '请先生成发布预览。');
    const saved = await this.store.read(`previews/${body.previewId}.json`);
    const preview = saved?.value;
    if (!preview || preview.expiresAt <= Date.now() || preview.toolId !== id || preview.actor !== admin.actor || preview.sessionId !== admin.data.id) throw new PortalError(410, '预览已过期或不属于当前工具/会话，请重新预览。', 'PREVIEW_EXPIRED');
    if (preview.mode === 'replace' && body.replaceConfirmed !== true) throw new PortalError(400, '替换历史记录需要单独确认。');
    const current = await this.read(id);
    if (current.etag !== preview.baseEtag || current.value.revision !== preview.baseRevision) throw new PortalError(409, '记录已更新，请重新预览，避免覆盖他人的修改。', 'CONFLICT');
    const merged = mergeEntries(current.value.entries, preview.entries, preview.mode);
    const after = { ...current.value, version: preview.setCurrent ? preview.version : current.value.version, summary: preview.summary, entries: merged.entries, revision: current.value.revision + 1, updatedAt: new Date().toISOString(), source: { filename: preview.filename, label: '管理员手动上传' } };
    const result = await this.archiveAndCommit(id, current.value, after, { actor: admin.actor, action: preview.mode, filename: preview.filename, fileHash: preview.fileHash, originalText: preview.text, stats: merged.stats }, current.etag);
    await this.store.delete(`previews/${body.previewId}.json`).catch(() => {});
    return { record: result, stats: merged.stats };
  }
  async setVersion(id, body, admin) {
    const version = normalizeVersion(body.version);
    const current = await this.read(id);
    if (!Number.isInteger(body.revision) || body.revision !== current.value.revision) throw new PortalError(409, '版本已被修改，请刷新重试。', 'CONFLICT');
    const after = { ...current.value, version, revision: current.value.revision + 1, updatedAt: new Date().toISOString() };
    return this.archiveAndCommit(id, current.value, after, { actor: admin.actor, action: 'version' }, current.etag);
  }
  async archives(id) {
    this.checkTool(id);
    const current = (await this.read(id)).value;
    const keys = (await this.store.list(`archives/${id}/`)).slice(0, 50);
    const archives = await Promise.all(keys.map(key => this.store.read(key)));
    return archives.filter(x => x && (x.value.committed || x.value.archiveId === current.lastArchiveId)).map(({ value }) => ({ archiveId: value.archiveId, createdAt: value.createdAt, action: value.action, filename: value.filename || '', beforeVersion: value.before.version, afterVersion: value.after.version, beforeCount: value.before.entries.length, afterCount: value.after.entries.length }));
  }
  async restore(id, body, admin) {
    this.checkTool(id);
    if (body.confirmed !== true || typeof body.archiveId !== 'string' || !ARCHIVE.test(body.archiveId)) throw new PortalError(400, '请选择备份并确认恢复。');
    const current = await this.read(id);
    if (body.revision !== current.value.revision) throw new PortalError(409, '记录已修改，请刷新备份列表后重试。', 'CONFLICT');
    const archive = (await this.store.read(`archives/${id}/${body.archiveId}.json`))?.value;
    if (!archive || (!archive.committed && archive.archiveId !== current.value.lastArchiveId)) throw new PortalError(404, '备份不存在。', 'NOT_FOUND');
    const after = { ...copy(archive.before), revision: current.value.revision + 1, updatedAt: new Date().toISOString() };
    return this.archiveAndCommit(id, current.value, after, { actor: admin.actor, action: 'restore', restoredArchive: body.archiveId }, current.etag);
  }
}
module.exports = { PortalService };
