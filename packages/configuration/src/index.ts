import crypto from 'node:crypto';
import { z } from 'zod';
import dotenv from 'dotenv';

// Load .env into process.env if present
dotenv.config();

export const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(4000),
  API_PREFIX: z.string().default('api/v1'),
  PUBLIC_APP_URL: z.string().url().default('http://localhost:3000'),
  PUBLIC_API_URL: z.string().url().default('http://localhost:4000'),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),

  REDIS_HOST: z.string().default('localhost'),
  REDIS_PORT: z.coerce.number().default(6379),
  REDIS_PASSWORD: z.string().optional().default(''),

  JWT_SECRET: z.string().min(16, 'JWT_SECRET must be at least 16 characters'),
  JWT_EXPIRES_IN: z.string().default('7d'),
  SESSION_SECRET: z.string().min(16, 'SESSION_SECRET must be at least 16 characters').default('session-secret-at-least-16-chars-long'),

  // 64-hex char string representing 32 bytes for AES-256-GCM
  ENCRYPTION_KEY: z.string().regex(/^[0-9a-fA-F]{64}$/, 'ENCRYPTION_KEY must be a 64-character hex string (32 bytes)'),

  GITHUB_APP_ID: z.string().optional(),
  GITHUB_APP_SLUG: z.string().default('deployforge'),
  GITHUB_CLIENT_ID: z.string().optional(),
  GITHUB_CLIENT_SECRET: z.string().optional(),
  GITHUB_WEBHOOK_SECRET: z.string().optional().default('development_webhook_secret_12345'),
  GITHUB_PRIVATE_KEY: z.string().optional(),

  HOSTING_PROVIDER: z.enum(['LOCAL_TESTING', 'CLOUDFLARE_PAGES', 'AWS_S3']).default('LOCAL_TESTING'),
  CLOUDFLARE_ACCOUNT_ID: z.string().optional(),
  CLOUDFLARE_API_TOKEN: z.string().optional(),

  BUILD_TIMEOUT_SECONDS: z.coerce.number().default(600),
  BUILD_MEMORY_LIMIT_MB: z.coerce.number().default(1024),
  BUILD_CPU_LIMIT: z.coerce.number().default(1.0),
  BUILD_MAX_PROCESSES: z.coerce.number().default(100),
  BUILD_WORKSPACE_DIR: z.string().default('./storage/workspaces'),
  ARTIFACT_STORAGE_DIR: z.string().default('./storage/artifacts'),
  LOCAL_DEPLOYMENT_PORT: z.coerce.number().default(8080),

  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
});

export type AppConfig = z.infer<typeof EnvSchema>;

let cachedConfig: AppConfig | null = null;

export function loadConfig(override?: Partial<AppConfig>): AppConfig {
  if (cachedConfig && !override) {
    return cachedConfig;
  }
  const parsed = EnvSchema.safeParse({ ...process.env, ...override });
  if (!parsed.success) {
    const errorMessages = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(', ');
    throw new Error(`Configuration validation failed: ${errorMessages}`);
  }
  cachedConfig = parsed.data;
  return cachedConfig;
}

/**
 * Encrypt a plaintext secret string using AES-256-GCM
 * Output format: [12-byte IV in hex]:[16-byte AuthTag in hex]:[Ciphertext in hex]
 */
export function encryptSecret(plaintext: string, keyHex: string): string {
  if (!/^[0-9a-fA-F]{64}$/.test(keyHex)) {
    throw new Error('Encryption key must be a 64-char hexadecimal string (32 bytes)');
  }
  const key = Buffer.from(keyHex, 'hex');
  const iv = crypto.randomBytes(12); // Standard 96-bit IV for GCM
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);

  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
}

/**
 * Decrypt an AES-256-GCM encrypted string (format: iv:authTag:ciphertext)
 */
export function decryptSecret(payload: string, keyHex: string): string {
  if (!/^[0-9a-fA-F]{64}$/.test(keyHex)) {
    throw new Error('Encryption key must be a 64-char hexadecimal string (32 bytes)');
  }
  const parts = payload.split(':');
  if (parts.length !== 3) {
    throw new Error('Malformed encrypted payload format. Expected iv:authTag:ciphertext');
  }
  const [ivHex, authTagHex, encryptedHex] = parts;
  const key = Buffer.from(keyHex, 'hex');
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([decipher.update(Buffer.from(encryptedHex, 'hex')), decipher.final()]);
  return decrypted.toString('utf8');
}

/**
 * Constant-time string comparison to prevent timing attacks
 */
export function timingSafeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) {
    // Constant time dummy comparison
    crypto.timingSafeEqual(bufA, bufA);
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}
