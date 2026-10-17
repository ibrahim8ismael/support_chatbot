import { hash, verify } from '@node-rs/argon2';
import { Injectable } from '@nestjs/common';

/**
 * argon2id hashing (`@node-rs/argon2` defaults: m=19456 KiB, t=2, p=1).
 * Password length policy is enforced at the edge (`newPasswordSchema`).
 */
@Injectable()
export class PasswordService {
  hash(password: string): Promise<string> {
    return hash(password);
  }

  /** Never throws: malformed hashes verify as `false`. */
  async verify(hashed: string, password: string): Promise<boolean> {
    try {
      return await verify(hashed, password);
    } catch {
      return false;
    }
  }
}
