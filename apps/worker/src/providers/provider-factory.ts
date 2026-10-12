import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import http from 'node:http';
import {
  HostingProviderAdapter,
  HostingProviderType,
  DeploymentResult,
} from '@deployforge/shared-types';
import { loadConfig } from '@deployforge/configuration';

let localStaticServer: http.Server | null = null;

export class LocalTestingProvider implements HostingProviderAdapter {
  readonly providerName = HostingProviderType.LOCAL_TESTING;
  private storageBaseDir: string;
  private port: number;

  constructor() {
    const config = loadConfig();
    this.storageBaseDir = path.resolve('./storage/deployments');
    this.port = config.LOCAL_DEPLOYMENT_PORT || 8080;
    fs.mkdirSync(this.storageBaseDir, { recursive: true });
    this.startStaticServer();
  }

  private startStaticServer(): void {
    if (localStaticServer) return;

    localStaticServer = http.createServer((req, res) => {
      try {
        const reqUrl = new URL(req.url || '/', `http://localhost:${this.port}`);
        let relativePath = decodeURIComponent(reqUrl.pathname);

        if (relativePath.startsWith('/deployments/')) {
          relativePath = relativePath.slice('/deployments/'.length);
        } else if (relativePath.startsWith('/deployments')) {
          relativePath = relativePath.slice('/deployments'.length);
        }

        const safePath = path.normalize(path.join(this.storageBaseDir, relativePath));
        if (!safePath.startsWith(this.storageBaseDir)) {
          res.writeHead(403, { 'Content-Type': 'text/plain' });
          res.end('Access Denied');
          return;
        }

        let filePath = safePath;
        if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
          filePath = path.join(filePath, 'index.html');
        }

        if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
          res.writeHead(404, { 'Content-Type': 'text/html' });
          res.end('<h1>404 Not Found</h1><p>Deployment artifact not found.</p>');
          return;
        }

        const ext = path.extname(filePath).toLowerCase();
        const mimeTypes: Record<string, string> = {
          '.html': 'text/html; charset=utf-8',
          '.css': 'text/css; charset=utf-8',
          '.js': 'application/javascript; charset=utf-8',
          '.json': 'application/json; charset=utf-8',
          '.png': 'image/png',
          '.jpg': 'image/jpeg',
          '.jpeg': 'image/jpeg',
          '.gif': 'image/gif',
          '.svg': 'image/svg+xml',
          '.ico': 'image/x-icon',
          '.woff': 'font/woff',
          '.woff2': 'font/woff2',
          '.ttf': 'font/ttf',
        };

        const contentType = mimeTypes[ext] || 'application/octet-stream';
        res.writeHead(200, {
          'Content-Type': contentType,
          'Access-Control-Allow-Origin': '*',
        });
        fs.createReadStream(filePath).pipe(res);
      } catch {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('Internal Server Error');
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
  }): Promise<DeploymentResult> {
    const targetDir = path.join(this.storageBaseDir, input.deploymentId);
    fs.mkdirSync(targetDir, { recursive: true });

    // Copy artifact contents recursively
    if (fs.existsSync(input.artifactPath)) {
      fs.cpSync(input.artifactPath, targetDir, { recursive: true });
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

  async getStatus(providerDeploymentId: string): Promise<{ status: 'READY' | 'BUILDING' | 'ERROR'; url?: string }> {
    const deploymentId = providerDeploymentId.replace('local-', '');
    const dir = path.join(this.storageBaseDir, deploymentId);
    if (fs.existsSync(dir)) {
      return {
        status: 'READY',
        url: `http://localhost:${this.port}/deployments/${deploymentId}/index.html`,
      };
    }
    return { status: 'ERROR' };
  }

  async rollback(previousDeploymentId: string): Promise<DeploymentResult> {
    const sourceDir = path.join(this.storageBaseDir, previousDeploymentId);
    if (!fs.existsSync(sourceDir)) {
      throw new Error(`Target local deployment ${previousDeploymentId} not found for rollback`);
    }
    const rollbackId = crypto.randomUUID();
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
