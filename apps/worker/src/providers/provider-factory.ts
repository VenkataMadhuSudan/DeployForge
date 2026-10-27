import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import http from 'node:http';
import { execSync } from 'node:child_process';
import {
  HostingProviderAdapter,
  HostingProviderType,
  DeploymentResult,
  LogLevel,
  BuildStage,
} from '@deployforge/shared-types';
import { loadConfig } from '@deployforge/configuration';
import { SecretRedactor } from '@deployforge/logging';
import { RuntimeProcessManager } from '../runtime/runtime-manager';

export function safeDeleteDirectory(targetPath: string): boolean {
  if (!fs.existsSync(targetPath)) return true;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      if (process.platform === 'win32') {
        try {
          execSync(`attrib -r -h -s "${targetPath}\\*.*" /s /d`, { stdio: 'ignore' });
        } catch {
          // ignore
        }
      }
      fs.rmSync(targetPath, { recursive: true, force: true, maxRetries: 3, retryDelay: 150 });
      return true;
    } catch (err: any) {
      if (attempt === 3) {
        console.warn(`[SafeCleanup] Non-fatal directory deletion warning for ${targetPath}:`, err?.message || err);
        return false;
      }
    }
  }
  return false;
}

export function safeMoveOrCopyDirectory(src: string, dest: string): void {
  if (!fs.existsSync(src) || src === dest) return;
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  safeDeleteDirectory(dest);

  try {
    fs.renameSync(src, dest);
    return;
  } catch {
    // If atomic rename fails (cross-volume or locked on Windows), fall back to copy
  }

  try {
    fs.cpSync(src, dest, { recursive: true });
    safeDeleteDirectory(src);
  } catch (cpErr: any) {
    console.warn(`[SafeMove] Error copying from ${src} to ${dest}:`, cpErr?.message || cpErr);
  }
}

export function repairRuntimeJunctions(runtimeDir: string, oldWorkspacePath?: string): void {
  try {
    const nextNodeModules = path.join(runtimeDir, '.next', 'node_modules');
    const localNodeModules = path.join(runtimeDir, 'node_modules');
    const prismaDir = path.join(localNodeModules, '@prisma');

    // 1. Repair broken junctions in .next/node_modules if present
    if (fs.existsSync(nextNodeModules)) {
      const scanDir = (dir: string) => {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          try {
            let isLink = entry.isSymbolicLink();
            let target: string | null = null;
            try {
              target = fs.readlinkSync(fullPath);
              isLink = true;
            } catch {
              // Not a link/junction
            }

            if (isLink && target) {
              const resolvedTarget = path.isAbsolute(target) ? target : path.resolve(dir, target);
              const targetBroken = !fs.existsSync(resolvedTarget) || (oldWorkspacePath && resolvedTarget.includes(oldWorkspacePath));
              if (targetBroken) {
                let rel = '';
                if (oldWorkspacePath && resolvedTarget.startsWith(oldWorkspacePath)) {
                  rel = resolvedTarget.slice(oldWorkspacePath.length).replace(/^[\\/]+/, '');
                } else if (entry.name.startsWith('client-')) {
                  rel = 'node_modules/@prisma/client';
                }
                const newTarget = path.join(runtimeDir, rel);
                if (fs.existsSync(newTarget)) {
                  fs.rmSync(fullPath, { recursive: true, force: true });
                  fs.symlinkSync(newTarget, fullPath, 'junction');
                }
              }
            } else if (entry.isDirectory()) {
              scanDir(fullPath);
            }
          } catch {
            // ignore individual link error
          }
        }
      };
      scanDir(nextNodeModules);
    }

    // 2. Ensure Turbopack @prisma/client-<hash> alias resolution in both .next and node_modules
    const prismaClientDir = path.join(prismaDir, 'client');
    if (fs.existsSync(prismaClientDir)) {
      const nextPrismaDir = path.join(nextNodeModules, '@prisma');
      const hashes = new Set<string>();

      if (fs.existsSync(nextPrismaDir)) {
        for (const name of fs.readdirSync(nextPrismaDir)) {
          if (name.startsWith('client-')) {
            hashes.add(name);
          }
        }
      }

      const chunksDir = path.join(runtimeDir, '.next', 'server', 'chunks');
      if (fs.existsSync(chunksDir)) {
        const chunkFiles = fs.readdirSync(chunksDir);
        for (const file of chunkFiles) {
          if (file.endsWith('.js')) {
            try {
              const content = fs.readFileSync(path.join(chunksDir, file), 'utf8');
              const matches = content.matchAll(/@prisma\/(client-[a-fA-F0-9]+)/g);
              for (const match of matches) {
                hashes.add(match[1]);
              }
            } catch {
              // ignore
            }
          }
        }
      }

      for (const hashName of hashes) {
        if (fs.existsSync(nextPrismaDir)) {
          const nextHashLink = path.join(nextPrismaDir, hashName);
          if (!fs.existsSync(nextHashLink)) {
            try {
              fs.symlinkSync(prismaClientDir, nextHashLink, 'junction');
            } catch {
              // fallback
            }
          }
        }
        if (fs.existsSync(prismaDir)) {
          const localHashLink = path.join(prismaDir, hashName);
          if (!fs.existsSync(localHashLink)) {
            try {
              fs.symlinkSync(prismaClientDir, localHashLink, 'junction');
            } catch {
              // fallback
            }
          }
        }
      }
    }
  } catch (err: any) {
    console.warn('repairRuntimeJunctions note:', err?.message || err);
  }
}

