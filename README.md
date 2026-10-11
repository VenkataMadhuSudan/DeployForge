# DeployForge

> Automated Website Deployment and Management Platform

DeployForge is a developer platform that automatically builds and deploys websites from GitHub repositories, tracks deployment history, manages background jobs with BullMQ and Redis, streams build logs with real-time secret redaction, and provides safe redeployment and rollback workflows.

---

## Architecture Overview

DeployForge is structured as a TypeScript monorepo with strict separation between the **Control Plane** (REST API, Web Frontend, Database, Orchestrator) and the **Build Plane** (Sandboxed Non-Root Container Execution):

```
+-----------------------------------------------------------------------------------+
|                                  CONTROL PLANE                                    |
|                                                                                   |
|  +-------------------+       +-------------------+       +---------------------+  |
|  |  Next.js 15 Web   | ----> |  NestJS 11 REST   | <---> | PostgreSQL (Prisma) |  |
|  |     Frontend      |       |  Control Plane    |       +---------------------+  |
|  +-------------------+       +---------+---------+                   ^            |
|                                        |                             |            |
|                                        v (Transactional Outbox)      |            |
|                              +---------+---------+                   |            |
|  +-------------------+       |   Redis / BullMQ  |                   |            |
|  |  GitHub Webhooks  | ----> | (Deployment Queue)|                   |            |
|  +-------------------+       +---------+---------+                   |            |
|                                        |                             |            |
+----------------------------------------|-----------------------------|------------+
                                         v                             |
+----------------------------------------------------------------------|------------+
|                                  BUILD PLANE                         |            |
|                                                                      |            |
|  +-------------------------------------+                             |            |
|  |           Worker Process            | ----------------------------+            |
|  |    (State Machine, Orchestrator)    |                                          |
|  +------------------+------------------+                                          |
|                     | (Docker API / Sandboxed Process)                            |
|                     v                                                             |
|  +----------------------------------------------------+                           |
|  |             Isolated Build Sandbox                 |                           |
|  |   - Non-root user (UID 10001)                      |                           |
|  |   - Memory limit: 1024MB, CPU: 1.0 core            |                           |
|  |   - Pids limit: 100, Timeout: 600s                 |                           |
|  |   - Secret redaction stream filter                 |                           |
|  +------------------+---------------------------------+                           |
|                     | (Validated Artifacts)                                       |
|                     v                                                             |
|  +-------------------------------------+       +-------------------------------+  |
|  |     Hosting Provider Adapter        | ----> | Cloudflare Pages Direct Upload|  |
|  | (Independent Hosting API Contract)  |       | / Local Testing Adapter       |  |
|  +-------------------------------------+       +-------------------------------+  |
|                                                                                   |
+-----------------------------------------------------------------------------------+
```

---

## Monorepo Layout

```
deployforge/
├── apps/
│   ├── api/                   # NestJS REST API Control Plane (Port 4000)
│   ├── web/                   # Next.js 15 Frontend Dashboard (Port 3000)
│   └── worker/                # BullMQ Background Deployment Worker
├── packages/
│   ├── configuration/         # Zod Config Schema, AES-256-GCM Cryptographic Controls
│   ├── database/              # Prisma Schema, Migrations, Seed script, Client
│   ├── logging/               # Structured Logger, SecretRedactor & ANSI Sanitizer
│   ├── shared-types/          # Domain Types, Deployment State Machine & Transitions
│   └── validation/            # Validation Schemas, Webhook HMAC SHA-256 Verification
├── infrastructure/
│   ├── compose/               # docker-compose.yml for full stack & dependencies
│   └── docker/                # Production Dockerfiles (API, Worker, Web, Buildbox)
├── docs/                      # Comprehensive Documentation
│   ├── architecture.md        # Architecture specification and trust boundaries
│   ├── database.md            # PostgreSQL ERD, normalization, and data dictionary
│   ├── deployment.md          # Production operations, backup, and restore
│   ├── security.md            # Security policy, cryptographic controls, sanitization
│   └── threat-model.md        # STRIDE threat model and risk mitigations
├── .env.example               # Environment variable specification with placeholders
└── package.json               # Root monorepo configuration (pnpm workspaces)
```

---

