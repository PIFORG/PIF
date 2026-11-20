import fs from 'fs';
import path from 'path';

const AUTH_DIR = path.join(process.cwd(), 'e2e/.auth');

export type E2ECredentials = {
  password: string;
  investor: { email: string; id: string; role: string };
  admin: { email: string; id: string; role: string };
  apiBaseUrl: string;
  webBaseUrl: string;
  database: string;
};

export function authDir() {
  return AUTH_DIR;
}

export function loadCredentials(): E2ECredentials {
  const file = path.join(AUTH_DIR, 'credentials.local.json');
  if (!fs.existsSync(file)) {
    throw new Error(
      'E2E credentials missing. Run: npm run e2e:provision (isolated *_test DB only).',
    );
  }
  const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as E2ECredentials;
  if (!raw?.password || !raw.investor?.email || !raw.admin?.email) {
    throw new Error('E2E credentials file is incomplete. Re-run provision-e2e-users.mjs');
  }
  if (raw.database && !String(raw.database).endsWith('_test')) {
    throw new Error('E2E credentials point to a non-test database — refusing to continue.');
  }
  return raw;
}

export const investorState = path.join(AUTH_DIR, 'investor.storage.json');
export const adminState = path.join(AUTH_DIR, 'admin.storage.json');