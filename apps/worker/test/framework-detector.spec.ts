/**
 * Unit tests for the framework detector.
 * Uses tmp directories with synthetic package.json files
 * to verify detection heuristics without spawning real processes.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { detectFramework } from '../src/frameworks/framework-detector';
import { ProjectFramework } from '@deployforge/shared-types';

// ─── helpers ─────────────────────────────────────────────────────────────────
function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'df-test-'));
}

function writeJson(dir: string, filename: string, obj: object) {
  fs.writeFileSync(path.join(dir, filename), JSON.stringify(obj));
}

function touchFile(dir: string, filename: string) {
  fs.writeFileSync(path.join(dir, filename), '');
}

// ─── Fallback / static HTML ───────────────────────────────────────────────────
describe('detectFramework() — static fallback', () => {
  it('returns STATIC with echo commands for an empty directory', () => {
    const dir = makeTmpDir();
    const result = detectFramework(dir);
    expect(result.framework).toBe(ProjectFramework.STATIC);
    expect(result.installCommand).toContain('echo');
    expect(result.buildCommand).toContain('echo');
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('uses "public" as outputDirectory when public/ folder exists', () => {
    const dir = makeTmpDir();
    fs.mkdirSync(path.join(dir, 'public'));
    const result = detectFramework(dir);
    expect(result.outputDirectory).toBe('public');
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('uses "." as outputDirectory when public/ is absent', () => {
    const dir = makeTmpDir();
    const result = detectFramework(dir);
    expect(result.outputDirectory).toBe('.');
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

// ─── Next.js detection ────────────────────────────────────────────────────────
describe('detectFramework() — Next.js', () => {
  it('detects Next.js from dependencies', () => {
    const dir = makeTmpDir();
    writeJson(dir, 'package.json', { dependencies: { next: '14.0.0', react: '18.0.0' } });
    const result = detectFramework(dir);
    expect(result.framework).toBe(ProjectFramework.NEXTJS);
    expect(result.outputDirectory).toBe('.next');
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('detects Next.js from devDependencies', () => {
    const dir = makeTmpDir();
    writeJson(dir, 'package.json', { devDependencies: { next: '14.0.0' } });
    const result = detectFramework(dir);
    expect(result.framework).toBe(ProjectFramework.NEXTJS);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('prefers npm ci when package-lock.json exists', () => {
    const dir = makeTmpDir();
    writeJson(dir, 'package.json', { dependencies: { next: '14.0.0' } });
    touchFile(dir, 'package-lock.json');
    const result = detectFramework(dir);
    expect(result.installCommand).toBe('npm ci');
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('uses pnpm install when pnpm-lock.yaml exists', () => {
    const dir = makeTmpDir();
    writeJson(dir, 'package.json', { dependencies: { next: '14.0.0' } });
    touchFile(dir, 'pnpm-lock.yaml');
    const result = detectFramework(dir);
    expect(result.installCommand).toBe('pnpm install --frozen-lockfile');
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('uses yarn when yarn.lock exists', () => {
    const dir = makeTmpDir();
    writeJson(dir, 'package.json', { dependencies: { next: '14.0.0' } });
    touchFile(dir, 'yarn.lock');
    const result = detectFramework(dir);
    expect(result.installCommand).toBe('yarn install --frozen-lockfile');
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

// ─── Vite detection ───────────────────────────────────────────────────────────
describe('detectFramework() — Vite/React', () => {
  it('detects Vite from dependencies', () => {
    const dir = makeTmpDir();
    writeJson(dir, 'package.json', { devDependencies: { vite: '5.0.0', react: '18.0.0' } });
    const result = detectFramework(dir);
    expect(result.framework).toBe(ProjectFramework.REACT_VITE);
    expect(result.outputDirectory).toBe('dist');
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('does not confuse Vite project with Next.js', () => {
    const dir = makeTmpDir();
    writeJson(dir, 'package.json', { devDependencies: { vite: '5.0.0' } });
    const result = detectFramework(dir);
    expect(result.framework).toBe(ProjectFramework.REACT_VITE);
    expect(result.framework).not.toBe(ProjectFramework.NEXTJS);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

// ─── Generic Node build ───────────────────────────────────────────────────────
describe('detectFramework() — generic node build', () => {
  it('returns STATIC with npm run build when scripts.build is present', () => {
    const dir = makeTmpDir();
    writeJson(dir, 'package.json', {
      scripts: { build: 'webpack --config webpack.config.js' },
    });
    const result = detectFramework(dir);
    expect(result.framework).toBe(ProjectFramework.STATIC);
    expect(result.buildCommand).toBe('npm run build');
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

// ─── Malformed package.json ───────────────────────────────────────────────────
describe('detectFramework() — error resilience', () => {
  it('falls back to STATIC when package.json is invalid JSON', () => {
    const dir = makeTmpDir();
    fs.writeFileSync(path.join(dir, 'package.json'), 'NOT VALID JSON {{{{');
    const result = detectFramework(dir);
    expect(result.framework).toBe(ProjectFramework.STATIC);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
