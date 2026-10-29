import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';
import { Queue } from 'bullmq';
import Redis from 'ioredis';
import { loadConfig, getRedisConnectionOptions } from '@deployforge/configuration';

const prisma = new PrismaClient();

async function withRetry<T>(opName: string, fn: () => Promise<T>, retries = 5, delayMs = 2000): Promise<T> {
  let lastErr: any;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err: any) {
      lastErr = err;
      console.warn(`[Retry ${attempt}/${retries}] ${opName} encountered error: ${err.code || err.message}. Reconnecting...`);
      try {
        await prisma.$disconnect();
        await new Promise((r) => setTimeout(r, delayMs));
        await prisma.$connect();
      } catch {
        // continue to next attempt
      }
    }
  }
  throw lastErr;
}

async function resetAllData() {
  console.log('===============================================================');
  console.log(' DeployForge: Complete Data & Storage Wipe');
  console.log('===============================================================\n');

  console.log('--- 1. Clearing PostgreSQL Database Records ---');

  // Delete in reverse dependency order to respect foreign key constraints
  const delLogs = await withRetry('delete DeploymentLog', () => prisma.deploymentLog.deleteMany());
  console.log(`Deleted DeploymentLogs: ${delLogs.count}`);

  const delArtifacts = await withRetry('delete BuildArtifact', () => prisma.buildArtifact.deleteMany());
  console.log(`Deleted BuildArtifacts: ${delArtifacts.count}`);

  const delDeployments = await withRetry('delete Deployment', () => prisma.deployment.deleteMany());
  console.log(`Deleted Deployments: ${delDeployments.count}`);

  const delEnv = await withRetry('delete EnvironmentVariable', () => prisma.environmentVariable.deleteMany());
  console.log(`Deleted EnvironmentVariables: ${delEnv.count}`);

  const delAudit = await withRetry('delete AuditLog', () => prisma.auditLog.deleteMany());
  console.log(`Deleted AuditLogs: ${delAudit.count}`);

  const delProjMem = await withRetry('delete ProjectMember', () => prisma.projectMember.deleteMany());
  console.log(`Deleted ProjectMembers: ${delProjMem.count}`);

  const delProjects = await withRetry('delete Project', () => prisma.project.deleteMany());
  console.log(`Deleted Projects: ${delProjects.count}`);

  const delOrgMem = await withRetry('delete OrganizationMember', () => prisma.organizationMember.deleteMany());
  console.log(`Deleted OrganizationMembers: ${delOrgMem.count}`);

  const delOrgs = await withRetry('delete Organization', () => prisma.organization.deleteMany());
  console.log(`Deleted Organizations: ${delOrgs.count}`);

  const delRepos = await withRetry('delete RepositoryIntegration', () => prisma.repositoryIntegration.deleteMany());
  console.log(`Deleted RepositoryIntegrations: ${delRepos.count}`);

  const delUsers = await withRetry('delete User', () => prisma.user.deleteMany());
  console.log(`Deleted Users (Sign-up Info): ${delUsers.count}`);

  const delWebhooks = await withRetry('delete WebhookEvent', () => prisma.webhookEvent.deleteMany());
  console.log(`Deleted WebhookEvents: ${delWebhooks.count}`);

  const delOutbox = await withRetry('delete OutboxEvent', () => prisma.outboxEvent.deleteMany());
  console.log(`Deleted OutboxEvents: ${delOutbox.count}`);

  console.log('\n--- 2. Clearing Redis BullMQ Queues and Keys ---');
  try {
    const config = loadConfig();
    const redisOptions = getRedisConnectionOptions(config);

    // Obliterate BullMQ queue
    const queue = new Queue('deployments', { connection: redisOptions });
    await queue.obliterate({ force: true });
    await queue.close();
    console.log('BullMQ deployments queue obliterated successfully.');

    // Connect via ioredis and flush Redis database
    const redis = new Redis(redisOptions);
    const existingKeys = await redis.keys('*');
    console.log(`Found ${existingKeys.length} Redis key(s) to purge.`);
    if (existingKeys.length > 0) {
      await redis.flushdb();
      console.log('Redis database flushed successfully.');
    }
    await redis.quit();
  } catch (err: any) {
    console.warn(`Redis cleanup note: ${err?.message || err}`);
  }

  console.log('\n--- 3. Cleaning Local Cloned Repositories, Workspaces & Deployments ---');
  const storagePaths = [
    path.resolve(process.cwd(), 'apps/worker/storage/workspaces'),
    path.resolve(process.cwd(), 'apps/worker/storage/deployments'),
    path.resolve(process.cwd(), 'apps/worker/storage/runtimes'),
    path.resolve(process.cwd(), 'storage/workspaces'),
    path.resolve(process.cwd(), 'storage/artifacts'),
    path.resolve(process.cwd(), 'storage/deployments'),
    path.resolve(process.cwd(), 'storage/runtimes'),
  ];

  let removedItemsCount = 0;
  for (const dir of storagePaths) {
    if (fs.existsSync(dir)) {
      const files = fs.readdirSync(dir);
      for (const file of files) {
        const fullPath = path.join(dir, file);
        try {
          fs.rmSync(fullPath, { recursive: true, force: true });
          console.log(`Removed storage item: ${fullPath}`);
          removedItemsCount++;
        } catch (e: any) {
          console.warn(`Could not remove ${fullPath}: ${e.message}`);
        }
      }
    }
  }
  console.log(`Total storage items cleaned: ${removedItemsCount}`);

  console.log('\n--- 4. Verifying Empty Database State ---');
  const finalCounts = {
    users: await withRetry('count users', () => prisma.user.count()),
    organizations: await withRetry('count orgs', () => prisma.organization.count()),
    organizationMembers: await withRetry('count org members', () => prisma.organizationMember.count()),
    projects: await withRetry('count projects', () => prisma.project.count()),
    projectMembers: await withRetry('count project members', () => prisma.projectMember.count()),
    repositoryIntegrations: await withRetry('count repos', () => prisma.repositoryIntegration.count()),
    deployments: await withRetry('count deployments', () => prisma.deployment.count()),
    deploymentLogs: await withRetry('count logs', () => prisma.deploymentLog.count()),
    buildArtifacts: await withRetry('count artifacts', () => prisma.buildArtifact.count()),
    environmentVariables: await withRetry('count env', () => prisma.environmentVariable.count()),
    auditLogs: await withRetry('count audit', () => prisma.auditLog.count()),
    webhookEvents: await withRetry('count webhooks', () => prisma.webhookEvent.count()),
    outboxEvents: await withRetry('count outbox', () => prisma.outboxEvent.count()),
  };
  console.table(finalCounts);

  await prisma.$disconnect();
  console.log('\nAll logs, cloned items, sign-up information, and queues have been completely wiped clean.');
}

resetAllData().catch(async (err) => {
  console.error('Error during data reset:', err);
  await prisma.$disconnect();
  process.exit(1);
});


