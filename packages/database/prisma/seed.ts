import 'dotenv/config';
import { PrismaClient, UserRole, ProjectFramework, HostingProviderType } from '@prisma/client';
import argon2 from 'argon2';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding initial development database...');

  const passwordHash = await argon2.hash('DeployForge2026!', {
    type: argon2.argon2id,
    memoryCost: 65536,
    timeCost: 3,
    parallelism: 4,
  });

  const devUser = await prisma.user.upsert({
    where: { email: 'dev@deployforge.local' },
    update: {},
    create: {
      email: 'dev@deployforge.local',
      passwordHash,
      name: 'Developer Admin',
      role: UserRole.ADMIN,
    },
  });

  console.log(`Created test user: ${devUser.email} (ID: ${devUser.id})`);

  const demoProject = await prisma.project.upsert({
    where: {
      ownerId_slug: {
        ownerId: devUser.id,
        slug: 'demo-static-site',
      },
    },
    update: {},
    create: {
      name: 'Demo Static Site',
      slug: 'demo-static-site',
      ownerId: devUser.id,
      repoProvider: 'GITHUB',
      repoUrl: 'https://github.com/deployforge-demos/static-demo',
      repoOwner: 'deployforge-demos',
      repoName: 'static-demo',
      defaultBranch: 'main',
      framework: ProjectFramework.STATIC,
      buildCommand: null,
      outputDirectory: 'dist',
      deploymentProvider: HostingProviderType.LOCAL_TESTING,
    },
  });

  console.log(`Created demo project: ${demoProject.name} (ID: ${demoProject.id})`);
  console.log('Database seeding finished.');
}

main()
  .catch((e) => {
    console.error('Seeding failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
