'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { hash, PortalError } = require('./changelog');

class LocalStore {
  constructor(directory) { this.directory = path.resolve(directory); this.queue = Promise.resolve(); this.kind = 'local'; }
  location(key) {
    if (!/^(records|previews|archives)\/[a-zA-Z0-9/_-]+\.json$/.test(key)) throw new Error('Invalid storage key');
    return path.join(this.directory, key);
  }
  async read(key) {
    try { const text = await fs.readFile(this.location(key), 'utf8'); return { value: JSON.parse(text), etag: hash(text) }; }
    catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  }
  async write(key, value, expectedEtag) {
    const operation = this.queue.then(async () => {
      const current = await this.read(key);
      if (expectedEtag !== undefined && (current?.etag || null) !== expectedEtag) throw new PortalError(409, '记录已被修改，请重新预览后发布。', 'CONFLICT');
      const filename = this.location(key); const temporary = `${filename}.${randomUUID()}.tmp`;
      await fs.mkdir(path.dirname(filename), { recursive: true });
      const text = JSON.stringify(value);
      try { await fs.writeFile(temporary, text, { mode: 0o600, flag: 'wx' }); await fs.rename(temporary, filename); }
      finally { await fs.rm(temporary, { force: true }); }
      return hash(text);
    });
    this.queue = operation.catch(() => {});
    return operation;
  }
  async list(prefix) {
    if (!/^archives\/[a-zA-Z0-9_-]+\/$/.test(prefix)) throw new Error('Invalid archive prefix');
    const dir = path.join(this.directory, prefix);
    try { return (await fs.readdir(dir)).filter(name => name.endsWith('.json')).map(name => prefix + name).sort().reverse(); }
    catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  }
  async delete(key) { await fs.rm(this.location(key), { force: true }); }
}

class BlobStore {
  constructor(env) {
    const { BlobServiceClient } = require('@azure/storage-blob');
    const { DefaultAzureCredential, ManagedIdentityCredential } = require('@azure/identity');
    const credential = env.NODE_ENV === 'development' ? new DefaultAzureCredential() : env.AZURE_CLIENT_ID ? new ManagedIdentityCredential({ clientId: env.AZURE_CLIENT_ID }) : new ManagedIdentityCredential();
    const url = new URL(env.PORTAL_BLOB_ACCOUNT_URL);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || !/\.blob\.core\.(windows\.net|chinacloudapi\.cn|usgovcloudapi\.net)$/.test(url.hostname)) throw new Error('Invalid PORTAL_BLOB_ACCOUNT_URL');
    this.container = new BlobServiceClient(url.href, credential).getContainerClient(env.PORTAL_BLOB_CONTAINER || 'tools-portal');
    this.kind = 'blob';
  }
  async read(key) {
    const blob = this.container.getBlockBlobClient(key);
    try {
      const result = await blob.download(0);
      const chunks = []; let length = 0;
      for await (const chunk of result.readableStreamBody) { length += chunk.length; if (length > 12 * 1024 * 1024) throw new Error('Storage document too large'); chunks.push(chunk); }
      return { value: JSON.parse(Buffer.concat(chunks).toString('utf8')), etag: result.etag };
    } catch (error) { if (error.statusCode === 404 && error.code !== 'ContainerNotFound') return null; throw error; }
  }
  async write(key, value, expectedEtag) {
    const text = JSON.stringify(value);
    const conditions = expectedEtag === null ? { ifNoneMatch: '*' } : expectedEtag !== undefined ? { ifMatch: expectedEtag } : undefined;
    try {
      const result = await this.container.getBlockBlobClient(key).upload(text, Buffer.byteLength(text), { conditions, blobHTTPHeaders: { blobContentType: 'application/json; charset=utf-8' } });
      return result.etag;
    } catch (error) { if (error.statusCode === 409 || error.statusCode === 412) throw new PortalError(409, '记录已被修改，请重新预览后发布。', 'CONFLICT'); throw error; }
  }
  async list(prefix) {
    const keys = []; for await (const blob of this.container.listBlobsFlat({ prefix })) { keys.push(blob.name); if (keys.length >= 1000) break; }
    return keys.sort().reverse();
  }
  async delete(key) { await this.container.getBlockBlobClient(key).deleteIfExists(); }
}

class ReadOnlyStore {
  constructor() { this.kind = 'readonly'; }
  async read() { return null; }
  async list() { return []; }
  async write() { throw new PortalError(503, '持久存储尚未配置，上传已关闭。请配置 Blob Storage 后重试。', 'STORAGE_NOT_CONFIGURED'); }
  async delete() {}
}

function createStore(env = process.env) {
  if (env.WEBSITE_SITE_NAME && !env.PORTAL_STORAGE && !env.PORTAL_BLOB_ACCOUNT_URL && !env.PORTAL_DATA_DIR) return new ReadOnlyStore();
  const mode = env.PORTAL_STORAGE || (env.PORTAL_BLOB_ACCOUNT_URL ? 'blob' : 'local');
  if (mode === 'blob') { if (!env.PORTAL_BLOB_ACCOUNT_URL) throw new Error('PORTAL_BLOB_ACCOUNT_URL is required for Blob storage'); return new BlobStore(env); }
  if (mode !== 'local') throw new Error('PORTAL_STORAGE must be local or blob');
  if (env.WEBSITE_SITE_NAME && !env.PORTAL_DATA_DIR) throw new Error('App Service local storage requires PORTAL_DATA_DIR outside the deployment directory; Blob storage is recommended');
  const directory = env.PORTAL_DATA_DIR || path.join(__dirname, '..', '.portal-data');
  const relative = path.relative(path.resolve(__dirname, '..'), path.resolve(directory));
  if (env.WEBSITE_SITE_NAME && (!relative || (!relative.startsWith('..' + path.sep) && !path.isAbsolute(relative)))) throw new Error('PORTAL_DATA_DIR cannot be inside the deployment directory');
  return new LocalStore(directory);
}
module.exports = { LocalStore, BlobStore, ReadOnlyStore, createStore };
