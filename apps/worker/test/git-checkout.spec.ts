import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execSync } from 'node:child_process';
import { DeploymentWorkerService } from '../src/orchestrator/deployment-worker';
import { SecretRedactor } from '@deployforge/logging';
import { DeploymentJobData, HostingProviderType, ProjectFramework } from '@deployforge/shared-types';

describe('Repository Checkout (cloneRepository)', () => {
  let workerService: DeploymentWorkerService;
  let redactor: SecretRedactor;
  let tmpBaseDir: string;
  let localGitRepoDir: string;

  beforeAll(() => {
    workerService = new DeploymentWorkerService();
    redactor = new SecretRedactor();
    tmpBaseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'df-git-test-'));

    // Create a local Git fixture repository to test real git clone safely
    localGitRepoDir = path.join(tmpBaseDir, 'fixture-repo');
    fs.mkdirSync(localGitRepoDir, { recursive: true });
    execSync('git init -b main', { cwd: localGitRepoDir, stdio: 'ignore' });
    execSync('git config user.email "test@deployforge.local"', { cwd: localGitRepoDir, stdio: 'ignore' });
    execSync('git config user.name "DeployForge Tester"', { cwd: localGitRepoDir, stdio: 'ignore' });

    fs.writeFileSync(path.join(localGitRepoDir, 'index.html'), '<h1>Fixture Site</h1>');
    fs.writeFileSync(path.join(localGitRepoDir, 'style.css'), 'body { color: red; }');
    execSync('git add .', { cwd: localGitRepoDir, stdio: 'ignore' });
    execSync('git commit -m "initial commit"', { cwd: localGitRepoDir, stdio: 'ignore' });
  });

  afterAll(() => {
    try {
      if (fs.existsSync(tmpBaseDir)) {
        fs.rmSync(tmpBaseDir, { recursive: true, force: true });
      }
    } catch {
      // ignore
    }
  });

  const dummyLog = async () => {};

  it('rejects missing repository URL', async () => {
    const targetDir = path.join(tmpBaseDir, 'target-1');
    const jobData: DeploymentJobData = {
      deploymentId: 'd-1',
      projectId: 'p-1',
      commitSha: '0000000000000000000000000000000000000000',
      branch: 'main',
      triggerType: 'MANUAL' as any,
      repoUrl: '',
      framework: ProjectFramework.STATIC,
      outputDirectory: 'dist',
      provider: HostingProviderType.LOCAL_TESTING,
      environment: 'PRODUCTION' as any,
    };

    await expect((workerService as any).cloneRepository(targetDir, jobData, redactor, dummyLog)).rejects.toThrow(
      'Repository URL is required'
    );
  });

  it('blocks argument injection starting with hyphen in repoUrl', async () => {
    const targetDir = path.join(tmpBaseDir, 'target-2');
    const jobData: DeploymentJobData = {
      deploymentId: 'd-2',
      projectId: 'p-1',
      commitSha: '0000000000000000000000000000000000000000',
      branch: 'main',
      triggerType: 'MANUAL' as any,
      repoUrl: '--upload-pack=malicious',
      framework: ProjectFramework.STATIC,
      outputDirectory: 'dist',
      provider: HostingProviderType.LOCAL_TESTING,
      environment: 'PRODUCTION' as any,
    };

    await expect((workerService as any).cloneRepository(targetDir, jobData, redactor, dummyLog)).rejects.toThrow(
      'cannot start with a hyphen'
    );
  });

  it('blocks invalid branch names containing command injection characters', async () => {
    const targetDir = path.join(tmpBaseDir, 'target-3');
    const jobData: DeploymentJobData = {
      deploymentId: 'd-3',
      projectId: 'p-1',
      commitSha: '0000000000000000000000000000000000000000',
      branch: 'main; rm -rf /',
      triggerType: 'MANUAL' as any,
      repoUrl: 'https://github.com/example/repo',
      framework: ProjectFramework.STATIC,
      outputDirectory: 'dist',
      provider: HostingProviderType.LOCAL_TESTING,
      environment: 'PRODUCTION' as any,
    };

    await expect((workerService as any).cloneRepository(targetDir, jobData, redactor, dummyLog)).rejects.toThrow(
      'Invalid branch name'
    );
  });

  it('successfully clones real local fixture repository and verifies files', async () => {
    const targetDir = path.join(tmpBaseDir, 'target-clone-success');
    const fileUrl = 'file://' + path.resolve(localGitRepoDir).replace(/\\/g, '/');
    const jobData: DeploymentJobData = {
      deploymentId: 'd-4',
      projectId: 'p-1',
      commitSha: '0000000000000000000000000000000000000000',
      branch: 'main',
      triggerType: 'MANUAL' as any,
      repoUrl: fileUrl,
      framework: ProjectFramework.STATIC,
      outputDirectory: 'dist',
      provider: HostingProviderType.LOCAL_TESTING,
      environment: 'PRODUCTION' as any,
    };

    await (workerService as any).cloneRepository(targetDir, jobData, redactor, dummyLog);

    expect(fs.existsSync(path.join(targetDir, 'index.html'))).toBe(true);
    expect(fs.readFileSync(path.join(targetDir, 'index.html'), 'utf8')).toBe('<h1>Fixture Site</h1>');
    expect(fs.existsSync(path.join(targetDir, 'style.css'))).toBe(true);
  });
});
