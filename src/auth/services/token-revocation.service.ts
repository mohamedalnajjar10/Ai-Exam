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
    if (!this.redisService?.set) return;
    await this.redisService.set(this.key(token), '1', ttlSeconds);
  }

  async isRevoked(token: string): Promise<boolean> {
    if (!this.redisService?.get) return false;
    const value = await this.redisService.get(this.key(token));
    return value !== null && value !== undefined;
  }

  private key(token: string): string {
    const hash = createHash('sha256').update(token).digest('hex');
    return `revoked-token:${hash}`;
  }
}
