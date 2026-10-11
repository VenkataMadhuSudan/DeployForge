import { Injectable, UnauthorizedException, BadRequestException, Logger } from '@nestjs/common';
import { prisma, WebhookProcessingStatus } from '@deployforge/database';
import { verifyGitHubWebhookSignature } from '@deployforge/validation';
import { loadConfig } from '@deployforge/configuration';
import { DeploymentsService } from '../deployments/deployments.service';
import { TriggerType } from '@deployforge/shared-types';

@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);

  constructor(private readonly deploymentsService: DeploymentsService) {}

  async handleGitHubWebhook(
    headers: Record<string, string | string[] | undefined>,
    rawBody: Buffer | string,
    body: any
  ): Promise<{ status: string; message: string; deploymentId?: string }> {
    const config = loadConfig();
    const signature = headers['x-hub-signature-256'] as string | undefined;
    const deliveryId = headers['x-github-delivery'] as string | undefined;
    const eventType = headers['x-github-event'] as string | undefined;

    if (!deliveryId) {
      throw new BadRequestException('Missing X-GitHub-Delivery header');
    }

    // 1. Verify HMAC SHA-256 signature
    const isValidSignature = verifyGitHubWebhookSignature(rawBody, signature, config.GITHUB_WEBHOOK_SECRET);
    if (!isValidSignature) {
      this.logger.warn(`Invalid GitHub webhook signature on delivery ${deliveryId}`);
      throw new UnauthorizedException('Invalid webhook signature');
    }

    // 2. Webhook Deduplication Check
    const existing = await prisma.webhookEvent.findUnique({
      where: {
        provider_deliveryId: {
          provider: 'GITHUB',
          deliveryId,
        },
      },
    });

    if (existing) {
      return { status: 'already_processed', message: 'Delivery already recorded and handled' };
    }

    // Record webhook delivery
    const webhookRecord = await prisma.webhookEvent.create({
      data: {
        provider: 'GITHUB',
        deliveryId,
        eventType: eventType ?? 'unknown',
        processingStatus: WebhookProcessingStatus.PENDING,
        payload: typeof body === 'string' ? body : JSON.stringify(body),
      },
    });

    // 3. Process push event
    if (eventType !== 'push') {
      await prisma.webhookEvent.update({
        where: { id: webhookRecord.id },
        data: { processingStatus: WebhookProcessingStatus.IGNORED, processedAt: new Date() },
      });
      return { status: 'ignored', message: `Unhandled event type: ${eventType}` };
    }

    const repoOwner = body?.repository?.owner?.login || body?.repository?.owner?.name;
    const repoName = body?.repository?.name;
    const ref = body?.ref as string | undefined; // e.g. "refs/heads/main"

    if (!repoOwner || !repoName || !ref) {
      await prisma.webhookEvent.update({
        where: { id: webhookRecord.id },
        data: { processingStatus: WebhookProcessingStatus.FAILED, processedAt: new Date() },
      });
      return { status: 'ignored', message: 'Malformed repository or ref payload' };
    }

    const branch = ref.replace('refs/heads/', '');
    const commitSha = body?.after || body?.head_commit?.id || '0000000000000000000000000000000000000000';
    const commitMessage = body?.head_commit?.message || 'Automatic deployment from push webhook';

    // 4. Find matching project
    const project = await prisma.project.findFirst({
      where: {
        repoOwner,
        repoName,
      },
    });

    if (!project) {
      await prisma.webhookEvent.update({
        where: { id: webhookRecord.id },
        data: { processingStatus: WebhookProcessingStatus.IGNORED, processedAt: new Date() },
      });
      return { status: 'ignored', message: `No active project configured for ${repoOwner}/${repoName}` };
    }

    // 5. Verify branch matches project defaultBranch
    if (project.defaultBranch !== branch) {
      await prisma.webhookEvent.update({
        where: { id: webhookRecord.id },
        data: { processingStatus: WebhookProcessingStatus.IGNORED, processedAt: new Date() },
      });
      return { status: 'ignored', message: `Push to branch ${branch} ignored (configured: ${project.defaultBranch})` };
    }

    // 6. Enqueue automatic deployment
    const deployment = await this.deploymentsService.triggerDeployment(
      project.id,
      null, // triggered by webhook system
      TriggerType.WEBHOOK,
      {
        branch,
        commitSha,
        commitMessage,
      }
    );

    await prisma.webhookEvent.update({
      where: { id: webhookRecord.id },
      data: { processingStatus: WebhookProcessingStatus.PROCESSED, processedAt: new Date() },
    });

    return {
      status: 'triggered',
      message: `Triggered deployment for ${project.name} at commit ${commitSha}`,
      deploymentId: deployment.id,
    };
  }
}
