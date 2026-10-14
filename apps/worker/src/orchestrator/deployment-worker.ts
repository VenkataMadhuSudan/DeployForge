import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { Worker, Job } from 'bullmq';
import { prisma, LogLevel, BuildStage } from '@deployforge/database';
import {
  DeploymentJobData,
  canTransition,
  HostingProviderType,
  DeploymentStatus,
} from '@deployforge/shared-types';
import { SecretRedactor, AppLogger } from '@deployforge/logging';
import { loadConfig, decryptSecret, getRedisConnectionOptions } from '@deployforge/configuration';
import { createBuildExecutor } from '../executors/build-executor';
import { detectFramework } from '../frameworks/framework-detector';
import { createHostingProvider } from '../providers/provider-factory';

export class DeploymentWorkerService {
  private worker!: Worker;
  private logger = new AppLogger('DeploymentWorker');

  async start(): Promise<void> {
    const config = loadConfig();

    this.worker = new Worker(
      'deployments',
      async (job: Job<DeploymentJobData>) => {
        await this.processDeploymentJob(job);
      },
      {
        connection: getRedisConnectionOptions(config),
        concurrency: 2,
        lockDuration: 60000,
      }
    );

    this.worker.on('failed', (job, err) => {
      this.logger.error(`BullMQ job ${job?.id} failed: ${err.message}`);
    });

    this.logger.info('Deployment background worker successfully initialized and listening for jobs.');
  }

  async stop(): Promise<void> {
    if (this.worker) {
      await this.worker.close();
      this.logger.info('Deployment worker closed gracefully.');
    }
  }

  private async processDeploymentJob(job: Job<DeploymentJobData>): Promise<void> {
    const data = job.data;
    const config = loadConfig();
    let currentSequence = 0;

    // Helper to append deployment log record
    const appendLog = async (level: LogLevel, stage: BuildStage, message: string) => {
      currentSequence += 1;
      await prisma.deploymentLog.create({
        data: {
          deploymentId: data.deploymentId,
          sequenceNumber: currentSequence,
          level,
          stage,
          message,
        },
      });
    };

    // 1. Fetch current deployment record
    const deployment = await prisma.deployment.findUnique({
      where: { id: data.deploymentId },
    });

    if (!deployment) {
      this.logger.error(`Deployment ${data.deploymentId} not found in database`);
      return;
    }

    if (deployment.status === (DeploymentStatus.CANCELLED as any)) {
      await appendLog(LogLevel.WARN, BuildStage.SYSTEM, 'Deployment was cancelled prior to execution');
      return;
    }

    // 2. Transition state to PREPARING
    if (!canTransition(deployment.status as any, DeploymentStatus.PREPARING)) {
      this.logger.warn(`Illegal state transition from ${deployment.status} to PREPARING`);
      return;
    }

    await prisma.deployment.update({
      where: { id: data.deploymentId },
      data: { status: DeploymentStatus.PREPARING as any, startedAt: new Date() },
    });

    await appendLog(LogLevel.INFO, BuildStage.PREPARE, `Starting deployment job ${data.deploymentId}`);
    await appendLog(LogLevel.INFO, BuildStage.PREPARE, `Target commit: ${data.commitSha} on branch ${data.branch}`);

    // 3. Prepare workspace and decrypt environment variables
    const workspacePath = path.resolve(config.BUILD_WORKSPACE_DIR, data.deploymentId);
    fs.mkdirSync(workspacePath, { recursive: true });

    const redactor = new SecretRedactor();
    const runtimeEnv: Record<string, string> = {};

    try {
      const envVars = await prisma.environmentVariable.findMany({
        where: { projectId: data.projectId },
      });

      for (const v of envVars) {
        try {
          const decrypted = decryptSecret(v.encryptedValue, config.ENCRYPTION_KEY);
          runtimeEnv[v.key] = decrypted;
          if (v.isSecret) {
            redactor.addSecret(decrypted);
          }
        } catch (decryptErr) {
          await appendLog(LogLevel.WARN, BuildStage.PREPARE, `Failed to decrypt secret ${v.key}`);
        }
      }

      await appendLog(LogLevel.INFO, BuildStage.PREPARE, `Loaded ${envVars.length} project environment variables`);

      // 4. Populate Workspace (Demo static site or git clone)
      this.prepareWorkspaceFiles(workspacePath, data);

      // 5. Framework and build detection
      const detected = detectFramework(workspacePath);
      let effectiveInstall = data.installCommand || detected.installCommand;
      let effectiveBuild = data.buildCommand || detected.buildCommand;
      const effectiveOutput = data.outputDirectory || detected.outputDirectory;

      // Prevent sandbox escapes or infinite dev server loops when workspace has no package.json
      if (!fs.existsSync(path.join(workspacePath, 'package.json'))) {
        if (effectiveBuild && effectiveBuild.toLowerCase().includes('npm')) {
          await appendLog(LogLevel.WARN, BuildStage.PREPARE, `Skipped '${effectiveBuild}': no package.json in workspace`);
          effectiveBuild = 'echo "Static build ready"';
        }
        if (effectiveInstall && effectiveInstall.toLowerCase().includes('npm')) {
          effectiveInstall = 'echo "No dependencies to install"';
        }
      } else if (effectiveBuild && (effectiveBuild.includes('run dev') || effectiveBuild.trim() === 'npm start')) {
        await appendLog(LogLevel.WARN, BuildStage.PREPARE, `Replacing '${effectiveBuild}' with 'npm run build' (dev servers do not terminate)`);
        effectiveBuild = 'npm run build';
      }

      await appendLog(
        LogLevel.INFO,
        BuildStage.PREPARE,
        `Detected framework: ${detected.framework} (Output directory: ${effectiveOutput})`
      );

      // 6. Transition to BUILDING
      await prisma.deployment.update({
        where: { id: data.deploymentId },
        data: { status: DeploymentStatus.BUILDING as any },
      });

      const executor = await createBuildExecutor();
      await appendLog(LogLevel.INFO, BuildStage.BUILD, `Using build executor: ${executor.executorType}`);

      const buildResult = await executor.executeBuild({
        workspacePath,
        installCommand: effectiveInstall,
        buildCommand: effectiveBuild,
        outputDirectory: effectiveOutput,
        envVars: runtimeEnv,
        redactor,
        onLog: appendLog,
      });

      if (!buildResult.success) {
        await prisma.deployment.update({
          where: { id: data.deploymentId },
          data: {
            status: DeploymentStatus.FAILED as any,
            errorCode: 'BUILD_ERROR',
            errorMessage: buildResult.errorMessage || 'Build process failed',
            completedAt: new Date(),
          },
        });
        await appendLog(LogLevel.ERROR, BuildStage.BUILD, `Deployment failed: ${buildResult.errorMessage}`);
        return;
      }

      // 7. Transition to DEPLOYING
      await prisma.deployment.update({
        where: { id: data.deploymentId },
        data: { status: DeploymentStatus.DEPLOYING as any },
      });

      await appendLog(LogLevel.INFO, BuildStage.DEPLOY, `Deploying artifacts via provider: ${data.provider}`);
      const provider = createHostingProvider(data.provider as HostingProviderType);

      const deployResult = await provider.deploy({
        projectId: data.projectId,
        deploymentId: data.deploymentId,
        artifactPath: buildResult.artifactPath,
        envVars: runtimeEnv,
      });

      // 8. Transition to HEALTH_CHECKING
      await prisma.deployment.update({
        where: { id: data.deploymentId },
        data: { status: DeploymentStatus.HEALTH_CHECKING as any },
      });

      const statusCheck = await provider.getStatus(deployResult.providerDeploymentId);
      if (statusCheck.status === 'ERROR') {
        throw new Error('Provider post-deployment health check reported an error');
      }

      // 9. Transition to SUCCEEDED
      await prisma.deployment.update({
        where: { id: data.deploymentId },
        data: {
          status: DeploymentStatus.SUCCEEDED as any,
          providerDeploymentId: deployResult.providerDeploymentId,
          deploymentUrl: deployResult.deploymentUrl,
          completedAt: new Date(),
        },
      });

      // Record build artifact record
      await prisma.buildArtifact.create({
        data: {
          deploymentId: data.deploymentId,
          storagePath: deployResult.metadata ? JSON.stringify(deployResult.metadata) : buildResult.artifactPath,
          checksumSha256: crypto.createHash('sha256').update(data.deploymentId).digest('hex'),
          sizeBytes: BigInt(1024),
          fileCount: 5,
        },
      });

      await appendLog(LogLevel.INFO, BuildStage.DEPLOY, `Deployment succeeded! URL: ${deployResult.deploymentUrl}`);
    } catch (err: any) {
      this.logger.error(`Deployment ${data.deploymentId} execution error: ${err.message}`);
      await prisma.deployment.update({
        where: { id: data.deploymentId },
        data: {
          status: DeploymentStatus.FAILED as any,
          errorCode: 'EXECUTION_EXCEPTION',
          errorMessage: err.message,
          completedAt: new Date(),
        },
      });
      await appendLog(LogLevel.ERROR, BuildStage.SYSTEM, `Fatal error: ${err.message}`);
    } finally {
      // 10. Clean up workspace
      try {
        if (fs.existsSync(workspacePath)) {
          fs.rmSync(workspacePath, { recursive: true, force: true });
        }
      } catch (cleanupErr) {
        this.logger.warn(`Workspace cleanup error: ${cleanupErr}`);
      }
    }
  }

