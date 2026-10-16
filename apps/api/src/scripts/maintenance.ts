/**
 * Retention clean-up for expired sessions, tokens, used recovery codes and old audit events.
 *
 *   npm run maintenance -w @mtrs/api             # dry run: prints what would be deleted
 *   npm run maintenance -w @mtrs/api -- --apply  # deletes
 *
 * Intended for a scheduler (cron, Kubernetes CronJob, ...). Never hard-deletes user accounts.
 */
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { MaintenanceService } from '../maintenance/maintenance.service';

async function main() {
  const apply = process.argv.includes('--apply');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  try {
    const report = await app.get(MaintenanceService).run({ apply });
    console.log(JSON.stringify(report, null, 2));
    if (!apply) console.log('Dry run only. Re-run with --apply to delete.');
  } finally {
    await app.close();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
