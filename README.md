# DeployForge

> Modern, Secure Automated Website Deployment and Management Platform

DeployForge is a developer platform that automatically builds, tests, and deploys modern web applications and static sites from Git repositories. It provides sandboxed container builds, real-time secret-redacted log streaming, state-machine-driven lifecycle management, background queuing with Redis and BullMQ, and one-click rollback and redeployment workflows.

---

## Table of Contents

- [Architecture Overview](#architecture-overview)
- [Monorepo Structure](#monorepo-structure)
- [Core Functionalities & Features](#core-functionalities--features)
  - [1. Deterministic State Machine](#1-deterministic-state-machine)
  - [2. Multi-Tenant Security & BOLA Prevention](#2-multi-tenant-security--bola-prevention)
  - [3. Envelope Encryption & Secret Redaction](#3-envelope-encryption--secret-redaction)
  - [4. Dual-Mode Sandboxed Build Executors](#4-dual-mode-sandboxed-build-executors)
  - [5. Zero-Config Framework & Package Manager Detection](#5-zero-config-framework--package-manager-detection)
  - [6. Signed GitHub Webhooks & Deduplication](#6-signed-github-webhooks--deduplication)
  - [7. Pluggable Hosting Provider Adapters](#7-pluggable-hosting-provider-adapters)
  - [8. Next.js 15 Dark-Mode Web Dashboard](#8-nextjs-15-dark-mode-web-dashboard)
- [REST API Reference](#rest-api-reference)
- [Local Development Setup](#local-development-setup)
  - [Prerequisites](#prerequisites)
  - [Step 1: Clone and Configure Environment](#step-1-clone-and-configure-environment)
  - [Step 2: Start PostgreSQL & Redis](#step-2-start-postgresql--redis)
  - [Step 3: Database Migration & Seeding](#step-3-database-migration--seeding)
  - [Step 4: Build & Run Applications](#step-4-build--run-applications)
- [Default Seed Credentials](#default-seed-credentials)
- [Running Automated Tests](#running-automated-tests)
- [Full Docker Compose Deployment](#full-docker-compose-deployment)
- [Security & Threat Model](#security--threat-model)

---

## Architecture Overview

DeployForge enforces strict separation between the **Control Plane** (REST API, Web Frontend, Database, Outbox Queue Dispatcher) and the **Build Plane** (Sandboxed Non-Root Container Execution, Isolated Worker, Artifact Delivery):

```
+-----------------------------------------------------------------------------------+
|                                  CONTROL PLANE                                    |
|                                                                                   |
|  +-------------------+       +-------------------+       +---------------------+  |
|  |   Next.js 15      | ----> |   NestJS 11 REST  | <---> | PostgreSQL (Prisma) |  |
|  | Web Dashboard     |       |    Control Plane  |       +---------------------+  |
|  | (Port 3000)       |       |    (Port 4000)    |                  ^             |
|  +-------------------+       +---------+---------+                  |             |
|                                        |                            |             |
|                                        v (Transactional Outbox)     |             |
|  +-------------------+       +---------+---------+                  |             |
|  |  GitHub Webhooks  | ----> |   Redis / BullMQ  |                  |             |
|  | (HMAC SHA-256)    |       | (Deployment Queue)|                  |             |
|  +-------------------+       +---------+---------+                  |             |
|                                        |                            |             |
+----------------------------------------|----------------------------|-------------+
                                         v                            |
+---------------------------------------------------------------------|-------------+
|                                  BUILD PLANE                        |             |
|                                                                     |             |
|  +-------------------------------------+                            |             |
|  |           Worker Process            | ---------------------------+             |
|  |   (State Machine, Framework Detect) |                                          |
|  +------------------+------------------+                                          |
|                     |                                                             |
|                     +-----------------------------+                               |
|                     |                             |                               |
|                     v (Docker Daemon Active)      v (Docker Fallback)             |
|  +------------------------------------+   +------------------------------------+  |
|  |       Docker Container Sandbox     |   |      Process Sandbox Executor      |  |
|  | - Non-root user (UID 10001:10001)  |   | - Subprocess with environment env  |  |
|  | - Capability drop (ALL)            |   | - SecretRedactor filter stream     |  |
|  | - Memory: 1024MB | CPU: 1.0 core   |   | - Strict execution timeout (600s)  |  |
|  | - PIDs limit: 100 | Timeout: 600s  |   | - Validated artifact extraction    |  |
|  +------------------+-----------------+   +-----------------+------------------+  |
|                     \                             /                               |
|                      +-------------+-------------+                                |
|                                    v                                              |
|                    +-------------------------------+                              |
|                    |   Hosting Provider Adapter    |                              |
|                    +---------------+---------------+                              |
|                                    |                                              |
|            +-----------------------+-----------------------+                      |
|            v                                               v                      |
|  +-------------------------------+           +-------------------------------+    |
|  |   Cloudflare Pages Provider   |           |    Local Testing Provider     |    |
|  |  (Direct Upload REST API)     |           | (Integrated HTTP static server|    |
|  |                               |           |  serving http://localhost:8080)    |
|  +-------------------------------+           +-------------------------------+    |
|                                                                                   |
+-----------------------------------------------------------------------------------+
```

---

## Monorepo Structure

DeployForge is managed as a high-performance `pnpm` workspace:

```
deployforge/
├── apps/
│   ├── api/                   # NestJS 11 REST API Control Plane (Port 4000)
│   │   ├── src/common/        # Guards (JWT, ProjectOwnership), decorators, interceptors
│   │   ├── src/modules/       # Auth, Projects, Deployments, Env-vars, Logs, Webhooks, Health
│   │   └── test/              # Integration & BOLA tenant isolation security test suites
│   ├── web/                   # Next.js 15 Web Dashboard with Tailwind & Vanilla CSS (Port 3000)
│   │   ├── src/app/           # App Router: Dashboard, Projects, Deployments, Logs, Settings
│   │   ├── src/components/    # Terminal logs viewer, Status badges, Modal dialogs, Forms
│   │   └── src/lib/           # Authenticated API client with token & credentials handling
│   └── worker/                # BullMQ Background Deployment Worker Service
│       ├── src/executors/     # Docker & Process build execution engines
│       ├── src/frameworks/    # Automatic framework & package manager detector
│       ├── src/orchestrator/  # State-machine deployment orchestrator
│       ├── src/providers/     # Cloudflare Pages & Local Testing hosting provider adapters
│       └── test/              # Framework detection unit tests
├── packages/
│   ├── configuration/         # Zod environment validation, AES-256-GCM encryption & decryption
│   ├── database/              # Prisma schema, migrations, PostgreSQL client, seed scripts
│   ├── logging/               # Structured logger, real-time SecretRedactor, ANSI sanitization
│   ├── shared-types/          # Domain types, Enums, Deployment state machine & transition rules
│   └── validation/            # Zod validation schemas, GitHub HMAC SHA-256 signature verification
├── infrastructure/
│   ├── compose/               # docker-compose.yml for full stack & dependencies
│   └── docker/                # Production Dockerfiles (Dockerfile.api, Dockerfile.worker, Dockerfile.web)
├── docs/                      # Architectural, database, threat-model, and operational specs
│   ├── architecture.md        # Monorepo architecture & trust boundary definitions
│   ├── database.md            # PostgreSQL ERD, normalization, and data dictionary
│   ├── deployment.md          # Operations, backups, and disaster recovery procedures
│   ├── security.md            # Cryptographic controls, key rotation, and sanitization policy
│   └── threat-model.md        # STRIDE threat model and mitigation matrix
├── .env.example               # Complete environment variable template with defaults
└── package.json               # Root monorepo workspace configuration
```

---

## Core Functionalities & Features

### 1. Deterministic State Machine
Every deployment progresses through an explicit, strictly validated lifecycle:
- **States**: `QUEUED` &rarr; `PREPARING` &rarr; `BUILDING` &rarr; `DEPLOYING` &rarr; `HEALTH_CHECKING` &rarr; `SUCCEEDED` / `FAILED` / `CANCELLED`.
- **Integrity**: Out-of-order transitions are rejected by `canTransition()`. Terminal states (`SUCCEEDED`, `FAILED`, `CANCELLED`) are immutable, preventing race conditions or duplicate execution.
- **Rollback & Redeploy**: Trigger automated redeployments against historical commits or roll back to any previously successful deployment with a single API call or dashboard click.

### 2. Multi-Tenant Security & BOLA Prevention
- **Broken Object-Level Authorization (BOLA)**: Protected by `ProjectOwnershipGuard`. Users can only query, mutate, cancel, or inspect logs for projects they explicitly own or are granted membership to.
- **Password Hashing**: Secure **Argon2id** hashing with tuned parameters (`memoryCost: 65536` [64MB], `timeCost: 3`, `parallelism: 4`).
- **Authentication**: Stateless JWT authentication with both `Bearer` token header support and `HttpOnly` cookie persistence.

### 3. Envelope Encryption & Secret Redaction
- **AES-256-GCM Encryption**: Project environment variables and credentials are encrypted at rest using an authenticated cipher with a unique 96-bit Initialization Vector (IV) and a 128-bit authentication tag per record.
- **Secret Masking**: Secret values are masked (`••••••••`) across all API responses.
- **Real-Time Stream Redaction**: Build and install stdout/stderr streams pass through `SecretRedactor`, actively stripping registered project secrets and replacing them with `[REDACTED_SECRET]` before persistence or UI display.
- **Terminal Sanitization**: Strips dangerous ANSI escape sequences to prevent terminal injection or UI spoofing.

### 4. Dual-Mode Sandboxed Build Executors
- **DockerBuildExecutor (Default when Docker is running)**:
  - Spawns unprivileged containers (`node:20-alpine`) executing under non-root UID `10001:10001`.
  - Drops all capabilities (`CapDrop: ['ALL']`).
  - Strict resource constraints: `Memory: 1024MB`, `NanoCpus: 1.0 core`, `PidsLimit: 100`, `Timeout: 600s`.
- **ProcessBuildExecutor (Automatic Fallback)**:
  - When the Docker daemon is unreachable or in lightweight test environments, the worker falls back gracefully to a sandboxed child process executor with strict timeout guards and stdout/stderr redaction.

### 5. Zero-Config Framework & Package Manager Detection
The build engine automatically detects framework conventions and project configurations:
- **Supported Frameworks**:
  - `Next.js` (`outputDirectory: .next`, `buildCommand: npm run build`)
  - `React / Vite` (`outputDirectory: dist`, `buildCommand: npm run build`)
  - `Static HTML/JS` (`outputDirectory: dist` or `public` or `.`)
- **Package Manager Resolution**:
  - `pnpm-lock.yaml` &rarr; `pnpm install --frozen-lockfile`
  - `package-lock.json` &rarr; `npm ci`
  - `yarn.lock` &rarr; `yarn install --frozen-lockfile`
  - Fallback &rarr; `npm install`

### 6. Signed GitHub Webhooks & Deduplication
- **Cryptographic Verification**: Incoming GitHub webhooks are validated against `X-Hub-Signature-256` using constant-time HMAC SHA-256 comparison (`crypto.timingSafeEqual`) to eliminate timing attack vectors.
- **Delivery Deduplication**: Tracks unique `X-GitHub-Delivery` IDs in PostgreSQL, ignoring duplicate deliveries.
- **Automated Pipeline**: Commits pushed to the configured `defaultBranch` automatically trigger a queued deployment.

### 7. Pluggable Hosting Provider Adapters
- **LocalTestingProvider**:
  - Integrated HTTP static server running on port `8080` (or `LOCAL_DEPLOYMENT_PORT`).
  - Serves compiled project artifacts directly (`http://localhost:8080/deployments/<deploymentId>/index.html`).
  - Includes path traversal protection and comprehensive MIME type resolution (`.html`, `.css`, `.js`, `.json`, `.svg`, fonts, etc.).
- **CloudflarePagesProvider**:
  - Official Cloudflare Pages Direct Upload API integration.
  - Automatically pushes build outputs to Cloudflare edge networks via `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN`.

### 8. Next.js 15 Dark-Mode Web Dashboard
- **Glassmorphic Dark UI**: High-contrast, responsive dashboard built with modern typography and visual hierarchy.
- **Live Terminal Log Viewer**: Real-time polling with sequence tracking (`after` query) and stage badges (`PREPARE`, `INSTALL`, `BUILD`, `DEPLOY`, `SYSTEM`).
- **Project Settings & Environment Variables**: Management interface to securely add, edit, scope (`PRODUCTION`, `PREVIEW`, `ALL`), and delete encrypted environment variables.
- **Rollback & History**: Visual timeline of all deployments with commit SHAs, author, branch, duration, and one-click rollback triggers.

---

## REST API Reference

All REST endpoints are prefixed with `/api/v1` and documentable via Swagger UI at `/docs`.

### Authentication
| Method | Endpoint | Description | Auth Required |
|:---|:---|:---|:---:|
| `POST` | `/api/v1/auth/register` | Register a new user account | No |
| `POST` | `/api/v1/auth/login` | Authenticate and obtain JWT token | No |
| `GET` | `/api/v1/auth/me` | Fetch authenticated profile | Yes (JWT) |

### Projects
| Method | Endpoint | Description | Auth Required |
|:---|:---|:---|:---:|
| `GET` | `/api/v1/projects` | List all projects belonging to user | Yes (JWT) |
| `POST` | `/api/v1/projects` | Create a new project repository config | Yes (JWT) |
| `GET` | `/api/v1/projects/:id` | Get project details by ID | Yes (Owner) |
| `PATCH` | `/api/v1/projects/:id` | Update project configuration | Yes (Owner) |
| `DELETE` | `/api/v1/projects/:id` | Delete project and related data | Yes (Owner) |

### Deployments
| Method | Endpoint | Description | Auth Required |
|:---|:---|:---|:---:|
| `GET` | `/api/v1/projects/:projectId/deployments` | List deployments for a project | Yes (Owner) |
| `POST` | `/api/v1/projects/:projectId/deployments` | Trigger a new manual deployment | Yes (Owner) |
| `GET` | `/api/v1/projects/:projectId/deployments/:deploymentId` | Get deployment status & details | Yes (Owner) |
| `POST` | `/api/v1/projects/:projectId/deployments/:deploymentId/cancel` | Cancel an in-progress deployment | Yes (Owner) |
| `POST` | `/api/v1/projects/:projectId/deployments/:deploymentId/rollback` | Roll back to this deployment | Yes (Owner) |

### Deployment Logs
| Method | Endpoint | Description | Auth Required |
|:---|:---|:---|:---:|
| `GET` | `/api/v1/projects/:projectId/deployments/:deploymentId/logs` | Fetch deployment logs (supports `?after=<seq>&limit=200`) | Yes (Owner) |

### Environment Variables
| Method | Endpoint | Description | Auth Required |
|:---|:---|:---|:---:|
| `GET` | `/api/v1/projects/:projectId/env` | List masked environment variables | Yes (Owner) |
| `POST` | `/api/v1/projects/:projectId/env` | Add or update an encrypted variable | Yes (Owner) |
| `DELETE` | `/api/v1/projects/:projectId/env/:varId` | Delete an environment variable | Yes (Owner) |

### Webhooks & System Health
| Method | Endpoint | Description | Auth Required |
|:---|:---|:---|:---:|
| `POST` | `/api/v1/webhooks/github` | Receive GitHub push/release webhooks | HMAC Header |
| `GET` | `/api/v1/health` | Health check verifying PostgreSQL & Redis | No |

---

## Local Development Setup

### Prerequisites
- **Node.js**: `v20.x` or `v22.x`+
- **Package Manager**: `pnpm` `v10.x` (`npm install -g pnpm`)
- **Docker & Docker Compose**: (for running PostgreSQL, Redis, and container builds)

### Step 1: Clone and Configure Environment
```bash
# Clone the repository
git clone https://github.com/VenkataMadhuSudan/DeployForge.git
cd DeployForge

# Copy environment variables
cp .env.example .env
```

Ensure `ENCRYPTION_KEY` in `.env` is a valid 64-character hexadecimal string (32 bytes). You can generate one via:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### Step 2: Start PostgreSQL & Redis
```bash
docker compose -f infrastructure/compose/docker-compose.yml up -d postgres redis
```

### Step 3: Database Migration & Seeding
```bash
# Generate Prisma client
pnpm db:generate

# Push database schema to PostgreSQL
pnpm db:push

# Seed default admin user & sample project
pnpm db:seed
```

### Step 4: Build & Run Applications
```bash
# Build all packages and shared libraries
pnpm build

# Start API, Worker, and Web Dashboard concurrently in watch mode
pnpm dev
```

Alternatively, you can run individual services:
```bash
pnpm dev:api      # Starts NestJS API on http://localhost:4000
pnpm dev:worker   # Starts BullMQ deployment worker
pnpm dev:web      # Starts Next.js Dashboard on http://localhost:3000
```

### Access URLs:
- **Web Dashboard**: [http://localhost:3000](http://localhost:3000)
- **REST API & Swagger Docs**: [http://localhost:4000/docs](http://localhost:4000/docs)
- **Health Check Endpoint**: [http://localhost:4000/api/v1/health](http://localhost:4000/api/v1/health)
- **Local Deployment Preview**: [http://localhost:8080](http://localhost:8080)

---

## Default Seed Credentials

When initializing with `pnpm db:seed`, the following development account and demo project are provisioned:

- **Email**: `dev@deployforge.local`
- **Password**: `DeployForge2026!`
- **Role**: `ADMIN`
- **Preconfigured Project**: `Demo Static Site` (`demo-static-site`)

---

## Running Automated Tests

DeployForge features an automated test suite verifying state machine transitions, cryptographic operations, HMAC signatures, multi-tenant isolation, framework detection, and authentication.

```bash
# Run tests across all workspace packages
pnpm test
```

### Verified Test Suites:
| Test File | Scope | Description |
|:---|:---|:---|
| `packages/shared-types/test/state-machine.test.ts` | State Machine | Sequential progression, invalid transitions, and terminal state immutability. |
| `packages/logging/test/logging.test.ts` | Logging & Redaction | Secret redaction filtering, regex edge cases, and ANSI escape sanitization. |
| `packages/configuration/test/crypto.test.ts` | Cryptography | AES-256-GCM encryption roundtrip, tampering detection, and timing-safe comparison. |
| `packages/validation/test/validation.test.ts` | Validation & HMAC | Password complexity rules, schema checking, and GitHub HMAC SHA-256 verification. |
| `apps/worker/test/framework-detector.spec.ts` | Framework Detection | Next.js, Vite, static fallback, and lockfile detection (`pnpm`, `npm`, `yarn`). |
| `apps/api/test/tenant-isolation.spec.ts` | Multi-Tenant Security | Strict BOLA prevention: User B cannot view or modify User A's projects, builds, or secrets. |
| `apps/api/test/auth.spec.ts` | Auth Controller | Registration, login token issuing, duplicate prevention, and profile retrieval. |

---

## Full Docker Compose Deployment

To build and run the complete DeployForge stack (PostgreSQL, Redis, API, Worker, and Web Dashboard) inside containerized infrastructure:

```bash
docker compose -f infrastructure/compose/docker-compose.yml up --build -d
```

To view logs for all services:
```bash
docker compose -f infrastructure/compose/docker-compose.yml logs -f
```

To shut down the stack:
```bash
docker compose -f infrastructure/compose/docker-compose.yml down
```

---

## Security & Threat Model

DeployForge was architected following the **STRIDE** security methodology:

- **Spoofing**: Defended by Argon2id password hashing, constant-time GitHub webhook signature verification, and signed JWT session tokens.
- **Tampering**: AES-256-GCM envelope encryption with 128-bit authentication tags detects any ciphertext alteration.
- **Repudiation**: Immutable audit logging (`AuditLog` entity) tracks all project modifications and deployment actions.
- **Information Disclosure**: `SecretRedactor` dynamically masks secrets in logs before persistence; secrets in API responses are masked with `••••••••`.
- **Denial of Service**: Build containers operate with cgroup constraints (1.0 CPU core, 1024MB RAM, 100 PIDs) and a 600-second execution timeout.
- **Elevation of Privilege**: Builds run strictly as non-root user (`UID 10001:10001`) with dropped Linux capabilities (`cap-drop: ALL`), and API endpoints enforce strict `ProjectOwnershipGuard` authorization.

For detailed security guidelines, refer to [docs/security.md](docs/security.md) and [docs/threat-model.md](docs/threat-model.md).
