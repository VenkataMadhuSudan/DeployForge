import fs from 'node:fs';
import path from 'node:path';
import { ProjectFramework } from '@deployforge/shared-types';

export interface DetectedFrameworkConfig {
  framework: ProjectFramework;
  installCommand: string;
  buildCommand: string;
  outputDirectory: string;
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
      }

      // Check Next.js
      if (deps['next']) {
        return {
          framework: ProjectFramework.NEXTJS,
          installCommand,
          buildCommand: 'npm run build',
          outputDirectory: '.next',
        };
      }

      // Check Vite
      if (deps['vite']) {
        return {
          framework: ProjectFramework.REACT_VITE,
          installCommand,
          buildCommand: 'npm run build',
          outputDirectory: 'dist',
        };
      }

      // Standard node build
      if (pkg.scripts?.build) {
        return {
          framework: ProjectFramework.STATIC,
          installCommand,
          buildCommand: 'npm run build',
          outputDirectory: 'dist',
        };
      }
    } catch {
      // JSON parse fallback
    }
  }

  // Fallback to static HTML
  return {
    framework: ProjectFramework.STATIC,
    installCommand: 'echo "No dependencies to install"',
    buildCommand: 'echo "Static build ready"',
    outputDirectory: fs.existsSync(path.join(workspacePath, 'public')) ? 'public' : '.',
  };
}
