#!/usr/bin/env node
/**
 * Switches local development from the preview inbox to real SMTP delivery.
 *
 *   npm run mail:setup            (from the repository root, in your own terminal)
 *
 * Asks for the SMTP password (for Gmail: a 16-letter App Password) without echoing it,
 * stores it in apps/api/.env, sets MAIL_TRANSPORT=smtp and sends a test message to
 * SMTP_USER. If the check fails, MAIL_TRANSPORT is put back to preview so registration
 * emails keep being captured locally. The password is never printed.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const ENV_FILE = path.resolve(process.cwd(), '.env');

function readEnv() {
  const values = {};
  for (const line of readFileSync(ENV_FILE, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m) values[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return values;
}

function setEnv(updates) {
  const lines = readFileSync(ENV_FILE, 'utf8').split(/\r?\n/);
  for (const [key, value] of Object.entries(updates)) {
    const i = lines.findIndex((l) => new RegExp(`^\\s*${key}\\s*=`).test(l));
    if (i >= 0) lines[i] = `${key}=${value}`;
    else lines.push(`${key}=${value}`);
  }
  writeFileSync(ENV_FILE, lines.join('\n'));
}

function promptHidden(question) {
  return new Promise((resolve) => {
    const { stdin, stdout } = process;
    stdout.write(question);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    let value = '';
    const onData = (chunk) => {
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n') {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.off('data', onData);
          stdout.write('\n');
          resolve(value);
          return;
        }
        if (ch === '\u0003') {
          stdout.write('\nCancelled. Nothing was changed.\n');
          process.exit(130);
        }
        if (ch === '\u007f' || ch === '\b') value = value.slice(0, -1);
        else value += ch;
      }
    };
    stdin.on('data', onData);
  });
}

if (!existsSync(ENV_FILE)) {
  console.error(`No .env found at ${ENV_FILE}. Copy .env.example to .env first.`);
  process.exit(1);
}
if (!process.stdin.isTTY) {
  console.error('Run this in an interactive terminal so the password can be typed without being shown.');
  process.exit(1);
}

const env = readEnv();
if (env.NODE_ENV === 'production') {
  console.error('mail:setup is for local development only. Configure production secrets in your deployment platform.');
  process.exit(1);
}
if (!env.SMTP_HOST || !env.SMTP_USER) {
  console.error('Set SMTP_HOST and SMTP_USER in apps/api/.env first (see .env.example).');
  process.exit(1);
}

const isGmail = /(^|\.)gmail\.com$|(^|\.)googlemail\.com$/i.test(env.SMTP_HOST);
console.log(`SMTP server: ${env.SMTP_HOST}:${env.SMTP_PORT || '587'}  account: ${env.SMTP_USER}`);
if (isGmail) {
  console.log('Use a Google App Password (Google Account > Security > 2-Step Verification > App passwords),');
  console.log('not your normal Gmail password. Spaces are fine; they are removed.');
}

let password = (await promptHidden('SMTP password (hidden): ')).replace(/\s+/g, '');
if (!password) {
  console.error('No password entered. Nothing was changed.');
  process.exit(1);
}
if (isGmail && !/^[a-zA-Z]{16}$/.test(password)) {
  console.error('A Google App Password is exactly 16 letters. Nothing was changed; generate one and try again.');
  process.exit(1);
}

setEnv({ SMTP_PASS: password, MAIL_TRANSPORT: 'smtp' });
password = '';
console.log('Saved to apps/api/.env. Sending a test message to the SMTP account...\n');

const check = spawnSync('npx', ['ts-node', '-r', 'tsconfig-paths/register', 'src/scripts/mail-verify.ts', '--to', env.SMTP_USER], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
});

if (check.status === 0) {
  console.log('\nReal delivery is configured. Restart the API (Ctrl+C, then npm run dev:api) so it uses SMTP.');
  console.log(`Then check the ${env.SMTP_USER} inbox (and spam folder) for "MTRS SMTP delivery check".`);
} else {
  setEnv({ MAIL_TRANSPORT: 'preview' });
  console.error('\nThe SMTP check failed, so MAIL_TRANSPORT was set back to preview (emails stay in the local inbox).');
  console.error('EAUTH usually means a wrong or revoked App Password; ESOCKET/ETIMEDOUT means the network blocks port 587.');
  process.exit(1);
}
