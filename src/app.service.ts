import { Injectable } from '@nestjs/common';
import { PrismaService } from './prisma/prisma.service';
import { RedisService } from './redis/redis.service';

@Injectable()
export class AppService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
  ) {}

  getHello(): string {
    return 'مرحباً بالعالم!';
  }

  async getHealth(): Promise<{
    status: string;
    timestamp: string;
    services: { database: string; redis: string };
  }> {
    const services = { database: 'ok', redis: 'ok' };

    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      services.database = 'error';
    }

    try {
      await this.redisService.set('health-check', '1', 10);
    } catch {
      services.redis = 'error';
    }

    const status =
      services.database === 'ok' && services.redis === 'ok' ? 'ok' : 'degraded';

    return {
      status,
      timestamp: new Date().toISOString(),
      services,
    };
  }
}
