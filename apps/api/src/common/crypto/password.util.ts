import * as argon2 from 'argon2';

export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;

/** argon2id: memoryCost 19456 = 19 MiB, timeCost 2, parallelism 1 */
export const ARGON2_OPTIONS: argon2.Options & { raw: false } = {
  type: argon2.argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
  raw: false,
};

/** Precomputed argon2id hash so missing-user login timing matches real users. */
export const DUMMY_PASSWORD_HASH =
  '$argon2id$v=19$m=19456,t=2,p=1$alUobNvgu1tuBMUZNRqvVg$jfNVQH4G1DIHiyJwQp7rk4KxYlNKCV3tUlEcEVQXuXk';

export interface PasswordValidationResult {
  valid: boolean;
  errors: string[];
}

/** 8–128 characters (Unicode code points) with at least one letter, one number and one symbol. */
export function validatePasswordPolicy(password: string): PasswordValidationResult {
  if (typeof password !== 'string') {
    return { valid: false, errors: ['Password must be a string'] };
  }
  const errors: string[] = [];
  const length = [...password].length;
  if (length < PASSWORD_MIN_LENGTH) {
    errors.push(`Password must be at least ${PASSWORD_MIN_LENGTH} characters`);
  }
  if (length > PASSWORD_MAX_LENGTH) {
    errors.push(`Password must be at most ${PASSWORD_MAX_LENGTH} characters`);
  }
  if (!/\p{L}/u.test(password)) errors.push('Password must contain a letter');
  if (!/\p{N}/u.test(password)) errors.push('Password must contain a number');
  if (!/[^\p{L}\p{N}\s]/u.test(password)) errors.push('Password must contain a symbol');
  return { valid: errors.length === 0, errors };
}

export async function hashPassword(password: string): Promise<string> {
  const check = validatePasswordPolicy(password);
  if (!check.valid) {
    throw new Error(check.errors.join('; '));
  }
  return hashSecret(password);
}

/** Argon2id without password-policy checks (recovery codes, internal secrets). */
export async function hashSecret(value: string): Promise<string> {
  return argon2.hash(value, ARGON2_OPTIONS);
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}

/** Always run a verify against a dummy hash when user is missing (timing safety). */
export async function verifyPasswordOrDummy(
  hash: string | null | undefined,
  password: string,
): Promise<boolean> {
  const target = hash && hash.length > 0 ? hash : DUMMY_PASSWORD_HASH;
  return verifyPassword(target, password);
}
