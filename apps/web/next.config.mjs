import fs from 'node:fs';
import path from 'node:path';

// Normalize process.cwd() on Windows to match native filesystem casing
try {
  const nativeCwd = fs.realpathSync.native(process.cwd());
  if (process.cwd() !== nativeCwd) {
    process.chdir(nativeCwd);
  }
} catch {
  // Ignore fallback
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['@deployforge/shared-types'],
  webpack: (config) => {
    // 1. Suppress case warning spam in terminal
    config.ignoreWarnings = [
      ...(config.ignoreWarnings || []),
      /There are multiple modules with names that only differ in casing/,
    ];

    // 2. Normalize Windows drive and directory casing across all Webpack module resolutions
    // This ensures only ONE instance of Next.js internal modules (e.g. layout-router) is bundled,
    // preserving React Context identity and preventing "invariant expected layout router to be mounted".
    config.plugins.push({
      apply(compiler) {
        compiler.hooks.normalModuleFactory.tap('NormalizeCasingPlugin', (nmf) => {
          nmf.hooks.beforeResolve.tap('NormalizeCasingPlugin', (resolveData) => {
            if (resolveData.context) {
              resolveData.context = resolveData.context.replace(/^c:\\projects/i, 'C:\\Projects');
            }
            if (typeof resolveData.request === 'string' && resolveData.request.startsWith('C:\\') || resolveData.request.startsWith('c:\\')) {
              resolveData.request = resolveData.request.replace(/^c:\\projects/i, 'C:\\Projects');
            }
          });

          nmf.hooks.afterResolve.tap('NormalizeCasingPlugin', (resolveData) => {
            if (resolveData && resolveData.createData && typeof resolveData.createData.resource === 'string') {
              resolveData.createData.resource = resolveData.createData.resource.replace(/^c:\\projects/i, 'C:\\Projects');
            }
          });
        });
      },
    });

    return config;
  },
};

export default nextConfig;
