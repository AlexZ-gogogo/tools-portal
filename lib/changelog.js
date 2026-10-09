'use strict';

const { createHash } = require('node:crypto');
const MarkdownIt = require('markdown-it');
const { TextDecoder } = require('node:util');
const MAX_FILE_SIZE = 1024 * 1024;
const MAX_ENTRIES = 2000;
const VERSION = /^\d+\.\d+(?:\.\d+)?(?:-[A-Za-z0-9.-]+)?(?:\+[A-Za-z0-9.-]+)?$/;
const md = new MarkdownIt({ html: false, linkify: false, typographer: false });
const originalLinkOpen = md.renderer.rules.link_open || ((tokens, idx, options, env, self) => self.renderToken(tokens, idx, options));
md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
  tokens[idx].attrSet('rel', 'noopener noreferrer nofollow');
  tokens[idx].attrSet('target', '_blank');
  return originalLinkOpen(tokens, idx, options, env, self);
};
// Uploaded Markdown must not trigger tracking requests or display arbitrary remote images.
md.renderer.rules.image = (tokens, idx) => `<span class="markdown-image-alt">${md.utils.escapeHtml(tokens[idx].content || '图片')}</span>`;

class PortalError extends Error {
  constructor(status, message, code = 'INVALID_REQUEST') { super(message); this.status = status; this.code = code; }
}
const hash = value => createHash('sha256').update(value).digest('hex');
function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const time = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value;
}
function normalizeVersion(value = '') {
  if (typeof value !== 'string') throw new PortalError(400, '版本号必须是文本。');
  const version = value.trim().replace(/^v/i, '');
  if (version.length > 40 || (version && !VERSION.test(version))) throw new PortalError(400, '版本号格式应为 1.0、2.0.0 或 2.0.0-beta。');
  return version;
}
function decodeFile(buffer, filename) {
  if (typeof filename !== 'string' || !/\.(md|txt)$/i.test(filename) || filename.length > 200 || /[\x00-\x1f\/\\]/.test(filename)) throw new PortalError(400, '请选择文件名合法的 .md 或 .txt 日志文件。');
  if (!Buffer.isBuffer(buffer) || buffer.length > MAX_FILE_SIZE) throw new PortalError(413, '日志文件不能超过 1 MB。');
  let text;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(buffer); } catch { throw new PortalError(400, '请上传 UTF-8 编码的日志文件。'); }
  if (/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(text)) throw new PortalError(400, '不支持二进制文件或控制字符。');
  if (!text.trim()) throw new PortalError(400, '日志文件没有内容。');
  return text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').trim();
}
function normalizeUploadFilename(filename) {
  // Multipart libraries decode legacy filename parameters as Latin-1. Browsers send UTF-8.
  if (typeof filename !== 'string' || !/^[\x00-\xff]*$/.test(filename) || !/[^\x00-\x7f]/.test(filename)) return filename;
  try { return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.from(filename, 'latin1')); } catch { return filename; }
}
function parseDocument(text, fallbackDate) {
  if (!validDate(fallbackDate)) throw new PortalError(400, '请填写有效的发布日期（YYYY-MM-DD）。');
  // Only release/date headings start a new record; headings inside code fences are ignored.
  const lines = text.split('\n');
  const sections = []; let current = null; let fence = '';
  for (const line of lines) {
    const fenced = line.match(/^\s{0,3}(`{3,}|~{3,})/);
    if (fenced) {
      if (!fence) fence = fenced[1][0]; else if (fenced[1][0] === fence) fence = '';
      if (current) current.lines.push(line);
      continue;
    }
    const heading = !fence && line.match(/^##\s+(.+)$/);
    const date = heading && heading[1].match(/\b\d{4}-\d{2}-\d{2}\b/)?.[0];
    const version = heading && heading[1].match(/(?:^|[\s\[(])v?(\d+\.\d+(?:\.\d+)?(?:-[A-Za-z0-9.-]+)?(?:\+[A-Za-z0-9.-]+)?)(?=[\s\])]|$)/i)?.[1];
    if (heading && (date || version)) {
      current = { title: heading[1].trim(), date: date || fallbackDate, version: normalizeVersion(version || ''), lines: [] };
      sections.push(current);
    } else if (current) current.lines.push(line);
  }
  if (!sections.length) sections.push({ title: fallbackDate, date: fallbackDate, version: '', lines });
  const entries = sections.map(section => {
    if (!validDate(section.date)) throw new PortalError(400, `日志包含无效日期：${section.date}`);
    const markdown = section.lines.join('\n').trim();
    if (!markdown) throw new PortalError(400, `日志条目 ${section.title} 没有内容。`);
    return { id: hash(`${section.date}|${section.version}|${section.title}`), title: section.title, date: section.date, version: section.version, markdown, contentHash: hash(markdown) };
  });
  if (entries.length > MAX_ENTRIES) throw new PortalError(400, '日志条目过多，请拆分后上传。');
  const seen = new Set();
  for (const entry of entries) {
    if (seen.has(entry.id)) throw new PortalError(400, `重复日志标题：${entry.title}。同日不同更新请使用不同版本或标题。`);
    seen.add(entry.id);
  }
  return entries.sort((a, b) => b.date.localeCompare(a.date));
}
function emptyRecord(toolId) {
  return { schema: 1, toolId, version: '', revision: 0, entries: [], source: null, updatedAt: null };
}
function mergeEntries(existing, incoming, mode) {
  const map = new Map(existing.map(entry => [entry.id, entry]));
  let added = 0, changed = 0, unchanged = 0;
  for (const entry of incoming) {
    const old = map.get(entry.id);
    if (!old) added++; else if (old.contentHash === entry.contentHash) unchanged++; else changed++;
  }
  if (mode === 'replace') map.clear();
  for (const entry of incoming) map.set(entry.id, entry);
  const entries = [...map.values()].sort((a, b) => b.date.localeCompare(a.date));
  if (entries.length > MAX_ENTRIES || Buffer.byteLength(JSON.stringify(entries)) > 8 * MAX_FILE_SIZE) throw new PortalError(400, '合并后的历史记录过多，请精简日志。');
  return { entries, stats: { added, changed, unchanged, total: entries.length, removed: mode === 'replace' ? existing.filter(e => !incoming.some(i => i.id === e.id)).length : 0 } };
}
function publicRecord(record) {
  return { ...record, entries: record.entries.map(({ contentHash, ...entry }) => ({ ...entry, html: md.render(entry.markdown) })) };
}

module.exports = { PortalError, MAX_FILE_SIZE, hash, validDate, normalizeVersion, normalizeUploadFilename, decodeFile, parseDocument, emptyRecord, mergeEntries, publicRecord };
