import crypto from 'node:crypto';
import { RegisterSchema, CreateProjectSchema, verifyGitHubWebhookSignature } from '../src';
import { ProjectFramework, HostingProviderType } from '@deployforge/shared-types';

describe('Validation Schemas & Webhook Signature Verification', () => {
  it('should validate strong password requirements on registration', () => {
    // Valid password
    const valid = RegisterSchema.safeParse({
      email: 'Test@Example.Com',
      password: 'SecurePassword123!',
      name: 'Developer',
    });
    expect(valid.success).toBe(true);
    if (valid.success) {
      expect(valid.data.email).toBe('test@example.com'); // normalized lowercase
    }

    // Invalid weak passwords
    expect(RegisterSchema.safeParse({ email: 'test@example.com', password: 'short' }).success).toBe(false);
    expect(RegisterSchema.safeParse({ email: 'test@example.com', password: 'nouppercase123' }).success).toBe(false);
    expect(RegisterSchema.safeParse({ email: 'test@example.com', password: 'NOLOWERCASE123' }).success).toBe(false);
  });

  it('should validate project creation input correctly', () => {
    const valid = CreateProjectSchema.safeParse({
      name: 'DeployForge Site',
      repoUrl: 'https://github.com/org/repo',
      repoOwner: 'org',
      repoName: 'repo',
      defaultBranch: 'main',
      framework: ProjectFramework.STATIC,
      outputDirectory: 'dist',
      deploymentProvider: HostingProviderType.LOCAL_TESTING,
    });
    expect(valid.success).toBe(true);

    const invalid = CreateProjectSchema.safeParse({
      name: 'Site',
      repoUrl: 'not-a-url',
    });
    expect(invalid.success).toBe(false);
  });

  describe('verifyGitHubWebhookSignature', () => {
    const secret = 'my_super_secret_webhook_key_456';
    const payload = JSON.stringify({ ref: 'refs/heads/main', repository: { name: 'site' } });

    it('should accept valid HMAC SHA-256 signature', () => {
      const hmac = crypto.createHmac('sha256', secret);
      hmac.update(Buffer.from(payload));
      const validHeader = `sha256=${hmac.digest('hex')}`;

      expect(verifyGitHubWebhookSignature(payload, validHeader, secret)).toBe(true);
    });

    it('should reject tampered payload or altered signature', () => {
      const hmac = crypto.createHmac('sha256', secret);
      hmac.update(Buffer.from(payload));
      const validHeader = `sha256=${hmac.digest('hex')}`;

      const tamperedPayload = JSON.stringify({ ref: 'refs/heads/main', repository: { name: 'tampered' } });
      expect(verifyGitHubWebhookSignature(tamperedPayload, validHeader, secret)).toBe(false);
    });

    it('should reject incorrect webhook secret', () => {
      const hmac = crypto.createHmac('sha256', 'wrong_secret');
      hmac.update(Buffer.from(payload));
      const wrongHeader = `sha256=${hmac.digest('hex')}`;

      expect(verifyGitHubWebhookSignature(payload, wrongHeader, secret)).toBe(false);
    });

    it('should reject missing or malformed header prefix', () => {
      expect(verifyGitHubWebhookSignature(payload, 'sha1=abc', secret)).toBe(false);
      expect(verifyGitHubWebhookSignature(payload, undefined, secret)).toBe(false);
    });
  });
});
