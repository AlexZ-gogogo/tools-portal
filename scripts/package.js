'use strict';
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const output = process.argv[2] ? path.resolve(process.argv[2]) : path.join(root, 'dist', 'tools-portal.zip');
if (!output.toLowerCase().endsWith('.zip')) throw new Error('Output must be a .zip file');
fs.mkdirSync(path.dirname(output), { recursive: true });
const files = ['index.html', 'app.js', 'styles.css', 'favicon.svg', 'server.js', 'package.json', 'package-lock.json', 'lib', 'data'];
if (process.platform === 'win32') {
  const quoted = value => `'${value.replace(/'/g, "''")}'`;
  const command = `Compress-Archive -LiteralPath @(${files.map(value => quoted(path.join(root, value))).join(',')}) -DestinationPath ${quoted(output)} -Force`;
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { stdio: 'inherit', windowsHide: true });
  if (result.status !== 0) process.exit(result.status || 1);
} else {
  const result = spawnSync('zip', ['-r', output, ...files], { cwd: root, stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status || 1);
}
console.log(output);
