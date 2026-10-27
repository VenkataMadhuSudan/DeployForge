/// <reference types="jest" />
/// <reference types="node" />
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { ProcessBuildExecutor } from '../src/executors/build-executor';
import { detectFramework, resolveProjectRoot, DeploymentMode } from '../src/frameworks/framework-detector';
import { LocalTestingProvider, stopLocalStaticServer } from '../src/providers/provider-factory';
import { RuntimeProcessManager } from '../src/runtime/runtime-manager';
import { SecretRedactor } from '@deployforge/logging';
import { BuildStage, LogLevel, ProjectFramework } from '@deployforge/shared-types';

describe('DeployForge Comprehensive Deployment Lifecycle Test Suite', () => {
  let tmpBase: string;
  let testPort: number;
  let provider: LocalTestingProvider;

  beforeAll(async () => {
    tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'df-lifecycle-'));
    provider = new LocalTestingProvider();
    testPort = provider.getPort();
    await new Promise((r) => setTimeout(r, 200));
  });

  afterAll(async () => {
    try {
      if (fs.existsSync(tmpBase)) {
        fs.rmSync(tmpBase, { recursive: true, force: true });
      }
    } catch {
      // ignore
    }
  });

  // ─── TEST 1: Static HTML Application ──────────────────────────────────────────
  describe('Test 1: Static HTML Application', () => {
    it('builds, publishes, serves, and passes health check for a static HTML app', async () => {
      const appDir = path.join(tmpBase, 'static-app');
      fs.mkdirSync(path.join(appDir, 'public', 'assets'), { recursive: true });
      fs.writeFileSync(
        path.join(appDir, 'public', 'index.html'),
        '<!DOCTYPE html><html><head><title>Static App</title><link rel="stylesheet" href="/assets/style.css"></head><body><h1>Static Content OK</h1><script src="/assets/app.js"></script></body></html>'
      );
      fs.writeFileSync(path.join(appDir, 'public', 'assets', 'style.css'), 'body { margin: 0; }');
      fs.writeFileSync(path.join(appDir, 'public', 'assets', 'app.js'), 'console.log("static app");');

      const detected = detectFramework(appDir);
      expect(detected.framework).toBe(ProjectFramework.STATIC);
      expect(detected.outputDirectory).toBe('public');

      const executor = new ProcessBuildExecutor();
      const redactor = new SecretRedactor();
      const logs: string[] = [];
      const onLog = async (_l: LogLevel, _s: BuildStage, msg: string) => { logs.push(msg); };

      const buildRes = await executor.executeBuild({
        workspacePath: appDir,
        buildCommand: 'echo "Ready"',
        outputDirectory: 'public',
        envVars: {},
        redactor,
        onLog,
      });

      expect(buildRes.success).toBe(true);
      expect(fs.existsSync(buildRes.artifactPath)).toBe(true);

      const depId = 'static-dep-' + Date.now();
      const deployRes = await provider.deploy({
        projectId: 'proj-static',
        deploymentId: depId,
        artifactPath: buildRes.artifactPath,
        onLog,
      });

      expect(deployRes.deploymentUrl).toContain(`${depId}.localhost:${testPort}`);

      const statusRes = await provider.getStatus(`local-${depId}`);
      expect(statusRes.status).toBe('READY');

      // Verify HTTP 200 on origin-isolated subdomain
      const res = await fetch(`http://localhost:${testPort}/`, {
        headers: {
          'X-Forwarded-Host': `${depId}.localhost:${testPort}`,
          Host: `${depId}.localhost:${testPort}`,
        },
      });
      expect(res.status).toBe(200);
      const text = await res.text();
      expect(text).toContain('Static Content OK');

      // Verify CSS and JS assets
      const cssRes = await fetch(`http://localhost:${testPort}/assets/style.css`, {
        headers: {
          'X-Forwarded-Host': `${depId}.localhost:${testPort}`,
          Host: `${depId}.localhost:${testPort}`,
        },
      });
      expect(cssRes.status).toBe(200);
      expect(cssRes.headers.get('content-type')).toContain('css');

      const jsRes = await fetch(`http://localhost:${testPort}/assets/app.js`, {
        headers: {
          'X-Forwarded-Host': `${depId}.localhost:${testPort}`,
          Host: `${depId}.localhost:${testPort}`,
        },
      });
      expect(jsRes.status).toBe(200);
      expect(jsRes.headers.get('content-type')).toContain('javascript');
    });
  });

  // ─── TEST 2: Vite React Application ───────────────────────────────────────────
  describe('Test 2: Vite React Application', () => {
    it('detects Vite framework, package manager, and validates dist output', async () => {
      const appDir = path.join(tmpBase, 'vite-app');
      fs.mkdirSync(appDir, { recursive: true });
      fs.writeFileSync(
        path.join(appDir, 'package.json'),
        JSON.stringify({
          name: 'my-vite-app',
          dependencies: { react: '^18.2.0', 'react-dom': '^18.2.0' },
          devDependencies: { vite: '^5.0.0' },
          scripts: { build: 'echo "mock vite build"' },
        })
      );
      fs.writeFileSync(path.join(appDir, 'package-lock.json'), '{}');

      const detected = detectFramework(appDir);
      expect(detected.framework).toBe(ProjectFramework.REACT_VITE);
      expect(detected.outputDirectory).toBe('dist');
      expect(detected.packageManager).toBe('npm');
      expect(detected.installCommand).toBe('npm ci');

      // Simulate output directory creation
      fs.mkdirSync(path.join(appDir, 'dist', 'assets'), { recursive: true });
      fs.writeFileSync(
        path.join(appDir, 'dist', 'index.html'),
        '<!DOCTYPE html><html><head><script type="module" src="/assets/index.js"></script></head><body><div id="root">React App Running</div></body></html>'
      );
      fs.writeFileSync(path.join(appDir, 'dist', 'assets', 'index.js'), 'console.log("React mounted");');

      const executor = new ProcessBuildExecutor();
      const redactor = new SecretRedactor();
      const buildRes = await executor.executeBuild({
        workspacePath: appDir,
        buildCommand: 'echo "built"',
        outputDirectory: 'dist',
        envVars: {},
        redactor,
        onLog: async () => {},
      });

      expect(buildRes.success).toBe(true);

      const depId = 'vite-dep-' + Date.now();
      await provider.deploy({
        projectId: 'proj-vite',
        deploymentId: depId,
        artifactPath: buildRes.artifactPath,
      });

      const res = await fetch(`http://localhost:${testPort}/`, {
        headers: {
          'X-Forwarded-Host': `${depId}.localhost:${testPort}`,
          Host: `${depId}.localhost:${testPort}`,
        },
      });
      expect(res.status).toBe(200);
      const text = await res.text();
      expect(text).toContain('React App Running');
    });
  });

  // ─── TEST 3: Single-Page Application (SPA) Routing ────────────────────────────
  describe('Test 3: SPA Client-Side Routing and Asset 404', () => {
    it('serves index.html for client routes and returns 404 for missing static assets', async () => {
      const depId = 'spa-dep-' + Date.now();
      const storageBase = (provider as any).storageBaseDir;
      const targetDir = path.join(storageBase, depId);
      fs.mkdirSync(targetDir, { recursive: true });
      fs.writeFileSync(
        path.join(targetDir, 'index.html'),
        '<!DOCTYPE html><html><body><h1>Client Router Loaded</h1></body></html>'
      );

      // Deep client route without extension -> should receive index.html with HTTP 200
      const clientRes = await fetch(`http://localhost:${testPort}/users/42/settings`, {
        headers: {
          'X-Forwarded-Host': `${depId}.localhost:${testPort}`,
          Host: `${depId}.localhost:${testPort}`,
        },
      });
      expect(clientRes.status).toBe(200);
      const text = await clientRes.text();
      expect(text).toContain('Client Router Loaded');

      // Nonexistent asset with extension -> must return HTTP 404
      const missingRes = await fetch(`http://localhost:${testPort}/static/bundle.notfound.js`, {
        headers: {
          'X-Forwarded-Host': `${depId}.localhost:${testPort}`,
          Host: `${depId}.localhost:${testPort}`,
        },
      });
      expect(missingRes.status).toBe(404);
    });
  });

  // ─── TEST 4: Next.js Static Export ───────────────────────────────────────────
  describe('Test 4: Next.js Static Export', () => {
    it('detects static export from next.config.js and serves out/ directory', async () => {
      const appDir = path.join(tmpBase, 'next-static');
      fs.mkdirSync(path.join(appDir, 'out'), { recursive: true });
      fs.writeFileSync(
        path.join(appDir, 'package.json'),
        JSON.stringify({ dependencies: { next: '14.2.0', react: '18.2.0' } })
      );
      fs.writeFileSync(
        path.join(appDir, 'next.config.js'),
        "module.exports = { output: 'export' };"
      );
      fs.writeFileSync(
        path.join(appDir, 'out', 'index.html'),
        '<!DOCTYPE html><html><body><h1>Next Static Export OK</h1></body></html>'
      );

      const detected = detectFramework(appDir);
      expect(detected.framework).toBe(ProjectFramework.NEXTJS);
      expect(detected.deploymentMode).toBe(DeploymentMode.STATIC);
      expect(detected.outputDirectory).toBe('out');
      expect(detected.isServerRendered).toBe(false);

      const depId = 'next-export-' + Date.now();
      await provider.deploy({
        projectId: 'proj-next-export',
        deploymentId: depId,
        artifactPath: path.join(appDir, 'out'),
      });

      const res = await fetch(`http://localhost:${testPort}/`, {
        headers: {
          'X-Forwarded-Host': `${depId}.localhost:${testPort}`,
          Host: `${depId}.localhost:${testPort}`,
        },
      });
      expect(res.status).toBe(200);
      const text = await res.text();
      expect(text).toContain('Next Static Export OK');
    });
  });

  // ─── TEST 5: Next.js Server-Side Rendering (SSR) ─────────────────────────────
  describe('Test 5: Next.js Server-Side Rendering', () => {
    let mockServer: http.Server;
    let mockPort: number;
    const depId = 'next-ssr-' + Date.now();

    beforeAll(async () => {
      mockServer = http.createServer((req, res) => {
        if (req.url === '/') {
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end('<h1>Server Rendered Home</h1>');
        } else if (req.url === '/posts/hello-world') {
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end('<h1>Server Rendered Post: hello-world</h1>');
        } else {
          res.writeHead(404);
          res.end('Not Found');
        }
      });

      await new Promise<void>((resolve) => {
        mockServer.listen(0, '127.0.0.1', () => {
          const addr = mockServer.address() as any;
          mockPort = addr.port;
          resolve();
        });
      });

      const rm = RuntimeProcessManager.getInstance();
      (rm as any).runtimes.set(depId, {
        deploymentId: depId,
        projectId: 'proj-ssr',
        port: mockPort,
        process: { killed: false, kill: () => {} },
        workingDir: '/tmp',
        startTime: new Date(),
        status: 'READY',
      });
    });

    afterAll(async () => {
      if (mockServer) {
        await new Promise((r) => mockServer.close(r));
      }
      const rm = RuntimeProcessManager.getInstance();
      (rm as any).runtimes.delete(depId);
    });

    it('proxies root and dynamic routes to running SSR process and passes health checks', async () => {
      // Test root route
      const homeRes = await fetch(`http://localhost:${testPort}/`, {
        headers: {
          'X-Forwarded-Host': `${depId}.localhost:${testPort}`,
          Host: `${depId}.localhost:${testPort}`,
        },
      });
      expect(homeRes.status).toBe(200);
      const homeText = await homeRes.text();
      expect(homeText).toContain('Server Rendered Home');

      // Test dynamic route
      const postRes = await fetch(`http://localhost:${testPort}/posts/hello-world`, {
        headers: {
          'X-Forwarded-Host': `${depId}.localhost:${testPort}`,
          Host: `${depId}.localhost:${testPort}`,
        },
      });
      expect(postRes.status).toBe(200);
      const postText = await postRes.text();
      expect(postText).toContain('Server Rendered Post: hello-world');

      // Test health check
      const status = await provider.getStatus(`local-${depId}`);
      expect(status.status).toBe('READY');
    });
  });

  // ─── TEST 6: Monorepo Application ─────────────────────────────────────────────
  describe('Test 6: Monorepo Application with Nested Root', () => {
    it('detects and builds nested application in apps/web', async () => {
      const monorepoDir = path.join(tmpBase, 'monorepo');
      fs.mkdirSync(path.join(monorepoDir, 'apps', 'web', 'dist'), { recursive: true });
      fs.mkdirSync(path.join(monorepoDir, 'apps', 'api'), { recursive: true });

      fs.writeFileSync(
        path.join(monorepoDir, 'package.json'),
        JSON.stringify({ name: 'root-monorepo', workspaces: ['apps/*'] })
      );
      fs.writeFileSync(path.join(monorepoDir, 'pnpm-workspace.yaml'), "packages:\n  - 'apps/*'\n");

      fs.writeFileSync(
        path.join(monorepoDir, 'apps', 'web', 'package.json'),
        JSON.stringify({
          name: 'web',
          dependencies: { vite: '5.0.0' },
          scripts: { build: 'echo "building apps/web"' },
        })
      );
      fs.writeFileSync(
        path.join(monorepoDir, 'apps', 'web', 'dist', 'index.html'),
        '<!DOCTYPE html><html><body><h1>Monorepo Web App</h1></body></html>'
      );

      // Verify resolution with explicit rootDirectory
      const resolved = resolveProjectRoot(monorepoDir, 'apps/web');
      expect(resolved.rootPath).toBe(path.resolve(monorepoDir, 'apps/web'));
      expect(resolved.isMonorepo).toBe(true);

      // Verify automatic framework detection inside resolved root
      const detected = detectFramework(resolved.rootPath);
      expect(detected.framework).toBe(ProjectFramework.REACT_VITE);

      // Verify building within monorepo root
      const executor = new ProcessBuildExecutor();
      const buildRes = await executor.executeBuild({
        workspacePath: resolved.rootPath,
        installCwd: monorepoDir,
        buildCommand: 'echo "Monorepo build"',
        outputDirectory: 'dist',
        envVars: {},
        redactor: new SecretRedactor(),
        onLog: async () => {},
      });
      expect(buildRes.success).toBe(true);
      expect(buildRes.artifactPath).toContain('apps');
    });
  });

  // ─── TEST 7: Package Manager Handling ────────────────────────────────────────
  describe('Test 7: Package Manager Handling & Lockfile Selection', () => {
    it('correctly resolves pnpm and yarn lockfiles without ambiguity', () => {
      const pnpmDir = path.join(tmpBase, 'pnpm-test');
      fs.mkdirSync(pnpmDir, { recursive: true });
      fs.writeFileSync(path.join(pnpmDir, 'package.json'), JSON.stringify({ dependencies: { vite: '5.0.0' } }));
      fs.writeFileSync(path.join(pnpmDir, 'pnpm-lock.yaml'), '');

      const pnpmDet = detectFramework(pnpmDir);
      expect(pnpmDet.packageManager).toBe('pnpm');
      expect(pnpmDet.installCommand).toBe('pnpm install --frozen-lockfile');

      const yarnDir = path.join(tmpBase, 'yarn-test');
      fs.mkdirSync(yarnDir, { recursive: true });
      fs.writeFileSync(path.join(yarnDir, 'package.json'), JSON.stringify({ dependencies: { vite: '5.0.0' } }));
      fs.writeFileSync(path.join(yarnDir, 'yarn.lock'), '');

      const yarnDet = detectFramework(yarnDir);
      expect(yarnDet.packageManager).toBe('yarn');
      expect(yarnDet.installCommand).toBe('yarn install --frozen-lockfile');
    });
  });

  // ─── TEST 8: Build Failures & Process Termination ─────────────────────────────
  describe('Test 8: Build Failures and Nonzero Exit Codes', () => {
    it('marks build as failed when command exits with nonzero exit code', async () => {
      const appDir = path.join(tmpBase, 'fail-app');
      fs.mkdirSync(appDir, { recursive: true });
      const executor = new ProcessBuildExecutor();

      const failCommand = process.platform === 'win32' ? 'exit /b 42' : 'exit 42';
      const res = await executor.executeBuild({
        workspacePath: appDir,
        buildCommand: failCommand,
        outputDirectory: 'dist',
        envVars: {},
        redactor: new SecretRedactor(),
        onLog: async () => {},
      });

      expect(res.success).toBe(false);
      expect(res.exitCode).toBe(42);
      expect(res.errorMessage).toContain('code 42');
    });

    it('fails when expected output directory was not produced', async () => {
      const appDir = path.join(tmpBase, 'no-output-app');
      fs.mkdirSync(appDir, { recursive: true });
      const executor = new ProcessBuildExecutor();

      const res = await executor.executeBuild({
        workspacePath: appDir,
        buildCommand: 'echo "Done without producing dist"',
        outputDirectory: 'nonexistent-dist',
        envVars: {},
        redactor: new SecretRedactor(),
        onLog: async () => {},
      });

      expect(res.success).toBe(false);
      expect(res.errorMessage).toContain('was not generated');
    });
  });

  // ─── TEST 9: Runtime Failures ────────────────────────────────────────────────
  describe('Test 9: Runtime Failures', () => {
    it('detects unhealthy or failed runtime status', async () => {
      const failDepId = 'failed-ssr-' + Date.now();
      const rm = RuntimeProcessManager.getInstance();
      (rm as any).runtimes.set(failDepId, {
        deploymentId: failDepId,
        projectId: 'proj-fail',
        port: 9999,
        process: { killed: true, kill: () => {} },
        workingDir: '/tmp',
        startTime: new Date(),
        status: 'FAILED',
      });

      const status = await provider.getStatus(`local-${failDepId}`);
      expect(status.status).toBe('ERROR');
      expect(status.message).toContain('FAILED');

      (rm as any).runtimes.delete(failDepId);
    });
  });

  // ─── TEST 10: Concurrent Deployments & Isolation ─────────────────────────────
  describe('Test 10: Concurrent Deployments and Isolation', () => {
    it('maintains strict directory and routing isolation between parallel deployments', async () => {
      const depA = 'concurrent-a-' + Date.now();
      const depB = 'concurrent-b-' + Date.now();
      const storageBase = (provider as any).storageBaseDir;

      const dirA = path.join(storageBase, depA);
      const dirB = path.join(storageBase, depB);
      fs.mkdirSync(dirA, { recursive: true });
      fs.mkdirSync(dirB, { recursive: true });

      fs.writeFileSync(path.join(dirA, 'index.html'), '<html><body>Tenant A Project</body></html>');
      fs.writeFileSync(path.join(dirB, 'index.html'), '<html><body>Tenant B Project</body></html>');

      // Request both simultaneously via their respective subdomains
      const [resA, resB] = await Promise.all([
        fetch(`http://localhost:${testPort}/`, {
          headers: {
            'X-Forwarded-Host': `${depA}.localhost:${testPort}`,
            Host: `${depA}.localhost:${testPort}`,
          },
        }),
        fetch(`http://localhost:${testPort}/`, {
          headers: {
            'X-Forwarded-Host': `${depB}.localhost:${testPort}`,
            Host: `${depB}.localhost:${testPort}`,
          },
        }),
      ]);

      expect(resA.status).toBe(200);
      expect(resB.status).toBe(200);

      const textA = await resA.text();
      const textB = await resB.text();

      expect(textA).toContain('Tenant A Project');
      expect(textB).toContain('Tenant B Project');
      expect(textA).not.toContain('Tenant B');
    });
  });

  // ─── TEST 11: Queue Reliability & Idempotency ────────────────────────────────
  describe('Test 11: Queue Reliability & State Transitions', () => {
    it('enforces valid state machine transitions', async () => {
      const { canTransition, DeploymentStatus } = await import('@deployforge/shared-types');
      expect(canTransition(DeploymentStatus.QUEUED, DeploymentStatus.PREPARING)).toBe(true);
      expect(canTransition(DeploymentStatus.PREPARING, DeploymentStatus.BUILDING)).toBe(true);
      expect(canTransition(DeploymentStatus.BUILDING, DeploymentStatus.DEPLOYING)).toBe(true);
      expect(canTransition(DeploymentStatus.DEPLOYING, DeploymentStatus.SUCCEEDED)).toBe(true);
      // Illegal backward transition
      expect(canTransition(DeploymentStatus.SUCCEEDED, DeploymentStatus.BUILDING)).toBe(false);
      // Terminal state cannot transition
      expect(canTransition(DeploymentStatus.FAILED, DeploymentStatus.BUILDING)).toBe(false);
    });
  });

  // ─── TEST 12: Security Boundaries ────────────────────────────────────────────
  describe('Test 12: Security Boundaries', () => {
    it('blocks directory traversal outside the deployment root', async () => {
      const testDep = 'sec-dep-' + Date.now();
      const storageBase = (provider as any).storageBaseDir;
      const targetDir = path.join(storageBase, testDep);
      fs.mkdirSync(targetDir, { recursive: true });
      fs.writeFileSync(path.join(targetDir, 'index.html'), '<html><body>Secure App</body></html>');

      const traversalRes = await fetch(`http://localhost:${testPort}/../../package.json`, {
        headers: {
          'X-Forwarded-Host': `${testDep}.localhost:${testPort}`,
          Host: `${testDep}.localhost:${testPort}`,
        },
      });
      expect([403, 404]).toContain(traversalRes.status);
    });

    it('blocks access to protected resources like .env and package.json', async () => {
      const testDep = 'sec-dep-env-' + Date.now();
      const storageBase = (provider as any).storageBaseDir;
      const targetDir = path.join(storageBase, testDep);
      fs.mkdirSync(targetDir, { recursive: true });
      fs.writeFileSync(path.join(targetDir, 'index.html'), '<html><body>Secure App</body></html>');
      fs.writeFileSync(path.join(targetDir, '.env'), 'SECRET=leaked');

      const envRes = await fetch(`http://localhost:${testPort}/.env`, {
        headers: {
          'X-Forwarded-Host': `${testDep}.localhost:${testPort}`,
          Host: `${testDep}.localhost:${testPort}`,
        },
      });
      expect(envRes.status).toBe(403);
    });

    it('redacts configured sensitive environment secrets from logs', () => {
      const redactor = new SecretRedactor();
      redactor.addSecret('SuperSecretPassword123');
      const logMessage = 'Connecting to postgres://admin:SuperSecretPassword123@neon.tech/db';
      const redacted = redactor.redact(logMessage);
      expect(redacted).not.toContain('SuperSecretPassword123');
      expect(redacted).toContain('[REDACTED_SECRET]');
    });
  });
});
