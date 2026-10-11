# DeployForge Deployment & Operations Guide

## 1. Prerequisites
- Docker & Docker Compose v2+
- Node.js v20+ or v24+
- pnpm v9+ or v10+

## 2. Environment Setup

Create `.env` based on `.env.example`:
```bash
cp .env.example .env
```
Ensure `ENCRYPTION_KEY` is a 32-byte hexadecimal string (64 hex characters):
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

## 3. Local Development with Docker Compose

Run the supporting services (PostgreSQL, Redis):
```bash
docker compose -f infrastructure/compose/docker-compose.yml up -d postgres redis
```

Apply database migrations and generate the Prisma Client:
```bash
pnpm --filter @deployforge/database prisma migrate dev
```

Start all microservices in development mode:
```bash
pnpm dev
```
Services will be accessible at:
- Frontend Dashboard: `http://localhost:3000`
- Backend API: `http://localhost:4000/api/v1`
- Swagger Documentation: `http://localhost:4000/docs`
- Health Check: `http://localhost:4000/api/v1/health`

## 4. Full Containerized Deployment

To launch the full stack (PostgreSQL, Redis, API, Worker, Web) via Docker Compose:
```bash
docker compose -f infrastructure/compose/docker-compose.yml up --build -d
```

## 5. Database Backup and Disaster Recovery

### Backup
```bash
docker compose -f infrastructure/compose/docker-compose.yml exec -T postgres pg_dump -U deployforge deployforge_db > backup_$(date +%Y%m%d_%H%M%S).sql
```

### Restore
```bash
docker compose -f infrastructure/compose/docker-compose.yml exec -T postgres psql -U deployforge deployforge_db < backup_file.sql
```

## 6. Hosting Provider Configuration

### Local Testing Provider
Default configuration requires no external credentials:
- `HOSTING_PROVIDER=LOCAL_TESTING`
- Artifacts are stored in `./storage/deployments` and served locally with status badge `LOCAL_DEPLOYMENT`.

### Cloudflare Pages Provider
To deploy directly to Cloudflare Pages:
- `HOSTING_PROVIDER=CLOUDFLARE_PAGES`
- `CLOUDFLARE_ACCOUNT_ID=<your-cf-account-id>`
- `CLOUDFLARE_API_TOKEN=<your-cf-api-token>`
The adapter verifies authentication and publishes built assets using Cloudflare Pages Direct Upload API.