let localStaticServer: http.Server | null = null;

export class LocalTestingProvider implements HostingProviderAdapter {
  readonly providerName = HostingProviderType.LOCAL_TESTING;
  private storageBaseDir: string;
  private port: number;

  constructor() {
    const config = loadConfig();
    const defaultStorage = fs.existsSync(path.resolve('./apps/worker/storage'))
      ? path.resolve('./apps/worker/storage/deployments')
      : path.resolve('./storage/deployments');
    this.storageBaseDir = defaultStorage;
    this.port = config.LOCAL_DEPLOYMENT_PORT || 8080;
    fs.mkdirSync(this.storageBaseDir, { recursive: true });
    this.startStaticServer();
  }

  private startStaticServer(): void {
    if (localStaticServer) return;

    localStaticServer = http.createServer((req, res) => {
      try {
        const reqUrl = new URL(req.url || '/', `http://localhost:${this.port}`);
        let pathname = '/';
        try {
          pathname = decodeURIComponent(reqUrl.pathname);
        } catch {
          pathname = reqUrl.pathname;
        }

        // 1. Determine target deploymentId
        let deploymentId: string | null = null;
        let relativeFilePath: string = '';

        // Check subdomain routing: <deploymentId>.localhost:<port>
        const hostHeader = req.headers.host || '';
        const hostMatch = hostHeader.match(/^([a-zA-Z0-9_-]+)\.localhost(?::\d+)?$/i);

        if (hostMatch) {
          deploymentId = hostMatch[1];
          relativeFilePath = pathname.replace(/^\/+/, '');
        } else if (pathname.startsWith('/deployments/')) {
          const afterPrefix = pathname.slice('/deployments/'.length);
          const firstSlash = afterPrefix.indexOf('/');
          if (firstSlash === -1) {
            deploymentId = afterPrefix;
            relativeFilePath = '';
          } else {
            deploymentId = afterPrefix.substring(0, firstSlash);
            relativeFilePath = afterPrefix.substring(firstSlash + 1);
          }
        } else {
          // Root-relative asset requested (e.g. /assets/index.js, /favicon.ico, /_next/...)
          // Resolve using Referer header first (per tab isolation), then df_deployment_id cookie
          if (req.headers.referer) {
            const refererMatch = req.headers.referer.match(/\/deployments\/([a-zA-Z0-9_-]+)/);
            if (refererMatch) {
              deploymentId = refererMatch[1];
            }
          }
          if (!deploymentId) {
            const cookieHeader = req.headers.cookie || '';
            const cookieMatch = cookieHeader.match(/df_deployment_id=([a-zA-Z0-9_-]+)/);
            if (cookieMatch) {
              deploymentId = cookieMatch[1];
            }
          }
          relativeFilePath = pathname.replace(/^\/+/, '');
        }

        // Validate deploymentId format (prevent path traversal via deploymentId)
        if (!deploymentId || !/^[a-zA-Z0-9_-]+$/.test(deploymentId)) {
          res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end('<h1>404 Not Found</h1><p>No deployment context specified.</p>');
          return;
        }

        // 2. Check if an active SSR runtime exists for this deployment
        const runtimeManager = RuntimeProcessManager.getInstance();
        const runtime = runtimeManager.getRuntime(deploymentId);
        if (runtime && (runtime.status === 'READY' || runtime.status === 'STARTING')) {
          if (runtime.status === 'STARTING') {
            res.writeHead(503, { 'Content-Type': 'text/html; charset=utf-8', 'Retry-After': '2' });
            res.end('<h1>Application Starting</h1><p>The application runtime is starting up. Please refresh shortly.</p>');
            return;
          }

          let targetPath = '/' + relativeFilePath;
          if (targetPath === '/index.html') {
            targetPath = '/';
          }
          if (reqUrl.search) {
            targetPath += reqUrl.search;
          }
          runtimeManager.proxyRequest(runtime, targetPath, req, res, deploymentId);
          return;
        }

        const targetDir = path.resolve(this.storageBaseDir, deploymentId);
        const normalizedBase = path.resolve(this.storageBaseDir);
        if (!targetDir.startsWith(normalizedBase) || !fs.existsSync(targetDir)) {
          res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end('<h1>404 Not Found</h1><p>Deployment not found or has been cleaned up.</p>');
          return;
        }

        // Prevent path traversal within the deployment directory
        const safePath = path.resolve(targetDir, relativeFilePath);
        if (!safePath.startsWith(targetDir)) {
          res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
          res.end('Access Denied');
          return;
        }

        // Prevent exposure of sensitive files (.env, .git, package.json, etc.)
        const lowerSafe = safePath.toLowerCase();
        const baseName = path.basename(lowerSafe);
        if (
          baseName.startsWith('.env') ||
          baseName.startsWith('.git') ||
          baseName === 'package.json' ||
          baseName === 'tsconfig.json' ||
          lowerSafe.includes('node_modules')
        ) {
          res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
          res.end('Access Denied: Protected resource');
          return;
        }

        let filePath = safePath;
        if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
          filePath = path.join(filePath, 'index.html');
        }

        // If file exists, serve it with proper MIME type
        let isFile = false;
        try {
          isFile = fs.existsSync(filePath) && fs.statSync(filePath).isFile();
        } catch {
          isFile = false;
        }

        if (isFile) {
          const ext = path.extname(filePath).toLowerCase();
          const mimeTypes: Record<string, string> = {
            '.html': 'text/html; charset=utf-8',
            '.css': 'text/css; charset=utf-8',
            '.js': 'application/javascript; charset=utf-8',
            '.mjs': 'application/javascript; charset=utf-8',
            '.json': 'application/json; charset=utf-8',
            '.png': 'image/png',
            '.jpg': 'image/jpeg',
            '.jpeg': 'image/jpeg',
            '.gif': 'image/gif',
            '.svg': 'image/svg+xml',
            '.ico': 'image/x-icon',
            '.webp': 'image/webp',
            '.woff': 'font/woff',
            '.woff2': 'font/woff2',
            '.ttf': 'font/ttf',
            '.otf': 'font/otf',
            '.txt': 'text/plain; charset=utf-8',
            '.map': 'application/json; charset=utf-8',
          };

          res.writeHead(200, {
            'Content-Type': mimeTypes[ext] || 'application/octet-stream',
            'Access-Control-Allow-Origin': '*',
            'Set-Cookie': `df_deployment_id=${deploymentId}; Path=/; SameSite=Lax`,
          });
          const stream = fs.createReadStream(filePath);
          stream.on('error', () => {
            if (!res.headersSent) {
              res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
              res.end('Asset read error');
            }
          });
          stream.pipe(res);
          return;
        }

        // SPA Fallback:
        // If the path does not have a static file extension (e.g. /deployments/<id>/dashboard),
        // serve the application's index.html with 200 OK for client-side routing
        const hasExtension = path.extname(relativeFilePath).length > 0;
        const fallbackIndex = path.join(targetDir, 'index.html');
        if (!hasExtension && fs.existsSync(fallbackIndex)) {
          res.writeHead(200, {
            'Content-Type': 'text/html; charset=utf-8',
            'Access-Control-Allow-Origin': '*',
            'Set-Cookie': `df_deployment_id=${deploymentId}; Path=/; SameSite=Lax`,
          });
          const stream = fs.createReadStream(fallbackIndex);
          stream.on('error', () => {
            if (!res.headersSent) {
              res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
              res.end('Fallback index read error');
            }
          });
          stream.pipe(res);
          return;
        }

        // Missing static asset returns 404
        res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end('<h1>404 Not Found</h1><p>Requested asset not found in deployment.</p>');
      } catch (err: any) {
        if (!res.headersSent) {
          res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
          res.end(`Internal Server Error: ${err.message}`);
        }
      }
    });

