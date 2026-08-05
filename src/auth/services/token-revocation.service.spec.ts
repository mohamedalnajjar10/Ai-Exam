import { TokenRevocationService } from './token-revocation.service';
import { RedisService } from '../redis/redis.service';

describe('TokenRevocationService', () => {
  let service: TokenRevocationService;
  let client: any;

  const createClient = () => {
    const strings = new Map<string, { value: string; expiresAt: number }>();
    return {
      async set(key: string, value: string, mode?: 'EX', ttlSeconds?: number) {
        const expiresAt =
          mode === 'EX' && ttlSeconds ? Date.now() + ttlSeconds * 1000 : 0;
        strings.set(key, { value, expiresAt });
        return 'OK';
      },
      async get(key: string) {
        const entry = strings.get(key);
        if (!entry) return null;
        if (entry.expiresAt && Date.now() > entry.expiresAt) {
          strings.delete(key);
          return null;
        }
        return entry.value;
      },
      async del(key: string) {
        return strings.delete(key) ? 1 : 0;
      },
      getKeys: () => [...strings.keys()],
    };
  };

  beforeEach(() => {
    client = createClient();
    service = new TokenRevocationService({
      getClient: () => client,
    } as unknown as RedisService);
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

    const [key] = client.getKeys();
    expect(key).not.toContain('raw-token-value');
    expect(key).toMatch(/^revoked-token:/);
  });

  it('degrades gracefully when no Redis client is available', async () => {
    const withoutRedis = new TokenRevocationService({
      getClient: () => undefined,
    } as unknown as RedisService);

    await expect(withoutRedis.revoke('token', 3600)).resolves.toBeUndefined();
    await expect(withoutRedis.isRevoked('token')).resolves.toBe(false);
  });
});
