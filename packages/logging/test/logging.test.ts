import { SecretRedactor, sanitizeLogContent } from '../src';

describe('Logging & Secret Redaction', () => {
  it('should redact sensitive values from log messages', () => {
    const redactor = new SecretRedactor();
    redactor.addSecret('ghp_superSecretToken123456');
    redactor.addSecret('postgres://user:p4ssw0rd@host:5432');

    const log1 = 'Authentication with GitHub using ghp_superSecretToken123456 succeeded';
    const redacted1 = redactor.redact(log1);
    expect(redacted1).toBe('Authentication with GitHub using [REDACTED_SECRET] succeeded');

    const log2 = 'Connecting to DATABASE_URL: postgres://user:p4ssw0rd@host:5432';
    const redacted2 = redactor.redact(log2);
    expect(redacted2).toBe('Connecting to DATABASE_URL: [REDACTED_SECRET]');
  });

  it('should sanitize ANSI terminal escape codes and ASCII control characters', () => {
    const coloredLog = '\x1b[31m[ERROR]\x1b[0m Build failed with status 1\x07';
    const sanitized = sanitizeLogContent(coloredLog);

    expect(sanitized).toBe('[ERROR] Build failed with status 1');
    expect(sanitized).not.toContain('\x1b');
    expect(sanitized).not.toContain('\x07');
  });
});
