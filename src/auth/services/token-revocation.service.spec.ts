import { TokenRevocationService } from './token-revocation.service';
import { RedisService } from '../redis/redis.service';

describe('TokenRevocationService', () => {
  let service: TokenRevocationService;
  let store: Map<string, { value: string; expiresAt: number }>;

  const createRedisMock = () => {
    store = new Map();
    return {
      async set(key: string, value: string, ttlSeconds?: number) {
        const expiresAt = ttlSeconds ? Date.now() + ttlSeconds * 1000 : 0;
        store.set(key, { value, expiresAt });
      },
      async get(key: string) {
        const entry = store.get(key);
        if (!entry) return null;
        if (entry.expiresAt && Date.now() > entry.expiresAt) {
          store.delete(key);
          return null;
        }
        return entry.value;
      },
      async del(key: string) {
        return store.delete(key) ? 1 : 0;
      },
      getKeys: () => [...store.keys()],
    };
  };

  beforeEach(() => {
    const redisMock = createRedisMock();
    service = new TokenRevocationService(redisMock as unknown as RedisService);
  });

  it('marks a token as revoked', async () => {
    await service.revoke('some-jwt-token', 3600);

    expect(await service.isRevoked('some-jwt-token')).toBe(true);
  });

  it('does not flag unknown tokens as revoked', async () => {
    expect(await service.isRevoked('other-token')).toBe(false);
  });

  it('hashes the token before storing it (never stores raw tokens)', async () => {
    await service.revoke('raw-token-value', 3600);

    const [key] = [...store.keys()];
    expect(key).not.toContain('raw-token-value');
    expect(key).toMatch(/^revoked-token:/);
  });

  it('degrades gracefully when no Redis client is available', async () => {
    const withoutRedis = new TokenRevocationService({
      set: undefined,
      get: undefined,
    } as unknown as RedisService);

    await expect(withoutRedis.revoke('token', 3600)).resolves.toBeUndefined();
    await expect(withoutRedis.isRevoked('token')).resolves.toBe(false);
  });
});
