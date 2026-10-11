import { encryptSecret, decryptSecret, timingSafeCompare } from '../src';

describe('Cryptographic Controls & AES-256-GCM', () => {
  const validKey = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
  const altKey = 'fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210';

  it('should encrypt and decrypt secrets successfully', () => {
    const secret = 'postgres://user:super_secret_password@db.prod:5432/main';
    const encrypted = encryptSecret(secret, validKey);

    expect(encrypted).not.toEqual(secret);
    expect(encrypted.split(':')).toHaveLength(3);

    const decrypted = decryptSecret(encrypted, validKey);
    expect(decrypted).toEqual(secret);
  });

  it('should fail decryption if auth tag or ciphertext is tampered with', () => {
    const secret = 'production-api-token-value';
    const encrypted = encryptSecret(secret, validKey);
    const parts = encrypted.split(':');

    // Tamper with ciphertext
    const tamperedCipher = parts[2].substring(0, parts[2].length - 2) + 'aa';
    const tamperedPayload = `${parts[0]}:${parts[1]}:${tamperedCipher}`;

    expect(() => decryptSecret(tamperedPayload, validKey)).toThrow();
  });

  it('should fail decryption if an incorrect encryption key is provided', () => {
    const secret = 'confidential-data';
    const encrypted = encryptSecret(secret, validKey);

    expect(() => decryptSecret(encrypted, altKey)).toThrow();
  });

  it('should perform constant-time comparison correctly', () => {
    expect(timingSafeCompare('secret-token', 'secret-token')).toBe(true);
    expect(timingSafeCompare('secret-token', 'wrong-token')).toBe(false);
    expect(timingSafeCompare('short', 'much-longer-string')).toBe(false);
  });
});
