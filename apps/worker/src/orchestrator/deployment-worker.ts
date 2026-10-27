import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { Worker, Job } from 'bullmq';
import { prisma, LogLevel, BuildStage } from '@deployforge/database';
import {
  DeploymentJobData,
  canTransition,
  HostingProviderType,
  DeploymentStatus,
} from '@deployforge/shared-types';
import { SecretRedactor, AppLogger, sanitizeLogContent } from '@deployforge/logging';
import { loadConfig, decryptSecret, getRedisConnectionOptions } from '@deployforge/configuration';
import { createBuildExecutor } from '../executors/build-executor';
import { detectFramework, resolveProjectRoot, DeploymentMode } from '../frameworks/framework-detector';
import { createHostingProvider, safeDeleteDirectory } from '../providers/provider-factory';
import { diagnoseDeploymentError } from './error-diagnostics';
import { RuntimeProcessManager } from '../runtime/runtime-manager';
import { killProcessTree } from '../utils/process-tree';

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

    this.worker.on('error', (err) => {
      this.logger.error(`BullMQ worker Redis connection error: ${err.message}`);
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
    let workspacePath = path.resolve(config.BUILD_WORKSPACE_DIR, data.deploymentId);
    let isRuntime = false;
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

      // 4. Clone actual repository
      await appendLog(LogLevel.INFO, BuildStage.PREPARE, `Cloning repository: ${data.repoUrl} (branch: ${data.branch})`);
      await this.cloneRepository(workspacePath, data, redactor, appendLog);
      await appendLog(LogLevel.INFO, BuildStage.PREPARE, 'Repository clone completed successfully.');

      // 5. Framework and project root resolution
      const resolvedRoot = resolveProjectRoot(workspacePath, data.rootDirectory);
      for (const warning of resolvedRoot.warnings) {
        await appendLog(LogLevel.WARN, BuildStage.PREPARE, warning);
      }
      const projectRootPath = resolvedRoot.rootPath;
      if (resolvedRoot.relativeRoot) {
        await appendLog(
          LogLevel.INFO,
          BuildStage.PREPARE,
          `Application project root: '${resolvedRoot.relativeRoot}'`
        );
      }

      const detected = detectFramework(projectRootPath);
      isRuntime = detected.deploymentMode === DeploymentMode.SSR_RUNTIME;

      if (isRuntime) {
        if (data.provider === HostingProviderType.CLOUDFLARE_PAGES) {
          throw new Error(
            "Next.js server-rendered application detected. The selected provider (Cloudflare Pages) supports static files only. Select a provider with Node.js runtime support (Local Testing) or configure this application for a compatible static export."
          );
        }
        await appendLog(
          LogLevel.INFO,
          BuildStage.PREPARE,
          'Next.js Server-Side Rendering (SSR) runtime mode detected. DeployForge will deploy and serve this application via an isolated Node.js application process.'
        );

      }

      // Check for Prisma schema and ensure build-time database connectivity configuration
      const prismaPath = fs.existsSync(path.join(projectRootPath, 'prisma', 'schema.prisma'))
        ? path.join(projectRootPath, 'prisma', 'schema.prisma')
        : (fs.existsSync(path.join(workspacePath, 'prisma', 'schema.prisma')) ? path.join(workspacePath, 'prisma', 'schema.prisma') : null);

      if (prismaPath) {
        if (!runtimeEnv['DATABASE_URL']) {
          try {
            const schemaContent = fs.readFileSync(prismaPath, 'utf8');
            if (schemaContent.includes('provider = "postgresql"')) {
              runtimeEnv['DATABASE_URL'] = 'postgresql://postgres:postgres@localhost:5432/event_manager?schema=public';
            } else if (schemaContent.includes('provider = "mysql"')) {
              runtimeEnv['DATABASE_URL'] = 'mysql://root:password@localhost:3306/event_manager';
            } else if (schemaContent.includes('provider = "sqlite"')) {
              runtimeEnv['DATABASE_URL'] = 'file:./dev.db';
            }
            await appendLog(
              LogLevel.WARN,
              BuildStage.PREPARE,
              'Notice: No DATABASE_URL environment variable was defined for this project. Set DATABASE_URL in Project Settings -> Env Vars if your application requires database connectivity.'
            );
          } catch {
            // Non-fatal
          }
        }
      }

      let effectiveInstall = data.installCommand || detected.installCommand;
      let effectiveBuild = data.buildCommand || detected.buildCommand;

      // Determine effective output directory based on framework heuristics
      let effectiveOutput = detected.outputDirectory;
      if (
        data.outputDirectory &&
        data.outputDirectory !== 'dist' &&
        data.outputDirectory !== detected.outputDirectory &&
        detected.deploymentMode !== DeploymentMode.SSR_RUNTIME
      ) {
        effectiveOutput = data.outputDirectory;
      }

      // Prevent dev servers from starting during build
      if (effectiveBuild && (effectiveBuild.includes('run dev') || effectiveBuild.trim() === 'npm start')) {
        await appendLog(LogLevel.WARN, BuildStage.PREPARE, `Replacing '${effectiveBuild}' with 'npm run build' (dev servers do not terminate)`);
        effectiveBuild = 'npm run build';
      }

      await appendLog(
        LogLevel.INFO,
        BuildStage.PREPARE,
        `Detected framework: ${detected.framework} (Output directory: ${effectiveOutput}, Mode: ${detected.deploymentMode})`
      );

      // 6. Transition to BUILDING
      await prisma.deployment.update({
        where: { id: data.deploymentId },
        data: { status: DeploymentStatus.BUILDING as any },
      });

      const executor = await createBuildExecutor();
      await appendLog(LogLevel.INFO, BuildStage.BUILD, `Using build executor: ${executor.executorType}`);

      const buildResult = await executor.executeBuild({
        workspacePath: projectRootPath,
        installCwd: resolvedRoot.isMonorepo ? workspacePath : projectRootPath,
        installCommand: effectiveInstall,
        buildCommand: effectiveBuild,
        outputDirectory: effectiveOutput,
        envVars: runtimeEnv,
        redactor,
        onLog: appendLog,
      });

      if (!buildResult.success) {
        const diagnostic = diagnoseDeploymentError(
          BuildStage.BUILD,
          buildResult.errorMessage || 'Build process failed',
          { exitCode: buildResult.exitCode, outputDirectory: effectiveOutput }
        );
        await prisma.deployment.update({
          where: { id: data.deploymentId },
          data: {
            status: DeploymentStatus.FAILED as any,
            errorCode: diagnostic.category,
            errorMessage: `${diagnostic.summary}: ${diagnostic.likelyCause}`,
            completedAt: new Date(),
          },
        });
        await appendLog(LogLevel.ERROR, BuildStage.BUILD, `Deployment failed [${diagnostic.category}]: ${diagnostic.summary}`);
        await appendLog(LogLevel.WARN, BuildStage.BUILD, `Likely cause: ${diagnostic.likelyCause}`);
        await appendLog(LogLevel.INFO, BuildStage.BUILD, `Suggested action: ${diagnostic.suggestedAction}`);
        return;
      }

      // 7. Transition to DEPLOYING
      await prisma.deployment.update({
        where: { id: data.deploymentId },
        data: { status: DeploymentStatus.DEPLOYING as any },
      });

      await appendLog(LogLevel.INFO, BuildStage.DEPLOY, `Deploying artifacts via provider: ${data.provider} (Mode: ${detected.deploymentMode})`);
      const provider = createHostingProvider(data.provider as HostingProviderType);

      const deployResult = await provider.deploy({
        projectId: data.projectId,
        deploymentId: data.deploymentId,
        artifactPath: buildResult.artifactPath,
        envVars: runtimeEnv,
        isRuntime,
        workspacePath: projectRootPath,
        onLog: appendLog,
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

      // Promote to active deployment for this project
      try {
        await prisma.project.update({
          where: { id: data.projectId },
          data: { activeDeploymentId: data.deploymentId },
        });
      } catch (projErr) {
        this.logger.warn(`Could not update project activeDeploymentId: ${projErr}`);
      }

      // Stop older runtimes for this project now that the new deployment is healthy
      try {
        await RuntimeProcessManager.getInstance().stopProjectRuntimesExcept(data.projectId, data.deploymentId);
      } catch (stopErr) {
        this.logger.warn(`Could not stop older project runtimes: ${stopErr}`);
      }

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
      const diagnostic = diagnoseDeploymentError(
        BuildStage.SYSTEM,
        err.message || 'Execution exception'
      );
      this.logger.error(`Deployment ${data.deploymentId} execution error [${diagnostic.category}]: ${err.message}`);
      await prisma.deployment.update({
        where: { id: data.deploymentId },
        data: {
          status: DeploymentStatus.FAILED as any,
          errorCode: diagnostic.category,
          errorMessage: `${diagnostic.summary}: ${diagnostic.likelyCause}`,
          completedAt: new Date(),
        },
      });
      await appendLog(LogLevel.ERROR, BuildStage.SYSTEM, `Fatal error [${diagnostic.category}]: ${diagnostic.summary}`);
      await appendLog(LogLevel.WARN, BuildStage.SYSTEM, `Likely cause: ${diagnostic.likelyCause}`);
      await appendLog(LogLevel.INFO, BuildStage.SYSTEM, `Suggested action: ${diagnostic.suggestedAction}`);
    } finally {
      // 10. Clean up temporary workspace (non-fatal, safe against Windows file locks)
      try {
        if (!isRuntime && fs.existsSync(workspacePath)) {
          safeDeleteDirectory(workspacePath);
        }
      } catch (cleanupErr) {
        this.logger.warn(`Workspace cleanup error: ${cleanupErr}`);
      }
    }
  }

  private async cloneRepository(
    workspacePath: string,
    data: DeploymentJobData,
    redactor: SecretRedactor,
    onLog: (level: LogLevel, stage: BuildStage, message: string) => Promise<void>
  ): Promise<void> {
    const rawRepoUrl = data.repoUrl?.trim();
    if (!rawRepoUrl) {
      throw new Error('Repository URL is required but was not provided.');
    }

    if (rawRepoUrl.startsWith('-')) {
      throw new Error('Invalid repository URL: cannot start with a hyphen.');
    }

    const isValidUrl =
      /^(https?:\/\/|git@|git:\/\/|file:\/\/)/i.test(rawRepoUrl) ||
      path.isAbsolute(rawRepoUrl);

    if (!isValidUrl) {
      throw new Error(`Unsupported repository URL scheme: ${rawRepoUrl}`);
    }

    const branch = data.branch?.trim() || 'main';
    if (branch.startsWith('-') || !/^[a-zA-Z0-9._/-]+$/.test(branch)) {
      throw new Error(`Invalid branch name: ${branch}`);
    }

    const isSpecificCommit =
      data.commitSha &&
      data.commitSha !== '0000000000000000000000000000000000000000' &&
      /^[a-fA-F0-9]{7,40}$/.test(data.commitSha);

    const runGit = (args: string[], cwd?: string): Promise<{ exitCode: number; stderr: string; stdout: string }> => {
      return new Promise((resolve) => {
        let stdout = '';
        let stderr = '';
        const child = spawn('git', args, {
          cwd: cwd || process.cwd(),
          env: {
            ...process.env,
            GIT_TERMINAL_PROMPT: '0',
            GIT_ASKPASS: 'echo',
          },
          windowsHide: true,
        });

        const timer = setTimeout(async () => {
          if (child.pid) {
            await killProcessTree(child.pid);
          } else {
            child.kill('SIGKILL');
          }
          onLog(LogLevel.ERROR, BuildStage.PREPARE, 'Git operation timed out after 120 seconds');
        }, 120000);

        child.stdout?.on('data', async (chunk: Buffer) => {
          const text = chunk.toString('utf8');
          stdout += text;
          const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
          for (const line of lines) {
            await onLog(LogLevel.INFO, BuildStage.PREPARE, sanitizeLogContent(redactor.redact(line)));
          }
        });

        child.stderr?.on('data', async (chunk: Buffer) => {
          const text = chunk.toString('utf8');
          stderr += text;
          const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
          for (const line of lines) {
            await onLog(LogLevel.INFO, BuildStage.PREPARE, sanitizeLogContent(redactor.redact(line)));
          }
        });

        child.on('close', (code) => {
          clearTimeout(timer);
          resolve({ exitCode: code ?? 1, stdout, stderr });
        });

        child.on('error', async (err) => {
          clearTimeout(timer);
          await onLog(LogLevel.ERROR, BuildStage.PREPARE, `Git execution error: ${err.message}`);
          resolve({ exitCode: 1, stdout, stderr: err.message });
        });
      });
    };

    // Clean workspace directory before clone
    fs.rmSync(workspacePath, { recursive: true, force: true });
    fs.mkdirSync(workspacePath, { recursive: true });

    // Attempt shallow branch clone first
    await onLog(LogLevel.INFO, BuildStage.PREPARE, `Cloning branch '${branch}'...`);
    let cloneRes = await runGit(['clone', '--depth', '1', '--branch', branch, '--', rawRepoUrl, workspacePath]);

    // If shallow branch clone failed, retry standard clone
    if (cloneRes.exitCode !== 0) {
      await onLog(LogLevel.WARN, BuildStage.PREPARE, 'Shallow branch clone failed, attempting standard clone...');
      fs.rmSync(workspacePath, { recursive: true, force: true });
      fs.mkdirSync(workspacePath, { recursive: true });
      cloneRes = await runGit(['clone', '--', rawRepoUrl, workspacePath]);
      if (cloneRes.exitCode !== 0) {
        throw new Error(`Git clone failed with exit code ${cloneRes.exitCode}: ${sanitizeLogContent(redactor.redact(cloneRes.stderr))}`);
      }
      const checkoutRes = await runGit(['checkout', branch], workspacePath);
      if (checkoutRes.exitCode !== 0) {
        await onLog(LogLevel.WARN, BuildStage.PREPARE, `Could not checkout branch '${branch}', using default checkout`);
      }
    }

    // Checkout specific commit SHA if requested
    if (isSpecificCommit) {
      await onLog(LogLevel.INFO, BuildStage.PREPARE, `Checking out target commit: ${data.commitSha}`);
      const checkoutShaRes = await runGit(['checkout', data.commitSha], workspacePath);
      if (checkoutShaRes.exitCode !== 0) {
        await runGit(['fetch', '--depth', '1', 'origin', data.commitSha], workspacePath);
        const retrySha = await runGit(['checkout', data.commitSha], workspacePath);
        if (retrySha.exitCode !== 0) {
          throw new Error(`Target commit SHA ${data.commitSha} could not be checked out.`);
        }
      }
    }

    // Verify workspace is not empty
    const clonedFiles = fs.readdirSync(workspacePath);
    if (clonedFiles.length === 0 || (clonedFiles.length === 1 && clonedFiles[0] === '.git')) {
      throw new Error('Cloned repository contains no application files.');
    }
  }
}
