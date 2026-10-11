import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { prisma } from '@deployforge/database';
import { SetEnvironmentVariableSchema } from '@deployforge/validation';
import { encryptSecret, decryptSecret, loadConfig } from '@deployforge/configuration';
import { SafeEnvironmentVariable, EnvironmentScope } from '@deployforge/shared-types';

@Injectable()
export class EnvVarsService {
  async setVariable(projectId: string, actorId: string, body: unknown): Promise<SafeEnvironmentVariable> {
    const parsed = SetEnvironmentVariableSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(', '));
    }

    const { key, value, environment, isSecret } = parsed.data;
    const config = loadConfig();

    // Encrypt the value before storage
    const encryptedValue = encryptSecret(value, config.ENCRYPTION_KEY);

    const envVar = await prisma.environmentVariable.upsert({
      where: {
        projectId_environment_key: {
          projectId,
          environment: environment as any,
          key,
        },
      },
      update: {
        encryptedValue,
        isSecret,
      },
      create: {
        projectId,
        environment: environment as any,
        key,
        encryptedValue,
        isSecret,
      },
    });

    // Record audit log without sensitive value
    await prisma.auditLog.create({
      data: {
        actorId,
        projectId,
        action: 'ENV_VAR_SET',
        resourceType: 'ENV_VAR',
        resourceId: envVar.id,
        metadata: JSON.stringify({ key, environment, isSecret }),
      },
    });

    return {
      id: envVar.id,
      projectId: envVar.projectId,
      environment: envVar.environment as EnvironmentScope,
      key: envVar.key,
      isSecret: envVar.isSecret,
      maskedValue: envVar.isSecret ? '••••••••' : value,
      createdAt: envVar.createdAt.toISOString(),
      updatedAt: envVar.updatedAt.toISOString(),
    };
  }

  async listVariables(projectId: string): Promise<SafeEnvironmentVariable[]> {
    const vars = await prisma.environmentVariable.findMany({
      where: { projectId },
      orderBy: { key: 'asc' },
    });

    const config = loadConfig();

    return vars.map((v) => {
      let displayValue = '••••••••';
      if (!v.isSecret) {
        try {
          displayValue = decryptSecret(v.encryptedValue, config.ENCRYPTION_KEY);
        } catch {
          displayValue = '[decryption_error]';
        }
      }
      return {
        id: v.id,
        projectId: v.projectId,
        environment: v.environment as EnvironmentScope,
        key: v.key,
        isSecret: v.isSecret,
        maskedValue: displayValue,
        createdAt: v.createdAt.toISOString(),
        updatedAt: v.updatedAt.toISOString(),
      };
    });
  }

  async deleteVariable(projectId: string, varId: string, actorId: string): Promise<{ success: boolean }> {
    const existing = await prisma.environmentVariable.findFirst({
      where: { id: varId, projectId },
    });

    if (!existing) {
      throw new NotFoundException('Environment variable not found');
    }

    await prisma.environmentVariable.delete({
      where: { id: varId },
    });

    await prisma.auditLog.create({
      data: {
        actorId,
        projectId,
        action: 'ENV_VAR_DELETED',
        resourceType: 'ENV_VAR',
        resourceId: varId,
        metadata: JSON.stringify({ key: existing.key }),
      },
    });

    return { success: true };
  }
}
