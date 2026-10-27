import { diagnoseDeploymentError } from '../src/orchestrator/error-diagnostics';
import { BuildStage } from '@deployforge/shared-types';

describe('diagnoseDeploymentError()', () => {
  it('correctly diagnoses missing Tailwind/PostCSS module failure', () => {
    const errorText = "Cannot find module '@tailwindcss/postcss'\nRequire stack:\n- /workspace/postcss.config.mjs";
    const diagnostic = diagnoseDeploymentError(BuildStage.BUILD, errorText);

    expect(diagnostic.category).toBe('MISSING_DEPENDENCY');
    expect(diagnostic.summary).toContain('@tailwindcss/postcss');
    expect(diagnostic.likelyCause).toContain('devDependencies');
    expect(diagnostic.suggestedAction).toContain('package.json');
  });

  it('correctly diagnoses Next.js SSR on static provider', () => {
    const errorText = "Next.js project is configured for Server-Side Rendering (SSR). Static hosting requires `output: 'export'`";
    const diagnostic = diagnoseDeploymentError(BuildStage.PREPARE, errorText);

    expect(diagnostic.category).toBe('SSR_PROVIDER_INCOMPATIBILITY');
    expect(diagnostic.summary).toContain('Server-Side Rendering');
    expect(diagnostic.suggestedAction).toContain('Local Testing');
  });

  it('correctly diagnoses npm EALLOWSCRIPTS restrictions', () => {
    const errorText = 'npm error code EALLOWSCRIPTS\nnpm error --allow-scripts is not allowed in project-scoped installs.';
    const diagnostic = diagnoseDeploymentError(BuildStage.INSTALL, errorText);

    expect(diagnostic.category).toBe('INSTALLATION_SCRIPT_RESTRICTION');
    expect(diagnostic.likelyCause).toContain('allow-scripts');
    expect(diagnostic.suggestedAction).toContain('.npmrc');
  });

  it('correctly diagnoses missing Prisma DATABASE_URL', () => {
    const errorText = 'PrismaClientInitializationError: Environment variable not found: DATABASE_URL';
    const diagnostic = diagnoseDeploymentError(BuildStage.BUILD, errorText);

    expect(diagnostic.category).toBe('DATABASE_CONFIGURATION_ERROR');
    expect(diagnostic.suggestedAction).toContain('DATABASE_URL');
  });

  it('correctly diagnoses missing environment variable', () => {
    const errorText = 'Error: Environment variable not found: STRIPE_SECRET_KEY';
    const diagnostic = diagnoseDeploymentError(BuildStage.BUILD, errorText);

    expect(diagnostic.category).toBe('MISSING_ENVIRONMENT_VARIABLE');
    expect(diagnostic.summary).toContain('STRIPE_SECRET_KEY');
  });

  it('correctly diagnoses missing build output directory', () => {
    const errorText = "Expected build output directory not found: .next";
    const diagnostic = diagnoseDeploymentError(BuildStage.BUILD, errorText, { outputDirectory: '.next' });

    expect(diagnostic.category).toBe('MISSING_BUILD_OUTPUT');
    expect(diagnostic.summary).toContain('.next');
  });

  it('correctly diagnoses health check failure', () => {
    const errorText = 'Provider post-deployment health check reported an error';
    const diagnostic = diagnoseDeploymentError(BuildStage.DEPLOY, errorText, {
      deploymentUrl: 'http://localhost:8080/deployments/test-123/',
    });

    expect(diagnostic.category).toBe('HEALTH_CHECK_FAILURE');
    expect(diagnostic.likelyCause).toContain('test-123');
  });
});