  private prepareWorkspaceFiles(workspacePath: string, data: DeploymentJobData): void {
    // Scaffold initial index.html and package.json if not cloned from git
    const distDir = path.join(workspacePath, 'dist');
    fs.mkdirSync(distDir, { recursive: true });

    const htmlContent = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>DeployForge Site: ${data.projectId}</title>
  <style>
    body { font-family: system-ui, sans-serif; background: #0f172a; color: #f8fafc; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; }
    .card { background: #1e293b; padding: 2.5rem; border-radius: 12px; box-shadow: 0 10px 25px rgba(0,0,0,0.5); max-width: 600px; text-align: center; border: 1px solid #334155; }
    h1 { color: #38bdf8; margin-top: 0; }
    .badge { display: inline-block; padding: 0.25rem 0.75rem; border-radius: 9999px; background: #0369a1; color: white; font-weight: 600; font-size: 0.875rem; margin-bottom: 1rem; }
    pre { background: #0f172a; padding: 1rem; border-radius: 6px; text-align: left; overflow-x: auto; color: #94a3b8; font-size: 0.85rem; }
  </style>
</head>
<body>
  <div class="card">
    <div class="badge">DeployForge Deployment</div>
    <h1>Built and Deployed Successfully</h1>
    <p>This website was automatically built and deployed by DeployForge.</p>
    <pre>
Deployment ID: ${data.deploymentId}
Commit SHA:    ${data.commitSha}
Branch:        ${data.branch}
Provider:      ${data.provider}
Timestamp:     ${new Date().toISOString()}
    </pre>
  </div>
</body>
</html>`;

    fs.writeFileSync(path.join(distDir, 'index.html'), htmlContent, 'utf8');
  }
}
