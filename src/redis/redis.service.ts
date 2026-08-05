import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

// Mock Redis client for development
class MockRedis {
  private data: Map<string, { score: number; member: string }[]> = new Map();
  private strings: Map<string, { value: string; expiresAt: number }> =
    new Map();
  private expirations: Map<string, number> = new Map();

  async set(
    key: string,
    value: string,
    mode?: 'EX',
    ttlSeconds?: number,
  ): Promise<string> {
    const expiresAt =
      mode === 'EX' && ttlSeconds ? Date.now() + ttlSeconds * 1000 : 0;
    this.strings.set(key, { value, expiresAt });
    return 'OK';
  }

  async get(key: string): Promise<string | null> {
    const entry = this.strings.get(key);
    if (!entry) return null;
    if (entry.expiresAt && Date.now() > entry.expiresAt) {
      this.strings.delete(key);
      return null;
    }
    return entry.value;
  }

  async del(key: string): Promise<number> {
    return this.strings.delete(key) ? 1 : 0;
  }

  async zremrangebyscore(
    key: string,
    min: number,
    max: number,
  ): Promise<number> {
    const members = this.data.get(key) || [];
    const newMembers = members.filter(
      (item) => item.score < min || item.score > max,
    );
    const removed = members.length - newMembers.length;
    this.data.set(key, newMembers);
    return removed;
  }

  async zcard(key: string): Promise<number> {
    return this.data.get(key)?.length || 0;
  }

  async zadd(key: string, ...args: any[]): Promise<number> {
    const members = this.data.get(key) || [];
    for (let i = 0; i < args.length; i += 2) {
      const score = Number(args[i]);
      const member = args[i + 1];
      members.push({ score, member });
    }
    this.data.set(key, members);
    return args.length / 2;
  }

  async pexpire(key: string, milliseconds: number): Promise<number> {
    this.expirations.set(key, Date.now() + milliseconds);
    return 1;
  }

  async quit(): Promise<void> {
    this.data.clear();
    this.expirations.clear();
    this.strings.clear();
  }
}

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private client: Redis | MockRedis;
  private useMock = false;

  constructor(private readonly configService: ConfigService) {}

  async onModuleInit() {
    const redisUrl = this.configService.get<string>('REDIS_URL');
    const nodeEnv = this.configService.get<string>('NODE_ENV');
    const useMock =
      nodeEnv === 'development' || nodeEnv === 'test' || !redisUrl;

    if (useMock) {
      this.useMock = true;
      this.client = new MockRedis();
      console.log(
        'Using mock Redis client (development mode or no REDIS_URL provided)',
      );
    } else {
      this.client = new Redis(redisUrl);
    }
  }

  async onModuleDestroy() {
    if (this.client && !this.useMock) {
      await (this.client as Redis).quit();
    }
  }

  getClient(): Redis | MockRedis {
    return this.client;
  }
}
