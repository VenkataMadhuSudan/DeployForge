import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import fs from 'node:fs';
import { spawn, ChildProcess } from 'node:child_process';
import { AppLogger, SecretRedactor, sanitizeLogContent } from '@deployforge/logging';
import { LogLevel, BuildStage } from '@deployforge/shared-types';
import { killProcessTree } from '../utils/process-tree';

export interface RuntimeInstance {
  deploymentId: string;
  projectId: string;
  port: number;
  process: ChildProcess;
  workingDir: string;
  startTime: Date;
  status: 'STARTING' | 'READY' | 'FAILED' | 'STOPPED';
}

export class RuntimeProcessManager {
  private static instance: RuntimeProcessManager | null = null;
  private logger = new AppLogger('RuntimeProcessManager');
  private runtimes = new Map<string, RuntimeInstance>();

  static getInstance(): RuntimeProcessManager {
    if (!RuntimeProcessManager.instance) {
      RuntimeProcessManager.instance = new RuntimeProcessManager();
    }
    return RuntimeProcessManager.instance;
  }

  constructor() {
    const cleanup = () => {
      this.stopAll();
    };
    process.once('SIGINT', cleanup);
    process.once('SIGTERM', cleanup);
    process.once('exit', cleanup);
  }

  getRuntime(deploymentId: string): RuntimeInstance | undefined {
    return this.runtimes.get(deploymentId);
  }

  hasRuntime(deploymentId: string): boolean {
    const r = this.runtimes.get(deploymentId);
    return !!r && (r.status === 'READY' || r.status === 'STARTING');
  }

  async allocateFreePort(): Promise<number> {
    return new Promise((resolve, reject) => {
      const srv = net.createServer();
      srv.listen(0, '127.0.0.1', () => {
        const addr = srv.address() as net.AddressInfo;
        const port = addr.port;
        srv.close((err) => {
          if (err) reject(err);
          else resolve(port);
        });
      });
      srv.on('error', reject);
    });
  }

  async startNextJsRuntime(input: {
    deploymentId: string;
    projectId: string;
    runtimeDir: string;
    envVars: Record<string, string>;
    redactor: SecretRedactor;
    onLog: (level: LogLevel, stage: BuildStage, message: string) => Promise<void>;
  }): Promise<{ port: number }> {
    const { deploymentId, projectId, runtimeDir, envVars, redactor, onLog } = input;

    // Stop any existing instance for this deployment
    await this.stopRuntime(deploymentId);

    const port = await this.allocateFreePort();
    await onLog(LogLevel.INFO, BuildStage.DEPLOY, `Allocated internal runtime port: ${port} for deployment ${deploymentId}`);

    // Determine executable: prefer local node_modules/.bin/next, fallback to npx next
    const isWindows = process.platform === 'win32';
    const localNextBin = path.join(
      runtimeDir,
      'node_modules',
      '.bin',
      isWindows ? 'next.cmd' : 'next'
    );

    let executable: string;
    let args: string[];

    if (fs.existsSync(localNextBin)) {
      executable = localNextBin;
      args = ['start', '-p', String(port), '-H', '127.0.0.1'];
    } else {
      executable = isWindows ? 'npx.cmd' : 'npx';
      args = ['next', 'start', '-p', String(port), '-H', '127.0.0.1'];
    }

    await onLog(LogLevel.INFO, BuildStage.DEPLOY, `Spawning Next.js SSR server on port ${port}...`);

    const sanitizedProcessEnv: Record<string, string> = {};
    for (const [key, value] of Object.entries(process.env)) {
      if (value === undefined) continue;
      const lowerKey = key.toLowerCase();
      if (
        lowerKey.startsWith('npm_config_') ||
        lowerKey.startsWith('npm_package_') ||
        lowerKey.startsWith('npm_lifecycle_') ||
        lowerKey === 'npm_command'
      ) {
        continue;
      }
      sanitizedProcessEnv[key] = value;
    }

    const child = spawn(executable, args, {
      cwd: runtimeDir,
      env: {
        ...sanitizedProcessEnv,
        ...envVars,
        PORT: String(port),
        HOSTNAME: '127.0.0.1',
        NODE_ENV: 'production',
      },
      windowsHide: true,
      shell: isWindows,
    });

    const instance: RuntimeInstance = {
      deploymentId,
      projectId,
      port,
      process: child,
      workingDir: runtimeDir,
      startTime: new Date(),
      status: 'STARTING',
    };
    this.runtimes.set(deploymentId, instance);

    child.stdout?.on('data', async (chunk: Buffer) => {
      const text = chunk.toString('utf8');
      const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
      for (const line of lines) {
        await onLog(LogLevel.INFO, BuildStage.DEPLOY, `[runtime] ${sanitizeLogContent(redactor.redact(line))}`);
      }
    });

    child.stderr?.on('data', async (chunk: Buffer) => {
      const text = chunk.toString('utf8');
      const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
      for (const line of lines) {
        await onLog(LogLevel.WARN, BuildStage.DEPLOY, `[runtime] ${sanitizeLogContent(redactor.redact(line))}`);
      }
    });

    child.on('exit', (code, signal) => {
      this.logger.warn(`Runtime process for deployment ${deploymentId} exited with code ${code}, signal ${signal}`);
      instance.status = 'STOPPED';
    });

    // Wait for Next.js to start and pass health check
    await this.waitForHealthCheck(port, onLog, 45000);
    instance.status = 'READY';

    return { port };
  }

