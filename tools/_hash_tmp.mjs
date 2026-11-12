
import { hashPassword } from './tools/db-harness/crypto/password.mjs';
const hash = await hashPassword('Demo1234!');
console.log(hash);
