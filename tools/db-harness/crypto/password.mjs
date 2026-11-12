import argon2 from 'argon2';

/** Matches apps/api (legacy Nest) and Spring Boot argon2id parameters. */
export const ARGON2_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
  raw: false,
};

export const DUMMY_PASSWORD_HASH =
  '$argon2id$v=19$m=19456,t=2,p=1$alUobNvgu1tuBMUZNRqvVg$jfNVQH4G1DIHiyJwQp7rk4KxYlNKCV3tUlEcEVQXuXk';

export async function hashSecret(value) {
  return argon2.hash(value, ARGON2_OPTIONS);
}

export async function hashPassword(password) {
  if (typeof password !== 'string' || [...password].length < 8) {
    throw new Error('Password must be at least 8 characters');
  }
  return hashSecret(password);
}

export async function verifyPassword(hash, password) {
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}
