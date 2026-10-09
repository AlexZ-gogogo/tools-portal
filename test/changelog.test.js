'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { parseDocument, decodeFile, validDate, normalizeVersion, mergeEntries, publicRecord } = require('../lib/changelog');
const { passwordHash, verifyPassword } = require('../lib/auth');
const source = readFileSync(path.join(__dirname, '..', 'data', 'aoai-changelog.md'), 'utf8');

test('AOAI seed preserves 18 dated entries without inventing versions', () => {
  const entries = parseDocument(source, '2026-09-30');
  assert.equal(entries.length, 18);
  assert.equal(entries[0].date, '2026-09-30');
  assert.equal(entries.at(-1).date, '2026-05-25');
  assert.ok(entries.every(entry => !entry.version));
  assert.match(entries[0].markdown, /gpt-6.1-sol/);
});
test('Markdown release versions, headings and fences parse correctly', () => {
  const entries = parseDocument('# 日志\n## v2.1.0 - 2026-10-09\n新增功能\n### 说明\n```md\n## 2026-01-01\n```\n## 2026-10-08\n修复', '2026-10-09');
  assert.equal(entries.length, 2);
  assert.equal(entries[0].version, '2.1.0');
  assert.match(entries[0].markdown, /## 2026-01-01/);
});
test('Plain text uses provided date; arbitrary subheadings stay in content', () => {
  const entries = parseDocument('# 内容\n## 新功能\n一条记录', '2026-10-09');
  assert.equal(entries.length, 1);
  assert.equal(entries[0].date, '2026-10-09');
  assert.match(entries[0].markdown, /新功能/);
});
test('Invalid real calendar dates and duplicate release headings are rejected', () => {
  assert.equal(validDate('2026-02-30'), false);
  assert.equal(validDate('2024-02-29'), true);
  assert.throws(() => parseDocument('## 2026-02-30\n内容', '2026-10-09'), /无效日期/);
  assert.throws(() => parseDocument('## 2026-10-09\n甲\n## 2026-10-09\n乙', '2026-10-09'), /重复日志标题/);
});
test('Distinct same-day release titles get distinct stable IDs', () => {
  const entries = parseDocument('## 2026-10-09 morning\n甲\n## 2026-10-09 evening\n乙', '2026-10-09');
  assert.equal(entries.length, 2);
  assert.notEqual(entries[0].id, entries[1].id);
});
test('Reimport skips unchanged records and detects content revisions', () => {
  const before = parseDocument('## 2026-10-09\n原始', '2026-10-09');
  const same = mergeEntries(before, before, 'merge');
  assert.deepEqual(same.stats, { added: 0, changed: 0, unchanged: 1, total: 1, removed: 0 });
  const revised = parseDocument('## 2026-10-09\n修改', '2026-10-09');
  const result = mergeEntries(before, revised, 'merge');
  assert.equal(result.stats.changed, 1);
  assert.equal(result.entries[0].markdown, '修改');
  assert.equal(result.entries[0].id, before[0].id);
});
test('Replacement removes unlisted historical records explicitly', () => {
  const before = parseDocument(source, '2026-09-30');
  const incoming = parseDocument('## 2026-10-09\n更新', '2026-10-09');
  assert.equal(mergeEntries(before, incoming, 'replace').stats.removed, 18);
  assert.equal(mergeEntries(before, incoming, 'merge').entries.length, 19);
});
test('Unsafe Markdown cannot execute HTML, scripts, remote images or javascript URLs', () => {
  const content = '<script>window.injected=true</script>\n<img src=x onerror=alert(1)>\n[unsafe](javascript:alert(1))\n![tracking](https://example.test/secret)\n[safe](https://example.test/)';
  const { entries } = publicRecord({ entries: parseDocument(content, '2026-10-09') });
  assert.doesNotMatch(entries[0].html, /<script|<img|href="javascript:/);
  assert.match(entries[0].html, /rel="noopener noreferrer nofollow"/);
  assert.match(entries[0].html, /&lt;script&gt;/);
});
test('Upload decoding validates bytes, filename, encoding, size and empty content', () => {
  assert.equal(decodeFile(Buffer.from('\uFEFF你好\r\n日志'), '更新日志.md'), '你好\n日志');
  assert.throws(() => decodeFile(Buffer.from('x'), '../../secret.md'), /文件名/);
  assert.throws(() => decodeFile(Buffer.from('x'), 'payload.exe'), /文件名/);
  assert.throws(() => decodeFile(Buffer.alloc(1024 * 1024 + 1), 'large.md'), /1 MB/);
  assert.throws(() => decodeFile(Buffer.from([0xff, 0xfe]), 'bad.md'), /UTF-8/);
  assert.throws(() => decodeFile(Buffer.from('\0test'), 'bad.md'), /二进制/);
  assert.throws(() => decodeFile(Buffer.from(' \n '), 'empty.md'), /没有内容/);
});
test('Manual versions are optional, normalized and format checked', () => {
  assert.equal(normalizeVersion('v2.0'), '2.0');
  assert.equal(normalizeVersion('2.0.0-beta+build'), '2.0.0-beta+build');
  assert.equal(normalizeVersion(''), '');
  assert.throws(() => normalizeVersion('latest'), /格式/);
});
test('Passwords are verified against salted scrypt hashes', () => {
  const encoded = passwordHash('unit-test-password-long');
  assert.ok(verifyPassword('unit-test-password-long', encoded));
  assert.equal(verifyPassword('wrong', encoded), false);
  assert.equal(verifyPassword('wrong', 'malformed'), false);
});
