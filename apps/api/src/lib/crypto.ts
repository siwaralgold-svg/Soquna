import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

export function hmac(key: Buffer, value: string): Buffer {
  return createHmac('sha256', key).update(value, 'utf8').digest();
}

export function sha256(value: string | Buffer): Buffer {
  return createHash('sha256').update(value).digest();
}

export function safeEqual(a: Buffer, b: Buffer): boolean {
  return a.length === b.length && timingSafeEqual(a, b);
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

const IV_BYTES = 12;
const TAG_BYTES = 16;

/**
 * Field-level encryption with AES-256-GCM.
 * Layout: [key version: 1 byte][iv: 12][auth tag: 16][ciphertext]. The version byte lets us
 * add FIELD_ENCRYPTION_KEY_V2 later and re-encrypt gradually.
 */
export class FieldCipher {
  private readonly keys: Map<number, Buffer>;
  private readonly currentVersion: number;

  constructor(keys: Record<number, Buffer>) {
    this.keys = new Map(Object.entries(keys).map(([v, k]) => [Number(v), k]));
    if (this.keys.size === 0) throw new Error('FieldCipher needs at least one key');
    for (const [version, key] of this.keys) {
      if (key.length !== 32) throw new Error(`Encryption key v${version} must be 32 bytes`);
    }
    this.currentVersion = Math.max(...this.keys.keys());
  }

  encrypt(plaintext: string): Buffer {
    const key = this.keys.get(this.currentVersion)!;
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    return Buffer.concat([Buffer.from([this.currentVersion]), iv, cipher.getAuthTag(), ciphertext]);
  }

  decrypt(payload: Buffer): string {
    const version = payload[0]!;
    const key = this.keys.get(version);
    if (!key) throw new Error(`Unknown encryption key version ${version}`);
    const iv = payload.subarray(1, 1 + IV_BYTES);
    const tag = payload.subarray(1 + IV_BYTES, 1 + IV_BYTES + TAG_BYTES);
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([
      decipher.update(payload.subarray(1 + IV_BYTES + TAG_BYTES)),
      decipher.final(),
    ]).toString('utf8');
  }
}
