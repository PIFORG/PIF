import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdatePreferencesDto } from './auth.dto';

/** Mirrors the global ValidationPipe options in main.ts. */
async function check(body: Record<string, unknown>) {
  const dto = plainToInstance(UpdatePreferencesDto, body, { enableImplicitConversion: true });
  const errors = await validate(dto, { whitelist: true, forbidNonWhitelisted: true });
  return { dto, fields: errors.map((e) => e.property) };
}

describe('UpdatePreferencesDto (L7)', () => {
  it('accepts a valid update and normalizes the currency code', async () => {
    const { dto, fields } = await check({
      preferredCurrency: 'tnd',
      timezone: 'Africa/Tunis',
      chartTheme: 'dark',
      trainingDifficulty: 'beginner',
      notifyMarketDigest: false,
      reduceMotion: true,
    });
    expect(fields).toEqual([]);
    expect(dto.preferredCurrency).toBe('TND');
    expect(dto.notifyMarketDigest).toBe(false);
  });

  it('accepts UTC, the stored default, even though ICU omits it from its zone list', async () => {
    expect((await check({ timezone: 'UTC' })).fields).toEqual([]);
  });

  it.each([
    ['unknown currency', { preferredCurrency: 'XYZ' }, 'preferredCurrency'],
    ['made-up time zone', { timezone: 'Mars/Olympus' }, 'timezone'],
    ['unsupported chart theme', { chartTheme: 'neon' }, 'chartTheme'],
    ['unsupported difficulty', { trainingDifficulty: 'expert-plus' }, 'trainingDifficulty'],
    ['string instead of boolean', { notifyMarketDigest: 'false' }, 'notifyMarketDigest'],
    ['number instead of boolean', { highContrast: 1 }, 'highContrast'],
    ['over-posted field', { role: 'ADMIN' }, 'role'],
  ])('rejects %s', async (_label, body, field) => {
    expect((await check(body)).fields).toContain(field);
  });
});
