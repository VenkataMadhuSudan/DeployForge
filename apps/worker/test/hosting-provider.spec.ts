/// <reference types="jest" />
/// <reference types="node" />
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { LocalTestingProvider, stopLocalStaticServer } from '../src/providers/provider-factory';

describe('LocalTestingProvider & Static Server', () => {
  let provider: LocalTestingProvider;
  let testDeploymentId: string;
  let deploymentDir: string;
  let storageBaseDir: string;
  const testPort = 8089;

  beforeAll(async () => {
    process.env.LOCAL_DEPLOYMENT_PORT = String(testPort);
    provider = new LocalTestingProvider();
    // Allow server to bind
    await new Promise((r) => setTimeout(r, 200));

    storageBaseDir = (provider as any).storageBaseDir;
    testDeploymentId = 'test-dep-' + Date.now();
    deploymentDir = path.join(storageBaseDir, testDeploymentId);
    fs.mkdirSync(deploymentDir, { recursive: true });

    // Create a realistic web app artifact
    fs.mkdirSync(path.join(deploymentDir, 'assets'), { recursive: true });
    fs.writeFileSync(
      path.join(deploymentDir, 'index.html'),
      '<!DOCTYPE html><html><head><title>My Real App</title></head><body><div id="root"><h1>Welcome to Real Site</h1></div></body></html>'
    );
    fs.writeFileSync(
      path.join(deploymentDir, 'assets', 'index.js'),
      'console.log("App script running");'
    );
    fs.writeFileSync(
      path.join(deploymentDir, 'assets', 'style.css'),
      'body { background: #123456; }'
    );
  });

  afterAll(async () => {
    try {
      if (fs.existsSync(deploymentDir)) {
        fs.rmSync(deploymentDir, { recursive: true, force: true });
      }
    } catch {
      // ignore cleanup error
    }
  });

  it('serves actual index.html on direct path request', async () => {
    const res = await fetch(`http://localhost:${testPort}/deployments/${testDeploymentId}/index.html`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    const text = await res.text();
    expect(text).toContain('Welcome to Real Site');
    expect(text).not.toContain('Built and Deployed Successfully');
  });

  it('resolves root-relative asset via Referer header', async () => {
    const res = await fetch(`http://localhost:${testPort}/assets/index.js`, {
      headers: {
        Referer: `http://localhost:${testPort}/deployments/${testDeploymentId}/index.html`,
      },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('javascript');
    const text = await res.text();
    expect(text).toBe('console.log("App script running");');
  });

  it('resolves root-relative asset via df_deployment_id cookie', async () => {
    const res = await fetch(`http://localhost:${testPort}/assets/style.css`, {
      headers: {
        Cookie: `df_deployment_id=${testDeploymentId}`,
      },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('css');
    const text = await res.text();
    expect(text).toBe('body { background: #123456; }');
  });

  it('performs SPA route fallback to index.html for extensionless paths', async () => {
    const res = await fetch(`http://localhost:${testPort}/deployments/${testDeploymentId}/dashboard`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    const text = await res.text();
    expect(text).toContain('Welcome to Real Site');
  });

  it('returns 404 for genuinely missing static assets instead of SPA fallback', async () => {
    const res = await fetch(`http://localhost:${testPort}/deployments/${testDeploymentId}/assets/missing.png`);
    expect(res.status).toBe(404);
  });

  it('blocks path traversal and returns 403/404', async () => {
    const res = await fetch(`http://localhost:${testPort}/deployments/${testDeploymentId}/../../.env`);
    expect([403, 404]).toContain(res.status);
  });

  it('serves deployment via RFC 6761 subdomain routing (Host: <deploymentId>.localhost)', async () => {
    const res = await fetch(`http://localhost:${testPort}/`, {
      headers: {
        'X-Forwarded-Host': `${testDeploymentId}.localhost:${testPort}`,
        Host: `${testDeploymentId}.localhost:${testPort}`,
      },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    const text = await res.text();
    expect(text).toContain('Welcome to Real Site');
  });

  it('serves assets on subdomain without requiring Referer or cookies', async () => {
    const res = await fetch(`http://localhost:${testPort}/assets/index.js`, {
      headers: {
        'X-Forwarded-Host': `${testDeploymentId}.localhost:${testPort}`,
        Host: `${testDeploymentId}.localhost:${testPort}`,
      },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('javascript');
    const text = await res.text();
    expect(text).toBe('console.log("App script running");');
  });

  it('serves extended MIME types (.wasm, .json) correctly', async () => {
    fs.writeFileSync(path.join(deploymentDir, 'assets', 'module.wasm'), Buffer.from([0x00, 0x61, 0x73, 0x6d]));
    const res = await fetch(`http://localhost:${testPort}/assets/module.wasm`, {
      headers: {
        'X-Forwarded-Host': `${testDeploymentId}.localhost:${testPort}`,
        Host: `${testDeploymentId}.localhost:${testPort}`,
      },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/wasm');
  });

  it('verifies deployment health check via getStatus()', async () => {
    const status = await provider.getStatus(`local-${testDeploymentId}`);
    expect(status.status).toBe('READY');
    expect(status.url).toContain(testDeploymentId);
  });

  it('rejects deployment health check when index.html is missing', async () => {
    const emptyId = 'empty-dep-' + Date.now();
    const emptyDir = path.join(storageBaseDir, emptyId);
    fs.mkdirSync(emptyDir, { recursive: true });
    try {
      const status = await provider.getStatus(`local-${emptyId}`);
      expect(status.status).toBe('ERROR');
    } finally {
      fs.rmSync(emptyDir, { recursive: true, force: true });
    }
  });

  describe('SSR Runtime Proxying & Health Checking', () => {
    let mockRuntimeServer: import('node:http').Server;
    let mockRuntimePort: number;
    const runtimeDeploymentId = 'test-ssr-' + Date.now();

    beforeAll(async () => {
      const http = await import('node:http');
      const { RuntimeProcessManager } = await import('../src/runtime/runtime-manager');

      mockRuntimeServer = http.createServer((req, res) => {
        if (req.url === '/') {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end('<h1>SSR Next.js Application</h1>');
        } else if (req.url === '/api/events') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ events: [{ id: 1, title: 'DevOps Summit' }] }));
        } else {
          res.writeHead(404);
          res.end('Not Found');
        }
      });

      await new Promise<void>((resolve) => {
        mockRuntimeServer.listen(0, '127.0.0.1', () => {
          const addr = mockRuntimeServer.address() as any;
          mockRuntimePort = addr.port;
          resolve();
        });
      });

      const runtimeManager = RuntimeProcessManager.getInstance();
      (runtimeManager as any).runtimes.set(runtimeDeploymentId, {
        deploymentId: runtimeDeploymentId,
        projectId: 'test-project',
        port: mockRuntimePort,
        process: { killed: false, kill: () => {} },
        workingDir: '/tmp',
        startTime: new Date(),
        status: 'READY',
      });
    });

    afterAll(async () => {
      if (mockRuntimeServer) {
        await new Promise((r) => mockRuntimeServer.close(r));
      }
      const { RuntimeProcessManager } = await import('../src/runtime/runtime-manager');
      const runtimeManager = RuntimeProcessManager.getInstance();
      (runtimeManager as any).runtimes.delete(runtimeDeploymentId);
    });

    it('proxies HTML request to active SSR runtime', async () => {
      const res = await fetch(`http://localhost:${testPort}/deployments/${runtimeDeploymentId}/`);
      expect(res.status).toBe(200);
      const text = await res.text();
      expect(text).toContain('SSR Next.js Application');
    });

    it('proxies API route request to active SSR runtime', async () => {
      const res = await fetch(`http://localhost:${testPort}/deployments/${runtimeDeploymentId}/api/events`);
      expect(res.status).toBe(200);
      const json: any = await res.json();
      expect(json.events[0].title).toBe('DevOps Summit');
    });

    it('verifies SSR runtime health via getStatus()', async () => {
      const status = await provider.getStatus(`local-${runtimeDeploymentId}`);
      expect(status.status).toBe('READY');
      expect(status.url).toContain(runtimeDeploymentId);
    });
  });
});
