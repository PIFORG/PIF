/**
 * The e2e suite deletes every row between tests, so it must never reach a development or
 * production database. It only runs against an explicit E2E_DATABASE_URL whose database
 * name ends in `_test`, and that URL replaces DATABASE_URL before the app boots.
 */
import { tmpdir } from 'os';
import { join } from 'path';

const url = process.env.E2E_DATABASE_URL;
if (!url) {
  throw new Error(
    'E2E_DATABASE_URL is not set. Point it at a dedicated database whose name ends in "_test".',
  );
}
const databaseName = decodeURIComponent(new URL(url).pathname.replace(/^\//, ''));
if (!/_test$/.test(databaseName)) {
  throw new Error(
    `Refusing to run e2e tests against "${databaseName}": the database name must end in "_test".`,
  );
}
process.env.DATABASE_URL = url;

// Tests must never deliver real mail or write into the developer's preview inbox.
process.env.MAIL_TRANSPORT = 'preview';
process.env.MAIL_PREVIEW_DIR = join(tmpdir(), `mtrs-e2e-mail-${process.pid}`);
