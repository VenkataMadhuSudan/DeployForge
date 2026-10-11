# DeployForge Database Model Specification

## 1. Relational Design Principles

The database model is implemented using **PostgreSQL** and managed with **Prisma ORM**.
- **Primary Keys**: UUID v4 / CUID string identifiers for high concurrency and distributed safety without exposing sequential record counts.
- **Foreign Keys**: Enforced foreign key constraints with explicit `ON DELETE CASCADE` or `RESTRICT` rules to avoid orphaned records.
- **Normalization**: 3NF normalized schema for core entities.
- **Auditing & Timestamps**: All entities include `createdAt` and `updatedAt` with index optimization.
- **Encryption**: Secrets and tokens (e.g. `EnvironmentVariable.encryptedValue`, repository integration credentials) are AES-256-GCM encrypted before storage; plaintext keys are never stored in the database.

## 2. Entity Relationship Diagram

```
+---------------+           +--------------------+
|     User      | 1 ----- N | OrganizationMember |
+---------------+           +--------------------+
        |                             |
        |                             N
        |                             |
        | 1                 +--------------------+
        +------------------ |    Organization    |
        |                   +--------------------+
        |                             |
        | 1                           | 1
        v                             v
+---------------+           +--------------------+
| ProjectMember | N ----- 1 |      Project       |
+---------------+           +--------------------+
                                      | 1
        +-----------------------------+-----------------------------+
        | N                           | N                           | N
        v                             v                             v
+------------------+         +-------------------+        +--------------------+
|    Deployment    |         |EnvironmentVariable|        |    AuditLog        |
+------------------+         +-------------------+        +--------------------+
        | 1
        +-----------------------------+
        | N                           | N
        v                             v
+------------------+         +-------------------+
|  DeploymentLog   |         |   BuildArtifact   |
+------------------+         +-------------------+
```

## 3. Data Dictionary

### 3.1 Users (`User`)
* `id`: String (UUID), Primary Key.
* `email`: String, Unique (case-normalized lowercase), Indexed.
* `passwordHash`: String (Argon2id hash), non-nullable.
* `name`: String, nullable.
* `role`: String enum (`USER`, `ADMIN`), default `USER`.
* `createdAt`, `updatedAt`: DateTime.

### 3.2 Organizations (`Organization`)
* `id`: String (UUID), Primary Key.
* `name`: String.
* `slug`: String, Unique, Indexed.
* `createdAt`, `updatedAt`: DateTime.

### 3.3 OrganizationMembers (`OrganizationMember`)
* `id`: String (UUID), Primary Key.
* `organizationId`: String, FK -> Organization(id) ON DELETE CASCADE.
* `userId`: String, FK -> User(id) ON DELETE CASCADE.
* `role`: String enum (`OWNER`, `ADMIN`, `MEMBER`), default `MEMBER`.
* Unique constraint: `[organizationId, userId]`.

### 3.4 Projects (`Project`)
* `id`: String (UUID), Primary Key.
* `name`: String.
* `slug`: String, Unique per owner/org.
* `ownerId`: String, FK -> User(id).
* `organizationId`: String, nullable, FK -> Organization(id).
* `repoProvider`: String (`GITHUB`), default `GITHUB`.
* `repoId`: String, external repository ID.
* `repoUrl`: String, repository HTTPS clone URL.
* `repoOwner`: String, repository owner or org on GitHub.
* `repoName`: String, repository name on GitHub.
* `defaultBranch`: String, default `main`.
* `framework`: String enum (`STATIC`, `REACT_VITE`, `NEXTJS`), default `STATIC`.
* `buildCommand`: String, nullable (e.g. `npm run build`).
* `installCommand`: String, nullable (e.g. `npm ci`).
* `outputDirectory`: String, default `dist`.
* `deploymentProvider`: String enum (`LOCAL_TESTING`, `CLOUDFLARE_PAGES`, `AWS_S3`), default `LOCAL_TESTING`.
* `createdAt`, `updatedAt`: DateTime.

### 3.5 ProjectMembers (`ProjectMember`)
* `id`: String (UUID), Primary Key.
* `projectId`: String, FK -> Project(id) ON DELETE CASCADE.
* `userId`: String, FK -> User(id) ON DELETE CASCADE.
* `role`: String enum (`ADMIN`, `DEVELOPER`, `VIEWER`), default `DEVELOPER`.
* Unique constraint: `[projectId, userId]`.

### 3.6 RepositoryIntegrations (`RepositoryIntegration`)
* `id`: String (UUID), Primary Key.
* `provider`: String (`GITHUB`), default `GITHUB`.
* `userId`: String, FK -> User(id).
* `installationId`: String, GitHub App installation ID.
* `accountLogin`: String, GitHub username or organization name.
* `accountId`: String, GitHub account numerical ID.
* `metadata`: JSONB / text for installation settings.
* `createdAt`, `updatedAt`: DateTime.
* Unique constraint: `[provider, installationId]`.

