import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';
import { Queue } from 'bullmq';
import { loadConfig, getRedisConnectionOptions } from '@deployforge/configuration';

const prisma = new PrismaClient();

async function resetAllData() {
  console.log('--- 1. Clearing PostgreSQL Database Records ---');

  // Delete in reverse dependency order
  const delLogs = await prisma.deploymentLog.deleteMany();
  console.log(`Deleted DeploymentLogs: ${delLogs.count}`);

  const delArtifacts = await prisma.buildArtifact.deleteMany();
  console.log(`Deleted BuildArtifacts: ${delArtifacts.count}`);

  const delDeployments = await prisma.deployment.deleteMany();
  console.log(`Deleted Deployments: ${delDeployments.count}`);

  const delEnv = await prisma.environmentVariable.deleteMany();
  console.log(`Deleted EnvironmentVariables: ${delEnv.count}`);

  const delAudit = await prisma.auditLog.deleteMany();
  console.log(`Deleted AuditLogs: ${delAudit.count}`);

  const delProjMem = await prisma.projectMember.deleteMany();
  console.log(`Deleted ProjectMembers: ${delProjMem.count}`);

  const delProjects = await prisma.project.deleteMany();
  console.log(`Deleted Projects: ${delProjects.count}`);

  const delOrgMem = await prisma.organizationMember.deleteMany();
  console.log(`Deleted OrganizationMembers: ${delOrgMem.count}`);

  const delOrgs = await prisma.organization.deleteMany();
  console.log(`Deleted Organizations: ${delOrgs.count}`);

  const delRepos = await prisma.repositoryIntegration.deleteMany();
  console.log(`Deleted RepositoryIntegrations: ${delRepos.count}`);

  const delUsers = await prisma.user.deleteMany();
  console.log(`Deleted Users: ${delUsers.count}`);

  const delWebhooks = await prisma.webhookEvent.deleteMany();
  console.log(`Deleted WebhookEvents: ${delWebhooks.count}`);

  const delOutbox = await prisma.outboxEvent.deleteMany();
  console.log(`Deleted OutboxEvents: ${delOutbox.count}`);

  console.log('\n--- 2. Clearing Redis BullMQ Queue ---');
  try {
    const config = loadConfig();
    const redisOptions = getRedisConnectionOptions(config);
    const queue = new Queue('deployments', { connection: redisOptions });
    await queue.obliterate({ force: true });
    await queue.close();
    console.log('BullMQ deployments queue obliterated successfully.');
  } catch (err: any) {
    console.warn(`Redis queue cleanup note: ${err?.message || err}`);
  }

  console.log('\n--- 3. Cleaning Local Workspace & Deployment Files ---');
  const storagePaths = [
    path.resolve(process.cwd(), 'apps/worker/storage/workspaces'),
    path.resolve(process.cwd(), 'apps/worker/storage/deployments'),
    path.resolve(process.cwd(), 'storage/workspaces'),
    path.resolve(process.cwd(), 'storage/artifacts'),
  ];

  for (const dir of storagePaths) {
    if (fs.existsSync(dir)) {
      const files = fs.readdirSync(dir);
      for (const file of files) {
        const fullPath = path.join(dir, file);
        try {
          fs.rmSync(fullPath, { recursive: true, force: true });
          console.log(`Removed local storage: ${fullPath}`);
        } catch (e: any) {
          console.warn(`Could not remove ${fullPath}: ${e.message}`);
        }
      }
    }
  }

  console.log('\n--- 4. Verifying Empty State ---');
  const counts = {
    users: await prisma.user.count(),
    projects: await prisma.project.count(),
    deployments: await prisma.deployment.count(),
    auditLogs: await prisma.auditLog.count(),
    outbox: await prisma.outboxEvent.count(),
  };
  console.log('Final counts:', counts);

  await prisma.$disconnect();
  console.log('\nAll data has been wiped clean.');
}

resetAllData().catch(async (err) => {
  console.error('Error during data reset:', err);
  await prisma.$disconnect();
  process.exit(1);
});
