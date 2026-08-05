import { Test, TestingModule } from '@nestjs/testing';
import { ExecutionContext, HttpException } from '@nestjs/common';
import { ThrottleGuard } from './throttle.guard';
import { RedisService } from '../../redis/redis.service';
import { THROTTLE_METADATA } from '../decorators/throttle.decorator';

/** Minimal in-memory Redis stand-in */
class FakeRedis {
  private store = new Map<string, string>();

  get(key: string): string | null {
    return this.store.get(key) ?? null;
  }

  set(key: string, value: string): string {
    this.store.set(key, value);
    return 'OK';
  }
}

describe('ThrottleGuard', () => {
  let guard: ThrottleGuard;
  let fakeRedis: FakeRedis;

  const makeContext = (): ExecutionContext => {
    const handler = () => undefined;
    Reflect.defineMetadata(
      THROTTLE_METADATA,
      { limit: 3, windowMs: 60_000 },
      handler,
    );
    return {
      getHandler: () => handler,
      switchToHttp: () => ({
        getRequest: () => ({
          ip: '127.0.0.1',
          method: 'POST',
          url: '/auth/login',
          socket: { remoteAddress: '127.0.0.1' },
          connection: { remoteAddress: '127.0.0.1' },
        }),
      }),
    } as unknown as ExecutionContext;
  };

  beforeEach(async () => {
    fakeRedis = new FakeRedis();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ThrottleGuard,
        { provide: RedisService, useValue: { getClient: () => fakeRedis } },
      ],
    }).compile();
    guard = module.get<ThrottleGuard>(ThrottleGuard);
  });

  it('allows requests while under the limit', async () => {
    for (let i = 0; i < 3; i++) {
      await expect(guard.canActivate(makeContext())).resolves.toBe(true);
    }
  });

  it('rejects requests once the limit is exceeded', async () => {
    const context = makeContext();
    for (let i = 0; i < 3; i++) {
      await guard.canActivate(context);
    }
    await expect(guard.canActivate(context)).rejects.toThrow(HttpException);
  });

  it('does not throttle endpoints without throttle metadata', async () => {
    const handler = () => undefined;
    const context = {
      getHandler: () => handler,
      switchToHttp: () => ({
        getRequest: () => ({ ip: '127.0.0.1' }),
      }),
    } as unknown as ExecutionContext;

    await expect(guard.canActivate(context)).resolves.toBe(true);
  });

  it('counts different clients independently', async () => {
    const makeIpContext = (ip: string): ExecutionContext => {
      const handler = () => undefined;
      Reflect.defineMetadata(
        THROTTLE_METADATA,
        { limit: 1, windowMs: 60_000 },
        handler,
      );
      return {
        getHandler: () => handler,
        switchToHttp: () => ({
          getRequest: () => ({
            ip,
            socket: { remoteAddress: ip },
            connection: { remoteAddress: ip },
          }),
        }),
      } as unknown as ExecutionContext;
    };

    await guard.canActivate(makeIpContext('1.1.1.1'));
    await expect(guard.canActivate(makeIpContext('2.2.2.2'))).resolves.toBe(
      true,
    );
  });
});
