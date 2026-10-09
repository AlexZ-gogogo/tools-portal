'use strict';
const readline = require('node:readline');
const { passwordHash } = require('../lib/auth');

if (!process.stdin.isTTY) {
  let value = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', chunk => { value += chunk; if (value.length > 512) process.exit(1); });
  process.stdin.on('end', () => {
    const password = value.trim();
    if (password.length < 16 || password.length > 256) { console.error('密码需为 16–256 个字符。'); process.exitCode = 1; return; }
    console.log(passwordHash(password));
  });
} else {
  process.stdout.write('输入管理员密码（至少 16 个字符，不显示输入）：');
  readline.emitKeypressEvents(process.stdin); process.stdin.setRawMode(true);
  let password = '';
  process.stdin.on('keypress', (text, key) => {
    if (key.ctrl && key.name === 'c') { process.stdin.setRawMode(false); process.exit(1); }
    if (key.name === 'return') {
      process.stdin.setRawMode(false); process.stdin.pause(); process.stdout.write('\n');
      if (password.length < 16 || password.length > 256) { console.error('密码需为 16–256 个字符。'); process.exitCode = 1; return; }
      console.log(passwordHash(password));
    } else if (key.name === 'backspace') password = password.slice(0, -1);
    else if (!key.ctrl && !key.meta && text && password.length < 257) password += text;
  });
}
