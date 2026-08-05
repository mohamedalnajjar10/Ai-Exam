import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { Request } from 'express';
import { RedisService } from '../../redis/redis.service';
import {
  THROTTLE_METADATA,
  ThrottleOptions,
} from '../decorators/throttle.decorator';

/**
 * Guard that enforces per-client request limits on decorated endpoints.
 * Uses Redis when available (shared across instances) and falls back to an
 * in-memory store otherwise (single-instance/dev mode).
 */
@Injectable()
export class ThrottleGuard implements CanActivate {
  /** In-memory fallback store used when no Redis client is available */
  private readonly fallback = new Map<
    string,
    { count: number; resetAt: number }
  >();

  constructor(private readonly redisService: RedisService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const options: ThrottleOptions | undefined = Reflect.getMetadata(
      THROTTLE_METADATA,
      context.getHandler(),
    );
    if (!options) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request>();
    const ip =
      request.ip ??
      request.socket?.remoteAddress ??
      request.connection?.remoteAddress ??
      'unknown';
    const key = `auth-throttle:${ip}:${request.method}:${request.url}`;

    const allowed = await this.tryIncrement(
      key,
      options.limit,
      options.windowMs,
    );
    if (!allowed) {
      throw new HttpException(
        'Too many requests. Please try again later.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    return true;
  }

  private async tryIncrement(
    key: string,
    limit: number,
    windowMs: number,
  ): Promise<boolean> {
    try {
      const ttlSeconds = Math.max(1, Math.ceil(windowMs / 1000));
      const count = await this.redisService.incrWithExpiry(key, ttlSeconds);
      return count <= limit;
    } catch {
      // Redis unavailable — fall back to in-memory
    }

    // In-memory fallback (single instance / before Redis init)
    const now = Date.now();
    const entry = this.fallback.get(key);
    if (!entry || entry.resetAt <= now) {
      this.fallback.set(key, { count: 1, resetAt: now + windowMs });
      return true;
    }
    if (entry.count >= limit) {
      return false;
    }
    entry.count++;
    return true;
  }
}
