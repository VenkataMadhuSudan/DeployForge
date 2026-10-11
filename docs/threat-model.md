# DeployForge Threat Model (STRIDE)

## 1. Scope & System Boundaries

The DeployForge system encompasses:
- Public REST API & Web Dashboard (`apps/api`, `apps/web`)
- Database & Queue Broker (PostgreSQL, Redis)
- Background Deployment Worker (`apps/worker`)
- Ephemeral Sandboxed Build Containers (Docker / Process Sandbox)
- External Integrations: GitHub App (Webhook ingester, Octokit API), Cloudflare/Hosting APIs

## 2. Threat Analysis (STRIDE Matrix)

| Threat Category | Potential Attack Vector | Impact | Mitigations in DeployForge |
|---|---|---|---|
| **Spoofing** | Forged GitHub webhook events simulating push to main branch | Unauthorized deployment trigger, malicious source build | Strict HMAC SHA-256 webhook signature verification (`X-Hub-Signature-256`) using raw request buffer with `crypto.timingSafeEqual`. Replay protection via `X-GitHub-Delivery` uniqueness. |
| **Spoofing** | Session hijacking / token spoofing | Account takeover | Argon2id password hashing, secure HttpOnly SameSite=Strict session cookies / signed JWT tokens, session revocation table. |
| **Tampering** | Modifying build output or repository code in flight | Malicious site defacement | Checkout exact commit SHA (immutable 40-hex commit hash) rather than floating branch heads. Artifact SHA-256 integrity checksums stored on `BuildArtifact`. |
| **Tampering** | Modifying database records of another tenant (BOLA/IDOR) | Cross-tenant data tampering | Strict ProjectMember & OrganizationMember authorization guards. Ownership checked on every endpoint accessing projects, deployments, or environment variables. |
| **Repudiation** | User denies triggering deployment or altering production environment variable | Lack of accountability | Dedicated `AuditLog` entity recording actorId, timestamp, IP, action, resourceType, and sanitized non-secret metadata. |
| **Information Disclosure** | Build logs displaying secret environment variables (API keys, database URLs) | Credential theft | Real-time secret masking and redaction stream filter that replaces known plaintext secrets with `[REDACTED_SECRET]` before persisting to `DeploymentLog` or transmitting over WebSockets/SSE. |
| **Information Disclosure** | Environment variable retrieval API returning raw secret values | Secret exposure to frontend/attackers | Secret values are encrypted at rest using AES-256-GCM. API responses return masked values (e.g. `••••••••`) or omit `value` when `isSecret: true`. |
| **Denial of Service** | Malicious build container running `while(true)` fork bomb or filling host disk | Worker exhaustion, host crash | Non-root container UID (10001), cgroups CPU limits (1.0 core), memory limit (1024MB), pids limit (100 processes), ephemeral scratch storage, and hard build timeouts (e.g. 10 minutes). |
| **Denial of Service** | Rapid webhook or manual deployment flooding | Queue starvation | Per-project and per-user deployment rate limiting and concurrency throttling (e.g. max 2 active builds per project, queued sequentially). |
| **Elevation of Privilege** | Container breakout escaping build container into host OS / worker | Host compromise, access to other tenants' code | Never mount Docker socket into build container. Disable container `--privileged` flag. Drop Linux capabilities (`--cap-drop=ALL`). Read-only root filesystem with ephemeral `/tmp` and workspace volume only. |
| **Server-Side Request Forgery (SSRF)** | Build scripts or repository fetching fetching cloud metadata service (`http://169.254.169.254`) or internal database (`postgres:5432`) | Cloud IAM credential theft, internal database compromise | Network bridge restrictions: block access to `169.254.169.254` and private RFC-1918 subnets (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`) from the build network. Control plane runs on an isolated Docker network unreachable by build containers. |

## 3. Residual Risks & Future Hardening
1. **Container vs MicroVM Isolation**: Docker containers share the host Linux kernel. While namespaces and cgroups provide strong operational separation, multi-tenant untrusted code in high-risk environments should transition to Firecracker microVMs or gVisor runtimes.
2. **Egress Filtering**: In production clusters, outbound internet access during builds should be proxied through an egress filtering proxy enforcing domain whitelisting (e.g., `registry.npmjs.org`, `github.com`).
