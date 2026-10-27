/// <reference types="jest" />
/// <reference types="node" />
/**
 * Integration tests for @deployforge/api — Auth & Health endpoints.
 *
 * Tests run against a real NestJS application instance but with
 * database operations mocked at the Prisma client level, so no
 * actual PostgreSQL connection is required.
 *
 * Run with: pnpm --filter @deployforge/api test
 */
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import * as argon2 from 'argon2';
import { AppModule } from '../src/app.module';
import { prisma as dbPrisma } from '@deployforge/database';

// ─── Mock @deployforge/database prisma client ────────────────────────────────
const mockUser = {
  id: 'user-abc-123',
  email: 'test@example.com',
  passwordHash: '',     // filled in beforeAll
  name: 'Test User',
  role: 'USER',
  createdAt: new Date('2026-01-01T00:00:00Z'),
};

jest.mock('@deployforge/database', () => ({
  UserRole: { USER: 'USER', ADMIN: 'ADMIN' },
  prisma: {
    user: {
      findUnique: jest.fn(),
      create: jest.fn(),
    },
    $queryRaw: jest.fn().mockResolvedValue([{ '?column?': 1 }]),
    $disconnect: jest.fn(),
  },
}));

// Mock BullMQ Queue so no Redis connection is needed
jest.mock('bullmq', () => ({
  Queue: jest.fn().mockImplementation(() => ({
    add: jest.fn().mockResolvedValue({ id: 'job-1' }),
    close: jest.fn(),
    on: jest.fn(),
  })),
  Worker: jest.fn().mockImplementation(() => ({
    on: jest.fn(),
    close: jest.fn(),
  })),
}));

const prisma = dbPrisma as unknown as {
  user: {
    findUnique: jest.Mock;
    create: jest.Mock;
  };
  $queryRaw: jest.Mock;
  $disconnect: jest.Mock;
};

// ─── Test app factory ─────────────────────────────────────────────────────────
async function createApp(): Promise<INestApplication> {
  process.env.NODE_ENV = 'test';
  process.env.DATABASE_URL = 'postgresql://mock:mock@localhost:5432/mock';
  process.env.JWT_SECRET = 'test-jwt-secret-that-is-long-enough';
  process.env.SESSION_SECRET = 'test-session-secret-long-enough-xxx';
  process.env.ENCRYPTION_KEY = 'a'.repeat(64);
  process.env.REDIS_HOST = 'localhost';
  process.env.REDIS_PORT = '6379';

  const moduleFixture: TestingModule = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  const app = moduleFixture.createNestApplication();
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
  await app.init();
  return app;
}

// ─── Test suite ───────────────────────────────────────────────────────────────
describe('DeployForge API', () => {
  let app: INestApplication;
  jest.setTimeout(30000);

  beforeAll(async () => {
    mockUser.passwordHash = await argon2.hash('Passw0rd!', {
      type: argon2.argon2id,
      memoryCost: 4096,
      timeCost: 2,
    });
    app = await createApp();
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
  });

  // ── Health endpoint ──────────────────────────────────────────────────────────
  describe('GET /api/v1/health', () => {
    it('returns 200 with status ok or degraded', async () => {
      const res = await request(app.getHttpServer()).get('/api/v1/health');
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('status');
      expect(['ok', 'degraded']).toContain(res.body.status);
      expect(res.body).toHaveProperty('services');
      expect(res.body.services).toHaveProperty('database');
    });
  });

  // ── Auth: Register ───────────────────────────────────────────────────────────
  describe('POST /api/v1/auth/register', () => {
    it('registers a new user and returns a token', async () => {
      prisma.user.findUnique.mockResolvedValueOnce(null);        // no existing user
      prisma.user.create.mockResolvedValueOnce({ ...mockUser }); // user created

      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({ email: 'test@example.com', password: 'Passw0rd!', name: 'Test User' });

      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty('token');
      expect(typeof res.body.token).toBe('string');
      expect(res.body.user).toHaveProperty('email', 'test@example.com');
      expect(res.body.user).not.toHaveProperty('passwordHash');
    });

    it('returns 409 when email is already registered', async () => {
      prisma.user.findUnique.mockResolvedValueOnce({ ...mockUser });

      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({ email: 'test@example.com', password: 'Passw0rd!' });

      expect(res.status).toBe(409);
    });

    it('returns 400 for a missing password', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({ email: 'test@example.com' });
      expect(res.status).toBe(400);
    });

    it('returns 400 for a weak password (too short)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({ email: 'new@example.com', password: 'abc' });
      expect(res.status).toBe(400);
    });
  });

  // ── Auth: Login ──────────────────────────────────────────────────────────────
  describe('POST /api/v1/auth/login', () => {
    it('returns 200 with access_token for valid credentials', async () => {
      prisma.user.findUnique.mockResolvedValueOnce({ ...mockUser });

      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: 'test@example.com', password: 'Passw0rd!' });

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('token');
    });

    it('returns 401 for wrong password', async () => {
      prisma.user.findUnique.mockResolvedValueOnce({ ...mockUser });

      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: 'test@example.com', password: 'WrongPassword1!' });

      expect(res.status).toBe(401);
    });

    it('returns 401 for unknown email (no account enumeration)', async () => {
      prisma.user.findUnique.mockResolvedValueOnce(null);

      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: 'nobody@example.com', password: 'Passw0rd!' });

      expect(res.status).toBe(401);
      // Generic message — does not reveal existence of account
      expect(res.body.message).toBe('Invalid email or password');
    });
  });

  // ── Protected routes without token ──────────────────────────────────────────
  describe('GET /api/v1/projects (requires auth)', () => {
    it('returns 401 when no Authorization header is provided', async () => {
      const res = await request(app.getHttpServer()).get('/api/v1/projects');
      expect(res.status).toBe(401);
    });
  });
});
