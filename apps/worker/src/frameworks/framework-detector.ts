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
  packageManager: 'npm' | 'pnpm' | 'yarn' | 'bun';
}

export interface ProjectRootResolution {
  rootPath: string;
  relativeRoot: string;
  isMonorepo: boolean;
  warnings: string[];
}

/**
 * Resolves the effective application project root within a workspace.
 * Validates configuredRoot to prevent path traversal and auto-detects
 * monorepo subdirectories (apps/web, frontend, client, etc.) when needed.
 */
export function resolveProjectRoot(
  workspacePath: string,
  configuredRoot?: string | null
): ProjectRootResolution {
  const warnings: string[] = [];
  const normalizedWorkspace = path.resolve(workspacePath);

  // 1. If configuredRoot is provided, validate strictly
  if (configuredRoot && configuredRoot.trim()) {
    const trimmed = configuredRoot.trim().replace(/^[\\/]+/, '');
    const candidate = path.resolve(normalizedWorkspace, trimmed);
    const rel = path.relative(normalizedWorkspace, candidate);

    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      throw new Error(`Security violation: configured root directory '${configuredRoot}' traverses outside workspace.`);
    }

    if (!fs.existsSync(candidate) || !fs.statSync(candidate).isDirectory()) {
      throw new Error(`Configured root directory '${configuredRoot}' does not exist in repository.`);
    }

    const isMonorepo =
      fs.existsSync(path.join(normalizedWorkspace, 'pnpm-workspace.yaml')) ||
      fs.existsSync(path.join(normalizedWorkspace, 'turbo.json'));

    return {
      rootPath: candidate,
      relativeRoot: trimmed,
      isMonorepo,
      warnings,
    };
  }

  // 2. Check if root contains a recognized web application package.json or public directory
  const rootPkgPath = path.join(normalizedWorkspace, 'package.json');
  let rootHasWebApp = false;
  let rootIsMonorepo = false;

  if (fs.existsSync(rootPkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(rootPkgPath, 'utf8'));
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };
      if (
        deps['next'] ||
        deps['vite'] ||
        deps['react-scripts'] ||
        deps['vue'] ||
        deps['svelte'] ||
        pkg.scripts?.build
      ) {
        rootHasWebApp = true;
      }
      if (
        pkg.workspaces ||
        fs.existsSync(path.join(normalizedWorkspace, 'pnpm-workspace.yaml')) ||
        fs.existsSync(path.join(normalizedWorkspace, 'turbo.json'))
      ) {
        rootIsMonorepo = true;
      }
    } catch {
      // ignore
    }
  }

  // If root has a web app and is not purely an orchestrating monorepo root, use root
  if (rootHasWebApp && !rootIsMonorepo) {
    return {
      rootPath: normalizedWorkspace,
      relativeRoot: '',
      isMonorepo: false,
      warnings,
    };
  }

  // 3. Search common frontend directories in monorepos
  const candidateDirs = [
    'apps/web',
    'apps/frontend',
    'apps/client',
    'packages/web',
    'packages/frontend',
    'packages/client',
    'frontend',
    'client',
    'web',
  ];

  for (const candidate of candidateDirs) {
    const candidatePath = path.resolve(normalizedWorkspace, candidate);
    if (fs.existsSync(candidatePath) && fs.statSync(candidatePath).isDirectory()) {
      const candidatePkg = path.join(candidatePath, 'package.json');
      if (fs.existsSync(candidatePkg)) {
        try {
          const pkg = JSON.parse(fs.readFileSync(candidatePkg, 'utf8'));
          const deps = { ...pkg.dependencies, ...pkg.devDependencies };
          if (
            deps['next'] ||
            deps['vite'] ||
            deps['react-scripts'] ||
            deps['vue'] ||
            deps['svelte'] ||
            pkg.scripts?.build
          ) {
            warnings.push(`Auto-detected application root directory: '${candidate}'`);
            return {
              rootPath: candidatePath,
              relativeRoot: candidate,
              isMonorepo: true,
              warnings,
            };
          }
        } catch {
          // ignore
        }
      }
    }
  }

  return {
    rootPath: normalizedWorkspace,
    relativeRoot: '',
    isMonorepo: rootIsMonorepo,
    warnings,
  };
}

export function detectFramework(workspacePath: string): DetectedFrameworkConfig {
  const pkgJsonPath = path.join(workspacePath, 'package.json');

  if (fs.existsSync(pkgJsonPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8'));
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };

      // Determine package manager and appropriate install/build commands
      let packageManager: 'npm' | 'pnpm' | 'yarn' | 'bun' = 'npm';
      let installCommand = 'npm install';
      let defaultBuild = 'npm run build';

      const hasPnpmLock = fs.existsSync(path.join(workspacePath, 'pnpm-lock.yaml')) || fs.existsSync(path.join(workspacePath, '..', 'pnpm-lock.yaml'));
      const hasYarnLock = fs.existsSync(path.join(workspacePath, 'yarn.lock')) || fs.existsSync(path.join(workspacePath, '..', 'yarn.lock'));
      const hasBunLock = fs.existsSync(path.join(workspacePath, 'bun.lockb')) || fs.existsSync(path.join(workspacePath, 'bun.lock'));
      const hasNpmLock = fs.existsSync(path.join(workspacePath, 'package-lock.json'));

      if (hasPnpmLock) {
        packageManager = 'pnpm';
        installCommand = 'pnpm install --frozen-lockfile';
        defaultBuild = 'pnpm run build';
      } else if (hasYarnLock) {
        packageManager = 'yarn';
        installCommand = 'yarn install --frozen-lockfile';
        defaultBuild = 'yarn build';
      } else if (hasBunLock) {
        packageManager = 'bun';
        installCommand = 'bun install';
        defaultBuild = 'bun run build';
      } else if (hasNpmLock) {
        packageManager = 'npm';
        installCommand = 'npm ci';
        defaultBuild = 'npm run build';
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
          buildCommand: defaultBuild,
          outputDirectory: isStaticExport ? 'out' : '.next',
          deploymentMode: isStaticExport ? DeploymentMode.STATIC : DeploymentMode.SSR_RUNTIME,
          startCommand: isStaticExport ? undefined : 'next start',
          isServerRendered: !isStaticExport,
          packageManager,
        };
      }

      // Check Vite
      if (deps['vite']) {
        return {
          framework: ProjectFramework.REACT_VITE,
          installCommand,
          buildCommand: defaultBuild,
          outputDirectory: 'dist',
          deploymentMode: DeploymentMode.STATIC,
          isServerRendered: false,
          packageManager,
        };
      }

      // Check Create React App (react-scripts)
      if (deps['react-scripts']) {
        return {
          framework: ProjectFramework.STATIC,
          installCommand,
          buildCommand: defaultBuild,
          outputDirectory: 'build',
          deploymentMode: DeploymentMode.STATIC,
          isServerRendered: false,
          packageManager,
        };
      }

      // Standard node build
      if (pkg.scripts?.build) {
        const isCRA = /react-scripts\s+build/.test(pkg.scripts.build);
        return {
          framework: ProjectFramework.STATIC,
          installCommand,
          buildCommand: defaultBuild,
          outputDirectory: isCRA ? 'build' : 'dist',
          deploymentMode: DeploymentMode.STATIC,
          isServerRendered: false,
          packageManager,
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
    packageManager: 'npm',
  };
}
