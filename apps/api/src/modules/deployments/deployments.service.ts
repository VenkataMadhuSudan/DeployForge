import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { Queue } from 'bullmq';
import { prisma, Deployment } from '@deployforge/database';
import { TriggerDeploymentSchema } from '@deployforge/validation';
import {
  DeploymentStatus,
  TriggerType,
  SafeDeploymentSummary,
  DeploymentJobData,
  canTransition,
} from '@deployforge/shared-types';
import { loadConfig, getRedisConnectionOptions } from '@deployforge/configuration';

@Injectable()
export class DeploymentsService {
  private queue: Queue;

  constructor() {
    const config = loadConfig();
    this.queue = new Queue('deployments', {
      connection: getRedisConnectionOptions(config),
      defaultJobOptions: {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 5000,
        },
        removeOnComplete: 100,
        removeOnFail: 500,
      },
    });
  }

  async triggerDeployment(
    projectId: string,
    requestedById: string | null,
    triggerType: TriggerType,
    body?: unknown
  ): Promise<SafeDeploymentSummary> {
    const parsed = TriggerDeploymentSchema.safeParse(body ?? {});
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.issues.map((i) => i.message).join(', '));
    }

    const project = await prisma.project.findUnique({
      where: { id: projectId },
    });
    if (!project) {
      throw new NotFoundException('Project not found');
    }

    const branch = parsed.data.branch || project.defaultBranch;
    // Default to a deterministic 40-char SHA if not specified
    const commitSha = parsed.data.commitSha || '0000000000000000000000000000000000000000';
    const commitMessage = parsed.data.commitMessage || `Deployment triggered via ${triggerType}`;

    // Transactional outbox pattern: persist deployment & outbox event atomically
    const [deployment, outbox] = await prisma.$transaction(async (tx) => {
      const dep = await tx.deployment.create({
        data: {
          projectId,
          commitSha,
          commitMessage,
          branch,
          status: DeploymentStatus.QUEUED,
          triggerType,
          requestedById,
          provider: project.deploymentProvider,
        },
      });

      const out = await tx.outboxEvent.create({
        data: {
          eventType: 'DEPLOYMENT_CREATED',
          payload: JSON.stringify({ deploymentId: dep.id, projectId }),
        },
      });

      return [dep, out];
    });

    // Enqueue to BullMQ
    const jobData: DeploymentJobData = {
      deploymentId: deployment.id,
      projectId: project.id,
      commitSha: deployment.commitSha,
      branch: deployment.branch,
      triggerType,
      requestedById: requestedById ?? undefined,
      repoUrl: project.repoUrl,
      framework: project.framework as any,
      buildCommand: project.buildCommand,
      installCommand: project.installCommand,
      outputDirectory: project.outputDirectory,
      provider: project.deploymentProvider as any,
      environment: 'PRODUCTION' as any,
    };

    try {
      await this.queue.add('process-deployment', jobData, {
        jobId: deployment.id,
      });

      await prisma.outboxEvent.update({
        where: { id: outbox.id },
        data: { status: 'DISPATCHED', dispatchedAt: new Date() },
      });
    } catch (queueErr) {
      console.warn('Queue enqueue failed, Outbox record will be reconciled:', queueErr);
      // Even if immediate Redis push fails, OutboxEvent remains PENDING in PostgreSQL for reconciliation
    }

    // Record audit log
    if (requestedById) {
      await prisma.auditLog.create({
        data: {
          actorId: requestedById,
          projectId,
          action: 'DEPLOYMENT_TRIGGERED',
          resourceType: 'DEPLOYMENT',
          resourceId: deployment.id,
          metadata: JSON.stringify({ commitSha, branch, triggerType }),
        },
      });
    }

    return this.mapSafeDeployment(deployment);
  }

  async listDeployments(projectId: string, page = 1, limit = 20): Promise<{ items: SafeDeploymentSummary[]; total: number }> {
    const skip = (page - 1) * limit;

    const [items, total] = await Promise.all([
      prisma.deployment.findMany({
        where: { projectId },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      prisma.deployment.count({
        where: { projectId },
      }),
    ]);

    return {
      items: items.map((d) => this.mapSafeDeployment(d)),
      total,
    };
  }

  async getDeployment(projectId: string, deploymentId: string): Promise<SafeDeploymentSummary> {
    const deployment = await prisma.deployment.findFirst({
      where: { id: deploymentId, projectId },
    });

    if (!deployment) {
      throw new NotFoundException('Deployment not found');
    }

    return this.mapSafeDeployment(deployment);
  }

  async cancelDeployment(projectId: string, deploymentId: string, actorId: string): Promise<SafeDeploymentSummary> {
    const deployment = await prisma.deployment.findFirst({
      where: { id: deploymentId, projectId },
    });

    if (!deployment) {
      throw new NotFoundException('Deployment not found');
    }

    if (!canTransition(deployment.status as DeploymentStatus, DeploymentStatus.CANCELLED)) {
      throw new BadRequestException(`Cannot cancel deployment in status ${deployment.status}`);
    }

    const updated = await prisma.deployment.update({
      where: { id: deploymentId },
      data: {
        status: DeploymentStatus.CANCELLED,
        completedAt: new Date(),
      },
    });

    // Try removing or aborting job from BullMQ queue
    try {
      const job = await this.queue.getJob(deploymentId);
      if (job) {
        await job.remove();
      }
    } catch {
      // Ignore if job already consumed
    }

    await prisma.auditLog.create({
      data: {
        actorId,
        projectId,
        action: 'DEPLOYMENT_CANCELLED',
        resourceType: 'DEPLOYMENT',
        resourceId: deploymentId,
      },
    });

    return this.mapSafeDeployment(updated);
  }

  async rollback(projectId: string, previousDeploymentId: string, actorId: string): Promise<SafeDeploymentSummary> {
    const previous = await prisma.deployment.findFirst({
      where: { id: previousDeploymentId, projectId },
    });

    if (!previous) {
      throw new NotFoundException('Target deployment for rollback not found');
    }

    if (previous.status !== DeploymentStatus.SUCCEEDED) {
      throw new BadRequestException('Can only rollback to a previously successful deployment');
    }

    // Rollback creates a NEW deployment referencing the previously successful commit
    return this.triggerDeployment(projectId, actorId, TriggerType.ROLLBACK, {
      branch: previous.branch,
      commitSha: previous.commitSha,
      commitMessage: `Rollback to commit ${previous.commitSha.substring(0, 7)} (ref: ${previous.id})`,
    });
  }

  private mapSafeDeployment(d: Deployment): SafeDeploymentSummary {
    return {
      id: d.id,
      commitSha: d.commitSha,
      commitMessage: d.commitMessage,
      branch: d.branch,
      status: d.status as DeploymentStatus,
      triggerType: d.triggerType as TriggerType,
      deploymentUrl: d.deploymentUrl,
      startedAt: d.startedAt ? d.startedAt.toISOString() : null,
      completedAt: d.completedAt ? d.completedAt.toISOString() : null,
      createdAt: d.createdAt.toISOString(),
    };
  }
}