## Key Features & Security Controls

1. **State Machine Orchestration**: Strict lifecycle state transitions (`QUEUED` &rarr; `PREPARING` &rarr; `BUILDING` &rarr; `DEPLOYING` &rarr; `HEALTH_CHECKING` &rarr; `SUCCEEDED` / `FAILED` / `CANCELLED`). Terminal states are immutable.
2. **Broken Object-Level Authorization (BOLA) Prevention**: `ProjectOwnershipGuard` enforces that users can only query, mutate, trigger builds, or inspect logs for projects they own. Cross-tenant access is rejected with `403 Forbidden`.
3. **Envelope Encryption for Secrets**: Project environment variables and secret tokens are encrypted at rest using **AES-256-GCM** with unique 96-bit IVs and 128-bit authentication tags. Secret values are masked (`••••••••`) and never exposed in API responses.
4. **Real-Time Secret Redaction**: Build log streaming runs through `SecretRedactor`, actively replacing all registered secrets with `[REDACTED_SECRET]` before database persistence or terminal display.
5. **Isolated Build Sandbox**: Builds execute inside containers as non-root user (`UID 10001`), dropping all Linux capabilities (`cap-drop: ALL`), with hard quotas on CPU (1.0 core), RAM (1024MB), and process count (100 PIDs).
6. **Signed GitHub Webhooks with Deduplication**: Incoming GitHub webhooks are verified against `X-Hub-Signature-256` using constant-time HMAC SHA-256 comparison (`crypto.timingSafeEqual`). Deliveries are deduplicated via unique `X-GitHub-Delivery` tracking.
7. **Hosting Provider Abstraction**:
   - `CloudflarePagesProvider`: Real Cloudflare Pages Direct Upload integration.
   - `LocalTestingProvider`: Deterministic local testing adapter serving built artifacts from isolated storage with unambiguous local badges.

---

## Quick Start (Local Development)

### 1. Prerequisites
- Node.js v20+ or v24+
- pnpm v10+
- Docker & Docker Compose

### 2. Environment Setup
```bash
# Clone or navigate to the repository
cd C:\projects\deployforge

# Copy environment template
cp .env.example .env
```
Ensure `ENCRYPTION_KEY` in `.env` is a valid 64-character hex string (32 bytes):
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### 3. Start Database & Redis via Docker
```bash
docker compose -f infrastructure/compose/docker-compose.yml up -d postgres redis
```

### 4. Initialize Database & Seed
```bash
# Push Prisma schema to PostgreSQL
pnpm db:push

# (Optional) Seed development admin and demo project
pnpm db:seed
```

### 5. Build and Start All Services
```bash
# Build all packages and applications
pnpm build

# Start services concurrently
pnpm dev
```
Endpoints:
- **Web Frontend**: [http://localhost:3000](http://localhost:3000)
- **API Swagger Documentation**: [http://localhost:4000/docs](http://localhost:4000/docs)
- **API Health Check**: [http://localhost:4000/api/v1/health](http://localhost:4000/api/v1/health)

---

## Running Automated Tests

DeployForge includes unit tests, tenant isolation security tests, cryptographic validation, and webhook signature verification:

```bash
# Run full Jest test suite across the monorepo
.\apps\api\node_modules\.bin\jest --config jest.config.js
```

### Verified Test Suites:
- `packages/shared-types/test/state-machine.test.ts`: Deployment state machine sequential progression & invalid transition rejection.
- `packages/logging/test/logging.test.ts`: Secret redaction stream filtering & terminal escape character sanitization.
- `packages/configuration/test/crypto.test.ts`: AES-256-GCM encryption roundtrip, tampering detection, and constant-time string comparison.
- `packages/validation/test/validation.test.ts`: Password complexity, project input validation, and GitHub HMAC SHA-256 signature verification.
- `apps/api/test/tenant-isolation.spec.ts`: Multi-tenant isolation testing proving User B cannot access User A's projects, deployments, or secrets (BOLA prevention).

---

## Full Docker Compose Deployment

To build and run the entire DeployForge stack (PostgreSQL, Redis, API, Worker, and Web frontend) inside containers:

```bash
docker compose -f infrastructure/compose/docker-compose.yml up --build -d
```
