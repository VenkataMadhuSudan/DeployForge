import crypto from 'node:crypto';
import { z } from 'zod';
import { ProjectFramework, HostingProviderType, EnvironmentScope } from '@deployforge/shared-types';
import { timingSafeCompare } from '@deployforge/configuration';

export const RegisterSchema = z.object({
  email: z.string().email().toLowerCase().trim(),
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
    .regex(/[a-z]/, 'Password must contain at least one lowercase letter')
    .regex(/[0-9]/, 'Password must contain at least one number'),
  name: z.string().min(2).max(100).optional(),
});

export const LoginSchema = z.object({
  email: z.string().email().toLowerCase().trim(),
  password: z.string().min(1, 'Password is required'),
});

export const CreateProjectSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters').max(64).trim(),
  repoUrl: z.string().url('Must be a valid repository URL'),
  repoOwner: z.string().min(1).trim(),
  repoName: z.string().min(1).trim(),
  defaultBranch: z.string().min(1).default('main'),
  rootDirectory: z.string().max(256).optional().nullable(),
  framework: z.nativeEnum(ProjectFramework).default(ProjectFramework.STATIC),
  buildCommand: z.string().max(256).optional().nullable(),
  installCommand: z.string().max(256).optional().nullable(),
  outputDirectory: z.string().min(1).max(128).default('dist'),
  deploymentProvider: z.nativeEnum(HostingProviderType).default(HostingProviderType.LOCAL_TESTING),
});

export const UpdateProjectSchema = CreateProjectSchema.partial();

export const TriggerDeploymentSchema = z.object({
  branch: z.string().min(1).default('main'),
  commitSha: z.string().regex(/^[0-9a-fA-F]{40}$/, 'Must be a 40-character commit SHA').optional(),
  commitMessage: z.string().max(256).optional(),
});

export const SetEnvironmentVariableSchema = z.object({
  key: z
    .string()
    .regex(/^[A-Z_][A-Z0-9_]*$/, 'Key must be UPPERCASE letters, numbers, and underscores, starting with letter or underscore')
    .min(2)
    .max(128),
  value: z.string().min(0).max(8192),
  environment: z.nativeEnum(EnvironmentScope).default(EnvironmentScope.ALL),
  isSecret: z.boolean().default(true),
});

/**
 * Verify GitHub webhook HMAC SHA-256 signature
 * Header format: sha256=<hex_digest>
 */
export function verifyGitHubWebhookSignature(
  rawBody: Buffer | string,
  signatureHeader?: string,
  secret?: string
): boolean {
  if (!signatureHeader || !secret) {
    return false;
  }
  const prefix = 'sha256=';
  if (!signatureHeader.startsWith(prefix)) {
    return false;
  }
  const signatureHex = signatureHeader.substring(prefix.length);

  const bodyBuffer = typeof rawBody === 'string' ? Buffer.from(rawBody, 'utf8') : rawBody;
  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(bodyBuffer);
  const calculatedHex = hmac.digest('hex');

  return timingSafeCompare(signatureHex, calculatedHex);
}
