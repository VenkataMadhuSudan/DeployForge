# DeployForge Architecture Specification

## 1. System Overview

DeployForge is an automated, secure website deployment and management platform that builds websites from source repositories, manages deployment history, runs isolated execution pipelines, and deploys artifacts to hosting providers.

The architecture separates the **Control Plane** (API, web UI, metadata management, orchestration) from the **Build Plane** (untrusted source execution, compilation, dependency fetching, container sandbox).

```
+-----------------------------------------------------------------------------------+
|                                  CONTROL PLANE                                    |
|                                                                                   |
|  +-------------------+       +-------------------+       +---------------------+  |
|  |    Next.js Web    | ----> |    NestJS API     | <---> |  PostgreSQL (Prisma)|  |
|  |     Frontend      |       |  (REST v1, Auth)  |       +---------------------+  |
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
|                     | (Docker API / Sandboxed process)                            |
|                     v                                                             |
|  +----------------------------------------------------+                           |
|  |             Isolated Build Container               |                           |
|  |   - Non-root user (UID 10001)                      |                           |
|  |   - Memory limit (e.g. 1GB), CPU limit (1.0)       |                           |
|  |   - No host socket / privileged flag               |                           |
|  |   - Internal network isolation                     |                           |
|  |   - Workspace mounted ephemerally                  |                           |
|  +------------------+---------------------------------+                           |
|                     |                                                             |
|                     v (Validated Artifacts)                                       |
|  +-------------------------------------+       +-------------------------------+  |
|  |     Hosting Provider Adapter        | ----> | Real Provider (Cloudflare/S3) |  |
|  | (Independent Hosting API Contract)  |       | / Local Testing Storage       |  |
|  +-------------------------------------+       +-------------------------------+  |
|                                                                                   |
+-----------------------------------------------------------------------------------+
```

## 2. Core Components

### 2.1 Web Frontend (`apps/web`)
* **Technology**: Next.js (App Router), TypeScript, Tailwind CSS.
* **Role**: Minimal, high-clarity dashboard for registration, project management, deployment tracking, live log viewer, and environment variables.
* **Security boundary**: Never accesses database directly, has zero provider credentials, communicates strictly through the NestJS REST API using secure HttpOnly session cookies or bearer tokens.

### 2.2 Backend API (`apps/api`)
* **Technology**: NestJS, TypeScript, class-validator, Argon2 password hashing.
* **Role**: Authenticates users, enforces tenant isolation and project ownership, accepts GitHub webhooks (HMAC SHA-256 verification), coordinates deployments via BullMQ, and streams/paginates logs.
* **Reliability**: Uses database transactions and transactional outbox logic to guarantee zero lost deployment requests.

### 2.3 Worker Process (`apps/worker`)
* **Technology**: Node.js/TypeScript background worker powered by BullMQ.
* **Role**: Consumes jobs from Redis queue, runs the deployment state machine, invokes the isolated build executor, collects and sanitizes logs, and dispatches artifacts to the hosting adapter.
* **Failure recovery**: Implements heartbeat recording, graceful shutdown, exponential backoff retries, and cleanup hooks on failure or cancellation.

### 2.4 Database & Cache
* **PostgreSQL**: Authoritative source of truth for all persistent entities (Users, Organizations, Projects, Deployments, Logs, Webhooks, Audit Logs).
* **Redis**: Ephemeral queue transport for BullMQ, rate limiting, and ephemeral job locks.

### 2.5 Isolated Build Executor
* **Security**: Builds are executed in ephemeral containers or isolated sandboxes with non-root UID, cgroups constraints (memory, CPU, pids), execution timeouts, and internal IP blocklists (SSRF protection against cloud metadata `169.254.169.254`).

### 2.6 Hosting Provider Adapter
* **Contract**: Clean abstraction (`HostingProviderAdapter`) implementing `deploy()`, `getStatus()`, `getDeploymentUrl()`, `rollback()`.
* **Implementations**:
  1. `CloudflarePagesProvider`: Real production provider adapter using Cloudflare API.
  2. `LocalTestingProvider`: Deterministic local provider serving built artifacts over local static server with distinct non-production indicators.

## 3. Trust Boundaries and Data Flow
1. **Untrusted Internet -> Control Plane**: All inbound traffic must pass strict authentication, rate limiting, and CORS validation.
2. **GitHub Webhooks -> API**: Webhooks must be verified using HMAC SHA-256 signatures before parsing payload data.
3. **Control Plane -> Build Plane**: Worker never receives database master passwords or production secrets of other tenants. Build containers receive only the project-scoped build-time environment variables.
4. **Build Container -> Host**: Build containers run as non-root, have read-only or scoped workspace volumes, and cannot access the Docker daemon or host networks.