    localStaticServer.on('error', () => {
      // Ignore if port is already in use
    });

    localStaticServer.listen(this.port);
    localStaticServer.unref();
  }

  async deploy(input: {
    projectId: string;
    deploymentId: string;
    artifactPath: string;
    customDomain?: string;
    envVars?: Record<string, string>;
    isRuntime?: boolean;
    workspacePath?: string;
    onLog?: (level: any, stage: any, message: string) => Promise<void>;
  }): Promise<DeploymentResult> {
    const runtimeManager = RuntimeProcessManager.getInstance();

    if (input.isRuntime) {
      const runtimeBaseDir = path.resolve(this.storageBaseDir, '../runtimes');
      fs.mkdirSync(runtimeBaseDir, { recursive: true });
      const runtimeDir = path.join(runtimeBaseDir, input.deploymentId);

      // Stop previous instance if running
      await runtimeManager.stopRuntime(input.deploymentId);

      // Move or copy workspacePath to runtimeDir if it's not already runtimeDir
      if (input.workspacePath && input.workspacePath !== runtimeDir && fs.existsSync(input.workspacePath)) {
        safeMoveOrCopyDirectory(input.workspacePath, runtimeDir);
      }

      // Repair any broken junctions or externalized module links (e.g. Turbopack @prisma/client-<hash>)
      repairRuntimeJunctions(runtimeDir, input.workspacePath);

      const redactor = new SecretRedactor();
      if (input.envVars) {
        for (const val of Object.values(input.envVars)) {
          if (val && val.length > 3) redactor.addSecret(val);
        }
      }

      const { port } = await runtimeManager.startNextJsRuntime({
        deploymentId: input.deploymentId,
        projectId: input.projectId,
        runtimeDir,
        envVars: input.envVars || {},
        redactor,
        onLog: input.onLog || (async () => {}),
      });

      const deploymentUrl = `http://localhost:${this.port}/deployments/${input.deploymentId}/`;

      return {
        providerDeploymentId: `local-${input.deploymentId}`,
        deploymentUrl,
        isLocalTesting: true,
        metadata: {
          storagePath: runtimeDir,
          port,
          engine: 'LocalNextJsRuntimeAdapter',
        },
      };
    }

    const targetDir = path.join(this.storageBaseDir, input.deploymentId);
    fs.rmSync(targetDir, { recursive: true, force: true });
    fs.mkdirSync(targetDir, { recursive: true });

    // Copy artifact contents recursively with safety filter
    if (fs.existsSync(input.artifactPath)) {
      fs.cpSync(input.artifactPath, targetDir, {
        recursive: true,
        filter: (src) => {
          const rel = path.relative(input.artifactPath, src);
          const parts = rel.split(path.sep);
          // Omit sensitive files from published artifacts
          if (parts.some((p) => p === '.git' || p === 'node_modules' || p.startsWith('.env'))) {
            return false;
          }
          return true;
        },
      });
    }

    const indexPath = path.join(targetDir, 'index.html');
    if (!fs.existsSync(indexPath)) {
      throw new Error(`Deployed artifacts in ${targetDir} do not contain an index.html entry point`);
    }

    // Inject base tag for robust relative asset resolution if head is present and base is missing
    try {
      const htmlContent = fs.readFileSync(indexPath, 'utf8');
      if (!/<base\s/i.test(htmlContent) && /<head>/i.test(htmlContent)) {
        const patched = htmlContent.replace(
          /<head>/i,
          `<head>\n  <base href="/deployments/${input.deploymentId}/">`
        );
        fs.writeFileSync(indexPath, patched, 'utf8');
      }
    } catch {
      // Non-fatal if base tag injection fails
    }

    const deploymentUrl = `http://localhost:${this.port}/deployments/${input.deploymentId}/index.html`;

    return {
      providerDeploymentId: `local-${input.deploymentId}`,
      deploymentUrl,
      isLocalTesting: true,
      metadata: {
        storagePath: targetDir,
        engine: 'LocalStaticTestingAdapter',
      },
    };
  }

  async getStatus(providerDeploymentId: string): Promise<{ status: 'READY' | 'BUILDING' | 'ERROR'; url?: string; message?: string }> {
    const deploymentId = providerDeploymentId.replace('local-', '');
    const runtimeManager = RuntimeProcessManager.getInstance();
    const runtime = runtimeManager.getRuntime(deploymentId);

    if (runtime) {
      if (runtime.status === 'FAILED' || runtime.status === 'STOPPED') {
        return { status: 'ERROR', message: `SSR runtime process status is ${runtime.status}` };
      }
      const deploymentUrl = `http://localhost:${this.port}/deployments/${deploymentId}/`;
      try {
        const res = await fetch(deploymentUrl, {
          method: 'GET',
          headers: { 'User-Agent': 'DeployForge-HealthCheck/1.0' },
        });
        if (res.status >= 200 && res.status < 500) {
          return { status: 'READY', url: deploymentUrl };
        }
        return { status: 'ERROR', message: `SSR runtime health check returned HTTP ${res.status}` };
      } catch (err: any) {
        return { status: 'ERROR', message: `SSR runtime health check connection error: ${err.message}` };
      }
    }

    const dir = path.join(this.storageBaseDir, deploymentId);
    const indexPath = path.join(dir, 'index.html');

    if (!fs.existsSync(indexPath)) {
      return { status: 'ERROR', message: `Entry point 'index.html' not found in ${dir}` };
    }

    const deploymentUrl = `http://localhost:${this.port}/deployments/${deploymentId}/index.html`;

    // Perform actual HTTP verification
    try {
      const res = await fetch(deploymentUrl, {
        method: 'GET',
        headers: { 'User-Agent': 'DeployForge-HealthCheck/1.0' },
      });

      if (!res.ok) {
        return { status: 'ERROR', message: `Health check returned HTTP ${res.status}` };
      }

      const text = await res.text();
      if (!text || text.trim().length === 0) {
        return { status: 'ERROR', message: 'Health check received empty response body' };
      }

      // Reject placeholder page if accidentally served
      if (text.includes('Built and Deployed Successfully') && text.includes('DeployForge Deployment')) {
        return { status: 'ERROR', message: 'Health check rejected mock placeholder card' };
      }

      return {
        status: 'READY',
        url: deploymentUrl,
      };
    } catch (fetchErr: any) {
      return { status: 'ERROR', message: `Health check connection error: ${fetchErr.message}` };
    }
  }

  async rollback(previousDeploymentId: string): Promise<DeploymentResult> {
    const runtimeBaseDir = path.resolve(this.storageBaseDir, '../runtimes');
    const sourceRuntime = path.join(runtimeBaseDir, previousDeploymentId);
    const rollbackId = crypto.randomUUID();

    if (fs.existsSync(sourceRuntime)) {
      const targetRuntime = path.join(runtimeBaseDir, rollbackId);
      fs.cpSync(sourceRuntime, targetRuntime, { recursive: true });
      const runtimeManager = RuntimeProcessManager.getInstance();
      const redactor = new SecretRedactor();
      await runtimeManager.startNextJsRuntime({
        deploymentId: rollbackId,
        projectId: 'rollback',
        runtimeDir: targetRuntime,
        envVars: {},
        redactor,
        onLog: async () => {},
      });
      return {
        providerDeploymentId: `local-${rollbackId}`,
        deploymentUrl: `http://localhost:${this.port}/deployments/${rollbackId}/`,
        isLocalTesting: true,
      };
    }

    const sourceDir = path.join(this.storageBaseDir, previousDeploymentId);
    if (!fs.existsSync(sourceDir)) {
      throw new Error(`Target local deployment ${previousDeploymentId} not found for rollback`);
    }
    const targetDir = path.join(this.storageBaseDir, rollbackId);
    fs.cpSync(sourceDir, targetDir, { recursive: true });

    return {
      providerDeploymentId: `local-${rollbackId}`,
      deploymentUrl: `http://localhost:${this.port}/deployments/${rollbackId}/index.html`,
      isLocalTesting: true,
    };
  }
}

