"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * Unit tests for the framework detector.
 * Uses tmp directories with synthetic package.json files
 * to verify detection heuristics without spawning real processes.
 */
const node_fs_1 = __importDefault(require("node:fs"));
const node_os_1 = __importDefault(require("node:os"));
const node_path_1 = __importDefault(require("node:path"));
const framework_detector_1 = require("../src/frameworks/framework-detector");
const shared_types_1 = require("@deployforge/shared-types");
// ─── helpers ─────────────────────────────────────────────────────────────────
function makeTmpDir() {
    return node_fs_1.default.mkdtempSync(node_path_1.default.join(node_os_1.default.tmpdir(), 'df-test-'));
}
function writeJson(dir, filename, obj) {
    node_fs_1.default.writeFileSync(node_path_1.default.join(dir, filename), JSON.stringify(obj));
}
function touchFile(dir, filename) {
    node_fs_1.default.writeFileSync(node_path_1.default.join(dir, filename), '');
}
// ─── Fallback / static HTML ───────────────────────────────────────────────────
describe('detectFramework() — static fallback', () => {
    it('returns STATIC with echo commands for an empty directory', () => {
        const dir = makeTmpDir();
        const result = (0, framework_detector_1.detectFramework)(dir);
        expect(result.framework).toBe(shared_types_1.ProjectFramework.STATIC);
        expect(result.installCommand).toContain('echo');
        expect(result.buildCommand).toContain('echo');
        node_fs_1.default.rmSync(dir, { recursive: true, force: true });
    });
    it('uses "public" as outputDirectory when public/ folder exists', () => {
        const dir = makeTmpDir();
        node_fs_1.default.mkdirSync(node_path_1.default.join(dir, 'public'));
        const result = (0, framework_detector_1.detectFramework)(dir);
        expect(result.outputDirectory).toBe('public');
        node_fs_1.default.rmSync(dir, { recursive: true, force: true });
    });
    it('uses "." as outputDirectory when public/ is absent', () => {
        const dir = makeTmpDir();
        const result = (0, framework_detector_1.detectFramework)(dir);
        expect(result.outputDirectory).toBe('.');
        node_fs_1.default.rmSync(dir, { recursive: true, force: true });
    });
});
// ─── Next.js detection ────────────────────────────────────────────────────────
describe('detectFramework() — Next.js', () => {
    it('detects Next.js from dependencies', () => {
        const dir = makeTmpDir();
        writeJson(dir, 'package.json', { dependencies: { next: '14.0.0', react: '18.0.0' } });
        const result = (0, framework_detector_1.detectFramework)(dir);
        expect(result.framework).toBe(shared_types_1.ProjectFramework.NEXTJS);
        expect(result.outputDirectory).toBe('.next');
        node_fs_1.default.rmSync(dir, { recursive: true, force: true });
    });
    it('detects Next.js from devDependencies', () => {
        const dir = makeTmpDir();
        writeJson(dir, 'package.json', { devDependencies: { next: '14.0.0' } });
        const result = (0, framework_detector_1.detectFramework)(dir);
        expect(result.framework).toBe(shared_types_1.ProjectFramework.NEXTJS);
        node_fs_1.default.rmSync(dir, { recursive: true, force: true });
    });
    it('prefers npm ci when package-lock.json exists', () => {
        const dir = makeTmpDir();
        writeJson(dir, 'package.json', { dependencies: { next: '14.0.0' } });
        touchFile(dir, 'package-lock.json');
        const result = (0, framework_detector_1.detectFramework)(dir);
        expect(result.installCommand).toBe('npm ci');
        node_fs_1.default.rmSync(dir, { recursive: true, force: true });
    });
    it('uses pnpm install when pnpm-lock.yaml exists', () => {
        const dir = makeTmpDir();
        writeJson(dir, 'package.json', { dependencies: { next: '14.0.0' } });
        touchFile(dir, 'pnpm-lock.yaml');
        const result = (0, framework_detector_1.detectFramework)(dir);
        expect(result.installCommand).toBe('pnpm install --frozen-lockfile');
        node_fs_1.default.rmSync(dir, { recursive: true, force: true });
    });
    it('uses yarn when yarn.lock exists', () => {
        const dir = makeTmpDir();
        writeJson(dir, 'package.json', { dependencies: { next: '14.0.0' } });
        touchFile(dir, 'yarn.lock');
        const result = (0, framework_detector_1.detectFramework)(dir);
        expect(result.installCommand).toBe('yarn install --frozen-lockfile');
        node_fs_1.default.rmSync(dir, { recursive: true, force: true });
    });
});
// ─── Vite detection ───────────────────────────────────────────────────────────
describe('detectFramework() — Vite/React', () => {
    it('detects Vite from dependencies', () => {
        const dir = makeTmpDir();
        writeJson(dir, 'package.json', { devDependencies: { vite: '5.0.0', react: '18.0.0' } });
        const result = (0, framework_detector_1.detectFramework)(dir);
        expect(result.framework).toBe(shared_types_1.ProjectFramework.REACT_VITE);
        expect(result.outputDirectory).toBe('dist');
        node_fs_1.default.rmSync(dir, { recursive: true, force: true });
    });
    it('does not confuse Vite project with Next.js', () => {
        const dir = makeTmpDir();
        writeJson(dir, 'package.json', { devDependencies: { vite: '5.0.0' } });
        const result = (0, framework_detector_1.detectFramework)(dir);
        expect(result.framework).toBe(shared_types_1.ProjectFramework.REACT_VITE);
        expect(result.framework).not.toBe(shared_types_1.ProjectFramework.NEXTJS);
        node_fs_1.default.rmSync(dir, { recursive: true, force: true });
    });
});
// ─── Generic Node build ───────────────────────────────────────────────────────
describe('detectFramework() — generic node build', () => {
    it('returns STATIC with npm run build when scripts.build is present', () => {
        const dir = makeTmpDir();
        writeJson(dir, 'package.json', {
            scripts: { build: 'webpack --config webpack.config.js' },
        });
        const result = (0, framework_detector_1.detectFramework)(dir);
        expect(result.framework).toBe(shared_types_1.ProjectFramework.STATIC);
        expect(result.buildCommand).toBe('npm run build');
        node_fs_1.default.rmSync(dir, { recursive: true, force: true });
    });
});
// ─── Malformed package.json ───────────────────────────────────────────────────
describe('detectFramework() — error resilience', () => {
    it('falls back to STATIC when package.json is invalid JSON', () => {
        const dir = makeTmpDir();
        node_fs_1.default.writeFileSync(node_path_1.default.join(dir, 'package.json'), 'NOT VALID JSON {{{{');
        const result = (0, framework_detector_1.detectFramework)(dir);
        expect(result.framework).toBe(shared_types_1.ProjectFramework.STATIC);
        node_fs_1.default.rmSync(dir, { recursive: true, force: true });
    });
});
//# sourceMappingURL=framework-detector.spec.js.map