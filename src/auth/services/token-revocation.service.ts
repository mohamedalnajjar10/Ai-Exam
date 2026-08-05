import { Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import { RedisService } from '../../redis/redis.service';

/**
 * Server-side JWT revocation using a Redis denylist.
 * Revoked tokens stay blocked until their original expiry time.
 */
@Injectable()
export class TokenRevocationService {
  constructor(private readonly redisService: RedisService) {}

  async revoke(token: string, ttlSeconds: number): Promise<void> {
    if (ttlSeconds <= 0) return;
    const redis: any = this.redisService.getClient();
    if (!redis) return;
    await redis.set(this.key(token), '1', 'EX', ttlSeconds);
  }

  async isRevoked(token: string): Promise<boolean> {
    const redis: any = this.redisService.getClient();
    if (!redis) return false;
    const value = await redis.get(this.key(token));
    return value !== null && value !== undefined;
  }

  private key(token: string): string {
    const hash = createHash('sha256').update(token).digest('hex');
    return `revoked-token:${hash}`;
  }
}
