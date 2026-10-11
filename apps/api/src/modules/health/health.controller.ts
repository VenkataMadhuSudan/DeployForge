import { Controller, Get } from '@nestjs/common';
import { prisma } from '@deployforge/database';
import Redis from 'ioredis';
import { loadConfig } from '@deployforge/configuration';

@Controller('health')
export class HealthController {
  @Get()
  async check() {
    const config = loadConfig();
    let dbStatus = 'down';
    let redisStatus = 'down';

    // 1. Check PostgreSQL
    try {
      await prisma.$queryRaw`SELECT 1`;
      dbStatus = 'healthy';
    } catch {
      dbStatus = 'unreachable';
    }

    // 2. Check Redis
    try {
      const redis = new Redis({
        host: config.REDIS_HOST,
        port: config.REDIS_PORT,
        password: config.REDIS_PASSWORD || undefined,
        connectTimeout: 2000,
        maxRetriesPerRequest: 1,
      });
      const res = await redis.ping();
      if (res === 'PONG') {
        redisStatus = 'healthy';
      }
      redis.disconnect();
    } catch {
      redisStatus = 'unreachable';
    }

    const isSystemHealthy = dbStatus === 'healthy' && redisStatus === 'healthy';

    return {
      status: isSystemHealthy ? 'ok' : 'degraded',
      timestamp: new Date().toISOString(),
      services: {
        database: dbStatus,
        redis: redisStatus,
      },
    };
  }
}
