import { describe, expect, it } from 'vitest';

import { PasswordService } from './password.service';

describe('PasswordService', () => {
  const passwords = new PasswordService();

  it('hashes with argon2id and verifies the roundtrip', async () => {
    const hash = await passwords.hash('correct horse battery staple');

    expect(hash.startsWith('$argon2id$')).toBe(true);
    await expect(passwords.verify(hash, 'correct horse battery staple')).resolves.toBe(true);
    await expect(passwords.verify(hash, 'wrong password')).resolves.toBe(false);
  });

  it('treats malformed hashes as a failed verification instead of throwing', async () => {
    await expect(passwords.verify('not-a-hash', 'x')).resolves.toBe(false);
  });
});
