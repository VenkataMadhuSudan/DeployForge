# DeployForge Security Policy & Implementation Controls

## 1. Authentication & Password Security
* **Password Hashing**: Passwords are saved as Argon2id hashes with memory cost 65536 KiB, time cost 3 iterations, and parallelism 4. Plaintext passwords are never logged, stored, or cached.
* **Authentication Transport**: Session / Bearer authentication using signed tokens. Cookie options in production enforce `HttpOnly; Secure; SameSite=Strict; Path=/`.
* **Rate Limiting**: Authentication endpoints (`/api/v1/auth/login`, `/api/v1/auth/register`) are protected by IP and username based rate limiters.
* **Timing-Safe Operations**: Password verification and webhook signatures use constant-time comparisons (`crypto.timingSafeEqual`) to prevent side-channel timing attacks.

## 2. Authorization & Tenant Isolation
* **Broken Object-Level Authorization (BOLA) Prevention**: Every request to `/api/v1/projects/:id/*` verifies through `ProjectOwnershipGuard` that `req.user.id` matches `project.ownerId` or an active `ProjectMember` record with necessary permissions.
* **Cross-Tenant Boundary**: Users cannot query or inspect deployments, logs, or secrets belonging to other projects or users. Unit and integration tests explicitly test that User B receives `403 Forbidden` or `404 Not Found` when requesting User A's project resources.

## 3. Cryptographic Storage & Secrets Protection
* **Envelope / AES-256-GCM Encryption**: All sensitive environment variable values and integration tokens are encrypted using AES-256-GCM with a 96-bit random IV, producing `iv:authTag:ciphertext`.
* **Zero Secret Exposure**: When querying `/api/v1/projects/:id/env`, secret values are masked (e.g. `••••••••`) and the decrypted ciphertext is never returned to the frontend.
* **Log Redaction**: During build pipeline execution, all configured secrets for that project are registered with the `SecretRedactor` stream which replaces matches with `[REDACTED_SECRET]` before saving to the database or emitting logs.

## 4. Isolated Build Sandbox
* **User & Capabilities**: Containers run under dedicated non-root user (UID `10001:10001`), dropping all Linux capabilities (`cap-drop: ALL`).
* **Resource Quotas**: Hard cgroups memory limit (1024MB), CPU allocation (1.0 core), maximum processes (100 PIDs), and maximum disk space (2GB).
* **Network Isolation**: The build network does not share access to the control-plane database or Redis instances.
* **Timeout Enforcement**: Worker enforces a strict timeout (default: 600s / 10 minutes). Containers exceeding the timeout are forcibly terminated and cleaned up.

## 5. Webhook Integrity & Deduplication
* **Signature Validation**: Raw payload bytes are verified against `X-Hub-Signature-256` using the configured `GITHUB_WEBHOOK_SECRET`.
* **Deduplication**: `X-GitHub-Delivery` header is checked against the `WebhookEvent` table with unique constraint. Duplicate deliveries return `200 OK` with `already_processed` status without duplicate job enqueueing.