export class CloudflarePagesProvider implements HostingProviderAdapter {
  readonly providerName = HostingProviderType.CLOUDFLARE_PAGES;
  private accountId?: string;
  private apiToken?: string;

  constructor() {
    const config = loadConfig();
    this.accountId = config.CLOUDFLARE_ACCOUNT_ID;
    this.apiToken = config.CLOUDFLARE_API_TOKEN;
  }

  async deploy(input: {
    projectId: string;
    deploymentId: string;
    artifactPath: string;
    customDomain?: string;
    envVars?: Record<string, string>;
  }): Promise<DeploymentResult> {
    if (!this.accountId || !this.apiToken) {
      throw new Error(
        'Cloudflare Pages credentials not configured. Please supply CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN.'
      );
    }

    // Official Cloudflare Pages Direct Upload API integration
    // Cloudflare Pages expects multipart form files or manifest hashes
    const url = `https://api.cloudflare.com/client/v4/accounts/${this.accountId}/pages/projects/${input.projectId}/deployments`;
    
    // Check if project exists on Cloudflare or create deployment
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiToken}`,
      },
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Cloudflare Pages deployment failed with status ${response.status}: ${errText}`);
    }

    const data: any = await response.json();
    if (!data.success) {
      throw new Error(`Cloudflare Pages API error: ${JSON.stringify(data.errors)}`);
    }

    return {
      providerDeploymentId: data.result.id,
      deploymentUrl: data.result.url,
      isLocalTesting: false,
      metadata: data.result,
    };
  }

  async getStatus(providerDeploymentId: string): Promise<{ status: 'READY' | 'BUILDING' | 'ERROR'; url?: string }> {
    if (!this.accountId || !this.apiToken) {
      throw new Error('Cloudflare credentials missing');
    }

    const res = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${this.accountId}/pages/deployments/${providerDeploymentId}`,
      {
        headers: { Authorization: `Bearer ${this.apiToken}` },
      }
    );

    if (!res.ok) {
      return { status: 'ERROR' };
    }

    const data: any = await res.json();
    const stage = data?.result?.latest_stage?.status;
    return {
      status: stage === 'success' ? 'READY' : stage === 'failure' ? 'ERROR' : 'BUILDING',
      url: data?.result?.url,
    };
  }
}

export function createHostingProvider(type: HostingProviderType): HostingProviderAdapter {
  switch (type) {
    case HostingProviderType.CLOUDFLARE_PAGES:
      return new CloudflarePagesProvider();
    case HostingProviderType.LOCAL_TESTING:
    default:
      return new LocalTestingProvider();
  }
}

export function stopLocalStaticServer(): Promise<void> {
  return new Promise((resolve) => {
    if (localStaticServer) {
      localStaticServer.close(() => {
        localStaticServer = null;
        resolve();
      });
    } else {
      resolve();
    }
  });
}