### 3.7 Deployments (`Deployment`)
* `id`: String (UUID), Primary Key.
* `projectId`: String, FK -> Project(id) ON DELETE CASCADE, Indexed.
* `commitSha`: String (40-char git commit SHA), Indexed.
* `commitMessage`: String, nullable.
* `branch`: String, default `main`.
* `status`: String enum (`QUEUED`, `PREPARING`, `BUILDING`, `DEPLOYING`, `HEALTH_CHECKING`, `SUCCEEDED`, `FAILED`, `CANCELLED`), default `QUEUED`, Indexed.
* `triggerType`: String enum (`MANUAL`, `WEBHOOK`, `REDEPLOY`, `ROLLBACK`), default `MANUAL`.
* `requestedById`: String, nullable, FK -> User(id).
* `provider`: String, hosting provider selected.
* `providerDeploymentId`: String, nullable.
* `deploymentUrl`: String, nullable.
* `errorCode`: String, nullable.
* `errorMessage`: String, nullable.
* `startedAt`: DateTime, nullable.
* `completedAt`: DateTime, nullable.
* `createdAt`, `updatedAt`: DateTime, Indexed.

### 3.8 DeploymentLogs (`DeploymentLog`)
* `id`: String (UUID), Primary Key.
* `deploymentId`: String, FK -> Deployment(id) ON DELETE CASCADE, Indexed.
* `sequenceNumber`: Integer, ordered sequence within deployment.
* `level`: String enum (`INFO`, `WARN`, `ERROR`, `DEBUG`), default `INFO`.
* `stage`: String enum (`PREPARE`, `INSTALL`, `BUILD`, `DEPLOY`, `SYSTEM`), default `BUILD`.
* `message`: Text (sanitized and redacted of secrets).
* `timestamp`: DateTime, default now.
* Index: `[deploymentId, sequenceNumber ASC]`.

### 3.9 EnvironmentVariables (`EnvironmentVariable`)
* `id`: String (UUID), Primary Key.
* `projectId`: String, FK -> Project(id) ON DELETE CASCADE, Indexed.
* `environment`: String enum (`PRODUCTION`, `PREVIEW`, `ALL`), default `ALL`.
* `key`: String (validated alphanumeric + underscore).
* `encryptedValue`: Text (AES-256-GCM encrypted format `iv:authTag:ciphertext`).
* `isSecret`: Boolean, default true.
* `createdAt`, `updatedAt`: DateTime.
* Unique constraint: `[projectId, environment, key]`.

### 3.10 WebhookEvents (`WebhookEvent`)
* `id`: String (UUID), Primary Key.
* `provider`: String (`GITHUB`).
* `deliveryId`: String, GitHub delivery GUID from `X-GitHub-Delivery`.
* `eventType`: String, from `X-GitHub-Event`.
* `processingStatus`: String enum (`PENDING`, `PROCESSED`, `IGNORED`, `FAILED`).
* `payload`: JSONB / text.
* `receivedAt`: DateTime, default now.
* `processedAt`: DateTime, nullable.
* Unique constraint: `[provider, deliveryId]`.

### 3.11 AuditLogs (`AuditLog`)
* `id`: String (UUID), Primary Key.
* `actorId`: String, nullable, FK -> User(id).
* `organizationId`: String, nullable.
* `projectId`: String, nullable, FK -> Project(id).
* `action`: String (e.g. `PROJECT_CREATED`, `DEPLOYMENT_TRIGGERED`, `SECRET_UPDATED`, `ROLLBACK_REQUESTED`).
* `resourceType`: String (e.g. `PROJECT`, `DEPLOYMENT`, `ENV_VAR`).
* `resourceId`: String.
* `metadata`: JSONB / text (safe sanitized metadata, never containing secrets).
* `ipAddress`: String, nullable.
* `timestamp`: DateTime, default now.

### 3.12 BuildArtifacts (`BuildArtifact`)
* `id`: String (UUID), Primary Key.
* `deploymentId`: String, FK -> Deployment(id) ON DELETE CASCADE.
* `storagePath`: String.
* `checksumSha256`: String.
* `sizeBytes`: BigInt.
* `fileCount`: Integer.
* `createdAt`: DateTime, default now.

### 3.13 OutboxEvents (`OutboxEvent`)
* `id`: String (UUID), Primary Key.
* `eventType`: String.
* `payload`: JSONB / text.
* `status`: String enum (`PENDING`, `DISPATCHED`, `FAILED`), default `PENDING`.
* `retryCount`: Integer, default 0.
* `createdAt`: DateTime, default now.
* `dispatchedAt`: DateTime, nullable.

## 4. Migrations & Reliability Strategy
1. **Prisma Migrations**: All schema modifications are tracked as incremental SQL migrations in `packages/database/prisma/migrations`.
2. **Transactional Guarantees**: Creating a deployment writes both the `Deployment` record and `OutboxEvent` inside a single PostgreSQL transaction.
3. **Log Sharding / Retention**: Deployment logs are indexed sequentially per deployment to support efficient paginated queries (`LIMIT 100 OFFSET :skip`).