  private async waitForHealthCheck(
    port: number,
    onLog: (level: LogLevel, stage: BuildStage, message: string) => Promise<void>,
    timeoutMs = 45000
  ): Promise<void> {
    const start = Date.now();
    await onLog(LogLevel.INFO, BuildStage.DEPLOY, 'Verifying Next.js runtime health and responsiveness...');

    while (Date.now() - start < timeoutMs) {
      try {
        const res = await fetch(`http://127.0.0.1:${port}/`, {
          method: 'GET',
          headers: { 'User-Agent': 'DeployForge-RuntimeHealth/1.0' },
        });
        if (res.status >= 200 && res.status < 500) {
          await onLog(LogLevel.INFO, BuildStage.DEPLOY, `Runtime health check passed (HTTP ${res.status} OK)`);
          return;
        }
      } catch {
        // Retry while process initializes
      }
      await new Promise((r) => setTimeout(r, 800));
    }

    throw new Error(`Runtime process failed to become healthy within ${timeoutMs / 1000}s on port ${port}`);
  }

  proxyRequest(
    instance: RuntimeInstance,
    targetPath: string,
    req: http.IncomingMessage,
    res: http.ServerResponse,
    deploymentId: string
  ): void {
    const headers = { ...req.headers };
    headers.host = `127.0.0.1:${instance.port}`;
    headers['x-forwarded-for'] = req.socket.remoteAddress || '127.0.0.1';
    headers['x-forwarded-proto'] = 'http';
    headers['x-forwarded-prefix'] = `/deployments/${deploymentId}`;

    // Clean up connection headers
    delete headers['connection'];

    const proxyReq = http.request(
      {
        host: '127.0.0.1',
        port: instance.port,
        path: targetPath || '/',
        method: req.method,
        headers,
      },
      (proxyRes) => {
        // Rewrite location header if redirecting
        const resHeaders = { ...proxyRes.headers };
        if (resHeaders.location && typeof resHeaders.location === 'string') {
          if (resHeaders.location.startsWith('/')) {
            resHeaders.location = `/deployments/${deploymentId}${resHeaders.location}`;
          }
        }

        // Set deployment context cookie
        resHeaders['set-cookie'] = [
          ...(Array.isArray(resHeaders['set-cookie']) ? resHeaders['set-cookie'] : (resHeaders['set-cookie'] ? [resHeaders['set-cookie']] : [])),
          `df_deployment_id=${deploymentId}; Path=/; SameSite=Lax`,
        ];

        res.writeHead(proxyRes.statusCode || 200, resHeaders);
        proxyRes.pipe(res);
      }
    );

    proxyReq.on('error', (err) => {
      this.logger.error(`Proxy request error to runtime port ${instance.port}: ${err.message}`);
      if (!res.headersSent) {
        res.writeHead(502, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`<h1>502 Bad Gateway</h1><p>Failed to connect to application runtime: ${err.message}</p>`);
      }
    });

    req.pipe(proxyReq);
  }

  async stopRuntime(deploymentId: string): Promise<void> {
    const instance = this.runtimes.get(deploymentId);
    if (!instance) return;

    try {
      if (instance.process && !instance.process.killed && instance.process.pid) {
        await killProcessTree(instance.process.pid);
        await new Promise((r) => setTimeout(r, 150));
      }
    } catch (e: any) {
      this.logger.warn(`Error terminating runtime ${deploymentId}: ${e.message}`);
    } finally {
      instance.status = 'STOPPED';
      this.runtimes.delete(deploymentId);
    }
  }

  async stopProjectRuntimesExcept(projectId: string, keepDeploymentId: string): Promise<void> {
    for (const [depId, instance] of this.runtimes.entries()) {
      if (instance.projectId === projectId && depId !== keepDeploymentId) {
        this.logger.info(`Stopping older runtime ${depId} for project ${projectId}`);
        await this.stopRuntime(depId);
      }
    }
  }

  stopAll(): void {
    for (const [id, instance] of this.runtimes.entries()) {
      try {
        if (instance.process && !instance.process.killed && instance.process.pid) {
          if (process.platform === 'win32') {
            spawn('taskkill', ['/pid', String(instance.process.pid), '/T', '/F']);
          } else {
            instance.process.kill('SIGTERM');
          }
        }
      } catch {
        // ignore
      }
    }
    this.runtimes.clear();
  }
}
