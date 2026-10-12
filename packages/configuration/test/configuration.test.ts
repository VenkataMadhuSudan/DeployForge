/**
 * Unit tests for @deployforge/configuration
 * Tests: environment schema validation, AES-256-GCM encrypt/decrypt,
 *        timing-safe compare, getRedisConnectionOptions.
 */
import {
  loadConfig,
  encryptSecret,
  decryptSecret,
  timingSafeCompare,
  getRedisConnectionOptions,
} from '../src/index';

// ─── helpers ────────────────────────────────────────────────────────────────
const VALID_KEY = 'a'.repeat(64); // 64 hex chars

const makeEnv = (overrides: Record<string, string> = {}) => ({
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
  JWT_SECRET: 'super-secret-jwt-key-for-testing',
  ENCRYPTION_KEY: VALID_KEY,
  ...overrides,
});

// ─── Configuration loading ───────────────────────────────────────────────────
describe('loadConfig()', () => {
  it('returns defaults when all required vars are set', () => {
    const cfg = loadConfig(makeEnv() as any);
    expect(cfg.NODE_ENV).toBe('test');
    expect(cfg.PORT).toBe(4000);
    expect(cfg.REDIS_PORT).toBe(6379);
    expect(cfg.REDIS_TLS).toBe(false);
    expect(cfg.JWT_EXPIRES_IN).toBe('7d');
  });

  it('coerces PORT string to number', () => {
    const cfg = loadConfig(makeEnv({ PORT: '5000' }) as any);
    expect(cfg.PORT).toBe(5000);
  });

  it('parses REDIS_TLS=true correctly', () => {
    const cfg = loadConfig(makeEnv({ REDIS_TLS: 'true' }) as any);
    expect(cfg.REDIS_TLS).toBe(true);
  });

  it('parses REDIS_TLS=1 correctly', () => {
    const cfg = loadConfig(makeEnv({ REDIS_TLS: '1' }) as any);
    expect(cfg.REDIS_TLS).toBe(true);
  });

  it('throws when DATABASE_URL is missing', () => {
    const env = makeEnv();
    delete (env as any).DATABASE_URL;
    expect(() => loadConfig(env as any)).toThrow('Configuration validation failed');
  });

  it('throws when JWT_SECRET is too short', () => {
    expect(() =>
      loadConfig(makeEnv({ JWT_SECRET: 'short' }) as any)
    ).toThrow('Configuration validation failed');
  });

  it('throws when ENCRYPTION_KEY is not 64 hex chars', () => {
    expect(() =>
      loadConfig(makeEnv({ ENCRYPTION_KEY: 'not-hex-64' }) as any)
    ).toThrow('Configuration validation failed');
  });

  it('accepts valid HOSTING_PROVIDER enum values', () => {
    const cfg1 = loadConfig(makeEnv({ HOSTING_PROVIDER: 'LOCAL_TESTING' }) as any);
    expect(cfg1.HOSTING_PROVIDER).toBe('LOCAL_TESTING');
    const cfg2 = loadConfig(makeEnv({ HOSTING_PROVIDER: 'CLOUDFLARE_PAGES' }) as any);
    expect(cfg2.HOSTING_PROVIDER).toBe('CLOUDFLARE_PAGES');
  });
});

// ─── encryptSecret / decryptSecret ──────────────────────────────────────────
describe('encryptSecret()', () => {
  it('encrypts a string and returns 3 colon-separated hex segments', () => {
    const cipher = encryptSecret('hello-world', VALID_KEY);
    const parts = cipher.split(':');
    expect(parts).toHaveLength(3);
    expect(parts[0]).toMatch(/^[0-9a-f]{24}$/);   // 12-byte IV → 24 hex
    expect(parts[1]).toMatch(/^[0-9a-f]{32}$/);   // 16-byte tag → 32 hex
    expect(parts[2].length).toBeGreaterThan(0);
  });

  it('produces different ciphertexts for same plaintext (random IV)', () => {
    const c1 = encryptSecret('secret', VALID_KEY);
    const c2 = encryptSecret('secret', VALID_KEY);
    expect(c1).not.toBe(c2);
  });

  it('throws on a non-hex key', () => {
    expect(() => encryptSecret('msg', 'not-a-hex-key')).toThrow();
  });
});

