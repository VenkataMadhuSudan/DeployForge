import fs from 'node:fs';
import path from 'node:path';
import { ProjectFramework } from '@deployforge/shared-types';

export enum DeploymentMode {
  STATIC = 'STATIC',
  SSR_RUNTIME = 'SSR_RUNTIME',
}

export interface DetectedFrameworkConfig {
  framework: ProjectFramework;
  installCommand: string;
  buildCommand: string;
  outputDirectory: string;
  deploymentMode: DeploymentMode;
  startCommand?: string;
  isServerRendered?: boolean;
}

export function detectFramework(workspacePath: string): DetectedFrameworkConfig {
  const pkgJsonPath = path.join(workspacePath, 'package.json');

  if (fs.existsSync(pkgJsonPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8'));
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };

      // Determine package manager
      let installCommand = 'npm install';
      if (fs.existsSync(path.join(workspacePath, 'package-lock.json'))) {
        installCommand = 'npm ci';
      } else if (fs.existsSync(path.join(workspacePath, 'pnpm-lock.yaml'))) {
        installCommand = 'pnpm install --frozen-lockfile';
      } else if (fs.existsSync(path.join(workspacePath, 'yarn.lock'))) {
        installCommand = 'yarn install --frozen-lockfile';
      } else if (fs.existsSync(path.join(workspacePath, 'bun.lockb')) || fs.existsSync(path.join(workspacePath, 'bun.lock'))) {
        installCommand = 'bun install';
      }

      // Check for Prisma schema and ensure client generation
      const hasPrisma = fs.existsSync(path.join(workspacePath, 'prisma', 'schema.prisma'));
      if (hasPrisma) {
        installCommand = `${installCommand} && npx prisma generate`;
      }

      // Check Next.js
      if (deps['next']) {
        let isStaticExport = false;
        // Check for next export in scripts
        if (pkg.scripts?.build && /next\s+export/.test(pkg.scripts.build)) {
          isStaticExport = true;
        }

        // Check next.config.js / mjs / ts for output: 'export'
        const configFiles = ['next.config.js', 'next.config.mjs', 'next.config.ts'];
        for (const cf of configFiles) {
          const cfgPath = path.join(workspacePath, cf);
          if (fs.existsSync(cfgPath)) {
            const content = fs.readFileSync(cfgPath, 'utf8');
            if (/output\s*:\s*['"]export['"]/.test(content)) {
              isStaticExport = true;
              break;
            }
          }
        }

        return {
          framework: ProjectFramework.NEXTJS,
          installCommand,
          buildCommand: 'npm run build',
          outputDirectory: isStaticExport ? 'out' : '.next',
          deploymentMode: isStaticExport ? DeploymentMode.STATIC : DeploymentMode.SSR_RUNTIME,
          startCommand: isStaticExport ? undefined : 'next start',
          isServerRendered: !isStaticExport,
        };
      }

      // Check Vite
      if (deps['vite']) {
        return {
          framework: ProjectFramework.REACT_VITE,
          installCommand,
          buildCommand: 'npm run build',
          outputDirectory: 'dist',
          deploymentMode: DeploymentMode.STATIC,
          isServerRendered: false,
        };
      }

      // Check Create React App (react-scripts)
      if (deps['react-scripts']) {
        return {
          framework: ProjectFramework.STATIC,
          installCommand,
          buildCommand: 'npm run build',
          outputDirectory: 'build',
          deploymentMode: DeploymentMode.STATIC,
          isServerRendered: false,
        };
      }

      // Standard node build
      if (pkg.scripts?.build) {
        const isCRA = /react-scripts\s+build/.test(pkg.scripts.build);
        return {
          framework: ProjectFramework.STATIC,
          installCommand,
          buildCommand: 'npm run build',
          outputDirectory: isCRA ? 'build' : 'dist',
          deploymentMode: DeploymentMode.STATIC,
          isServerRendered: false,
        };
      }
    } catch {
      // JSON parse fallback
    }
  }

  // Fallback to static HTML
  const hasPublicDir = fs.existsSync(path.join(workspacePath, 'public'));
  return {
    framework: ProjectFramework.STATIC,
    installCommand: 'echo "No dependencies to install"',
    buildCommand: 'echo "Static build ready"',
    outputDirectory: hasPublicDir ? 'public' : '.',
    deploymentMode: DeploymentMode.STATIC,
    isServerRendered: false,
  };
}
