// Core Deployment States
export enum DeploymentStatus {
  QUEUED = 'QUEUED',
  PREPARING = 'PREPARING',
  BUILDING = 'BUILDING',
  DEPLOYING = 'DEPLOYING',
  HEALTH_CHECKING = 'HEALTH_CHECKING',
  SUCCEEDED = 'SUCCEEDED',
  FAILED = 'FAILED',
  CANCELLED = 'CANCELLED',
}

// Permitted State Machine Transitions
export const ALLOWED_STATE_TRANSITIONS: Record<DeploymentStatus, DeploymentStatus[]> = {
  [DeploymentStatus.QUEUED]: [DeploymentStatus.PREPARING, DeploymentStatus.CANCELLED, DeploymentStatus.FAILED],
  [DeploymentStatus.PREPARING]: [DeploymentStatus.BUILDING, DeploymentStatus.CANCELLED, DeploymentStatus.FAILED],
  [DeploymentStatus.BUILDING]: [DeploymentStatus.DEPLOYING, DeploymentStatus.CANCELLED, DeploymentStatus.FAILED],
  [DeploymentStatus.DEPLOYING]: [DeploymentStatus.HEALTH_CHECKING, DeploymentStatus.SUCCEEDED, DeploymentStatus.CANCELLED, DeploymentStatus.FAILED],
  [DeploymentStatus.HEALTH_CHECKING]: [DeploymentStatus.SUCCEEDED, DeploymentStatus.FAILED, DeploymentStatus.CANCELLED],
  [DeploymentStatus.SUCCEEDED]: [], // Terminal state
  [DeploymentStatus.FAILED]: [],    // Terminal state
  [DeploymentStatus.CANCELLED]: [], // Terminal state
};

export function canTransition(current: DeploymentStatus, next: DeploymentStatus): boolean {
  return ALLOWED_STATE_TRANSITIONS[current]?.includes(next) ?? false;
}

export enum TriggerType {
  MANUAL = 'MANUAL',
  WEBHOOK = 'WEBHOOK',
  REDEPLOY = 'REDEPLOY',
  ROLLBACK = 'ROLLBACK',
}

export enum ProjectFramework {
  STATIC = 'STATIC',
  REACT_VITE = 'REACT_VITE',
  NEXTJS = 'NEXTJS',
}

export enum HostingProviderType {
  LOCAL_TESTING = 'LOCAL_TESTING',
  CLOUDFLARE_PAGES = 'CLOUDFLARE_PAGES',
  AWS_S3 = 'AWS_S3',
}

export enum LogLevel {
  INFO = 'INFO',
  WARN = 'WARN',
  ERROR = 'ERROR',
  DEBUG = 'DEBUG',
}

export enum BuildStage {
  PREPARE = 'PREPARE',
  INSTALL = 'INSTALL',
  BUILD = 'BUILD',
  DEPLOY = 'DEPLOY',
  SYSTEM = 'SYSTEM',
}

export enum EnvironmentScope {
  PRODUCTION = 'PRODUCTION',
  PREVIEW = 'PREVIEW',
  ALL = 'ALL',
}

export enum UserRole {
  USER = 'USER',
  ADMIN = 'ADMIN',
}

export enum OrgRole {
  OWNER = 'OWNER',
  ADMIN = 'ADMIN',
  MEMBER = 'MEMBER',
}

export enum ProjectRole {
  ADMIN = 'ADMIN',
  DEVELOPER = 'DEVELOPER',
  VIEWER = 'VIEWER',
}

// Deployment Queue Job Payload
export interface DeploymentJobData {
  deploymentId: string;
  projectId: string;
  commitSha: string;
  branch: string;
  triggerType: TriggerType;
  requestedById?: string;
  repoUrl: string;
  framework: ProjectFramework;
  buildCommand?: string | null;
  installCommand?: string | null;
  outputDirectory: string;
  provider: HostingProviderType;
  environment: EnvironmentScope;
}

// Hosting Provider Interface
export interface DeploymentResult {
  providerDeploymentId: string;
  deploymentUrl: string;
  metadata?: Record<string, unknown>;
  isLocalTesting?: boolean;
}

export interface HostingProviderAdapter {
  readonly providerName: HostingProviderType;
  deploy(input: {
    projectId: string;
    deploymentId: string;
    artifactPath: string;
    customDomain?: string;
    envVars?: Record<string, string>;
    isRuntime?: boolean;
    workspacePath?: string;
    onLog?: (level: any, stage: any, message: string) => Promise<void>;
  }): Promise<DeploymentResult>;
  getStatus(providerDeploymentId: string): Promise<{
    status: 'READY' | 'BUILDING' | 'ERROR';
    url?: string;
  }>;
  rollback?(previousDeploymentId: string): Promise<DeploymentResult>;
}

// Sanitized API Responses
export interface SafeUser {
  id: string;
  email: string;
  name: string | null;
  role: UserRole;
  createdAt: string;
}

export interface SafeProject {
  id: string;
  name: string;
  slug: string;
  ownerId: string;
  repoUrl: string;
  repoOwner: string;
  repoName: string;
  defaultBranch: string;
  framework: ProjectFramework;
  buildCommand: string | null;
  installCommand: string | null;
  outputDirectory: string;
  deploymentProvider: HostingProviderType;
  createdAt: string;
  updatedAt: string;
  latestDeployment?: SafeDeploymentSummary | null;
}

export interface SafeDeploymentSummary {
  id: string;
  commitSha: string;
  commitMessage: string | null;
  branch: string;
  status: DeploymentStatus;
  triggerType: TriggerType;
  deploymentUrl: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
}

export interface SafeEnvironmentVariable {
  id: string;
  projectId: string;
  environment: EnvironmentScope;
  key: string;
  isSecret: boolean;
  maskedValue: string;
  createdAt: string;
  updatedAt: string;
}

export interface SafeDeploymentLog {
  id: string;
  deploymentId: string;
  sequenceNumber: number;
  level: LogLevel;
  stage: BuildStage;
  message: string;
  timestamp: string;
}