describe('decryptSecret()', () => {
  it('round-trips plaintext correctly', () => {
    const plain = 'my-api-key-123!@#';
    const cipher = encryptSecret(plain, VALID_KEY);
    expect(decryptSecret(cipher, VALID_KEY)).toBe(plain);
  });

  it('round-trips unicode content', () => {
    const plain = 'héllo wörld 🔐';
    expect(decryptSecret(encryptSecret(plain, VALID_KEY), VALID_KEY)).toBe(plain);
  });

  it('throws on malformed payload (missing colons)', () => {
    expect(() => decryptSecret('badpayload', VALID_KEY)).toThrow('Malformed encrypted payload');
  });

  it('throws on tampered ciphertext (authentication tag mismatch)', () => {
    const cipher = encryptSecret('secret', VALID_KEY);
    const [iv, tag, ct] = cipher.split(':');
    const tampered = [iv, tag, 'ff' + ct.slice(2)].join(':');
    expect(() => decryptSecret(tampered, VALID_KEY)).toThrow();
  });

  it('throws when decrypted with a different key', () => {
    const key2 = 'b'.repeat(64);
    const cipher = encryptSecret('secret', VALID_KEY);
    expect(() => decryptSecret(cipher, key2)).toThrow();
  });
});

// ─── timingSafeCompare ───────────────────────────────────────────────────────
describe('timingSafeCompare()', () => {
  it('returns true for identical strings', () => {
    expect(timingSafeCompare('abc', 'abc')).toBe(true);
  });

  it('returns false for different strings of same length', () => {
    expect(timingSafeCompare('abc', 'abd')).toBe(false);
  });

  it('returns false for strings of different length (no exception)', () => {
    expect(timingSafeCompare('short', 'a-much-longer-string')).toBe(false);
  });

  it('handles empty strings', () => {
    expect(timingSafeCompare('', '')).toBe(true);
    expect(timingSafeCompare('', 'a')).toBe(false);
  });
});

// ─── getRedisConnectionOptions ───────────────────────────────────────────────
describe('getRedisConnectionOptions()', () => {
  it('returns plain connection without TLS when REDIS_TLS=false', () => {
    const cfg = loadConfig(makeEnv({ REDIS_HOST: 'localhost', REDIS_PORT: '6379' }) as any);
    const opts = getRedisConnectionOptions(cfg);
    expect(opts.host).toBe('localhost');
    expect(opts.port).toBe(6379);
    expect(opts.tls).toBeUndefined();
    expect(opts.maxRetriesPerRequest).toBeNull();
    expect(opts.enableReadyCheck).toBe(false);
  });

  it('includes tls object when REDIS_TLS=true', () => {
    const cfg = loadConfig(makeEnv({ REDIS_TLS: 'true', REDIS_HOST: 'upstash.io' }) as any);
    const opts = getRedisConnectionOptions(cfg);
    expect(opts.tls).toBeDefined();
    expect(opts.tls!.rejectUnauthorized).toBe(false);
    expect(opts.host).toBe('upstash.io');
  });

  it('omits password when REDIS_PASSWORD is empty', () => {
    const cfg = loadConfig(makeEnv({ REDIS_PASSWORD: '' }) as any);
    const opts = getRedisConnectionOptions(cfg);
    expect(opts.password).toBeUndefined();
  });

  it('includes password when REDIS_PASSWORD is set', () => {
    const cfg = loadConfig(makeEnv({ REDIS_PASSWORD: 'secret123' }) as any);
    const opts = getRedisConnectionOptions(cfg);
    expect(opts.password).toBe('secret123');
  });
});
