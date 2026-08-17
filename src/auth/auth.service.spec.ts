import { Test, TestingModule } from '@nestjs/testing';
import {
  ConflictException,
  UnauthorizedException,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'crypto';
import * as bcrypt from 'bcryptjs';
import { AuthService } from './services/auth.service';
import { TokenService } from './services/token.service';
import { TwoFactorService } from './services/two-factor.service';
import { OAuthService } from './services/oauth.service';
import { PasswordService } from './services/password.service';
import { PrismaService } from '../prisma/prisma.service';
import { TokenRevocationService } from './services/token-revocation.service';
import { RedisService } from '../redis/redis.service';
import { MailService } from '../mail/mail.service';
import { generateTotpCode, generateTotpSecret } from './utils/totp.util';

/** Minimal in-memory Redis stand-in used for unit tests */
class FakeRedis {
  private store = new Map<string, { value: string; expiresAt: number }>();
  private counters = new Map<string, { count: number; expiresAt: number }>();

  async set(
    key: string,
    value: string,
    _mode?: 'EX',
    ttlSeconds?: number,
  ): Promise<string> {
    this.store.set(key, {
      value,
      expiresAt: ttlSeconds ? Date.now() + ttlSeconds * 1000 : 0,
    });
    return 'OK';
  }

  async get(key: string): Promise<string | null> {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (entry.expiresAt && Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return null;
    }
    return entry.value;
  }

  async del(key: string): Promise<number> {
    return this.store.delete(key) ? 1 : 0;
  }

  async incrWithExpiry(key: string, ttlSeconds: number): Promise<number> {
    const entry = this.counters.get(key);
    if (!entry || (entry.expiresAt !== 0 && Date.now() > entry.expiresAt)) {
      this.counters.set(key, {
        count: 1,
        expiresAt: Date.now() + ttlSeconds * 1000,
      });
      return 1;
    }
    entry.count++;
    return entry.count;
  }
}

describe('AuthService', () => {
  let service: AuthService;
  let prisma: {
    user: {
      findUnique: jest.Mock;
      findFirst: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
    };
    refreshToken: {
      findUnique: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      updateMany: jest.Mock;
    };
  };
  let tokenRevocation: { revoke: jest.Mock; isRevoked: jest.Mock };
  let mailService: {
    sendPasswordResetEmail: jest.Mock;
    sendVerificationEmail: jest.Mock;
  };
  let configService: { get: jest.Mock };
  let fakeRedis: FakeRedis;
  let redisService: { getClient: jest.Mock; incrWithExpiry: jest.Mock };

  const validDto = {
    name: 'Ahmed Ali',
    email: 'ahmed@example.com',
    password: 'StrongPass123',
  };

  let hashedPassword: string;

  const makeUser = (overrides: any = {}) => ({
    id: 'user-1',
    name: validDto.name,
    email: validDto.email,
    passwordHash: hashedPassword,
    twoFactorEnabled: false,
    twoFactorSecret: null,
    emailVerified: false,
    oauthProvider: null,
    oauthProviderId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  });

  beforeAll(async () => {
    hashedPassword = await bcrypt.hash(validDto.password, 10);
  });

  afterAll(() => {
    if ((global as any).fetch && (global as any).fetch.mockRestore) {
      (global as any).fetch.mockRestore();
    }
  });

  /** Mocks the two Google API calls used by OAuth (token exchange + userinfo) */
  const mockGoogleApis = (profile: any = {}) => {
    (global as any).fetch = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: jest
          .fn()
          .mockResolvedValue({ access_token: 'google-access-token' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: jest.fn().mockResolvedValue({
          id: 'google-id-1',
          email: validDto.email,
          name: validDto.name,
          verified_email: true,
          ...profile,
        }),
      });
  };

  beforeEach(async () => {
    prisma = {
      user: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      refreshToken: {
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
    };
    tokenRevocation = {
      revoke: jest.fn(),
      isRevoked: jest.fn().mockResolvedValue(false),
    };
    mailService = {
      sendPasswordResetEmail: jest.fn(),
      sendVerificationEmail: jest.fn(),
    };
    fakeRedis = new FakeRedis();
    redisService = {
      set: jest.fn((key: string, value: string, ttlSeconds?: number) =>
        fakeRedis.set(key, value, 'EX', ttlSeconds),
      ),
      get: jest.fn((key: string) => fakeRedis.get(key)),
      del: jest.fn((key: string) => fakeRedis.del(key)),
      incrWithExpiry: jest.fn((key: string, ttlSeconds: number) =>
        fakeRedis.incrWithExpiry(key, ttlSeconds),
      ),
      getClient: jest.fn(() => fakeRedis),
    };
    configService = {
      get: jest.fn((key: string) => {
        if (key === 'FRONTEND_URL') return 'http://localhost:3000';
        if (key === 'BACKEND_URL') return 'http://localhost:8087';
        if (key === 'GOOGLE_CLIENT_ID') return 'google-client-id';
        if (key === 'GOOGLE_CLIENT_SECRET') return 'google-client-secret';
        return undefined;
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      imports: [JwtModule.register({ secret: 'test-secret' })],
      providers: [
        AuthService,
        TokenService,
        TwoFactorService,
        OAuthService,
        PasswordService,
        { provide: PrismaService, useValue: prisma },
        { provide: TokenRevocationService, useValue: tokenRevocation },
        { provide: RedisService, useValue: redisService },
        { provide: MailService, useValue: mailService },
        { provide: ConfigService, useValue: configService },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  describe('register', () => {
    it('creates an account without issuing tokens until the email is verified', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      const created = makeUser({ createdAt: new Date() });
      prisma.user.create.mockResolvedValue(created);

      const result: any = await service.register(validDto);

      expect(result.message).toContain('رمز التحقق');
      expect(result.accessToken).toBeUndefined();
      expect(result.refreshToken).toBeUndefined();
      expect(result.user).toBeUndefined();
      expect(prisma.refreshToken.create).not.toHaveBeenCalled();
    });

    it('emails a verification code after creating the account', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.user.create.mockImplementation(async ({ data }) => ({
        id: 'user-1',
        ...data,
        emailVerified: false,
        twoFactorEnabled: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      }));

      await service.register(validDto);

      expect(mailService.sendVerificationEmail).toHaveBeenCalledWith(
        validDto.email,
        expect.stringMatching(/^\d{6}$/),
      );
      const code: string = mailService.sendVerificationEmail.mock.calls[0][1];
      expect(await fakeRedis.get('email-verification:user-1')).toBe(code);
    });

    it('stores the password hashed (never plaintext)', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.user.create.mockImplementation(async ({ data }) => ({
        id: 'user-1',
        ...data,
        createdAt: new Date(),
        updatedAt: new Date(),
      }));

      await service.register(validDto);

      const stored = prisma.user.create.mock.calls[0][0].data;
      expect(stored.passwordHash).toBeDefined();
      expect(stored.passwordHash).not.toBe(validDto.password);
      expect(await bcrypt.compare(validDto.password, stored.passwordHash)).toBe(
        true,
      );
    });

    it('rejects registration when the email is already registered', async () => {
      prisma.user.findUnique.mockResolvedValue(makeUser());

      await expect(service.register(validDto)).rejects.toThrow(
        ConflictException,
      );
      expect(prisma.user.create).not.toHaveBeenCalled();
    });
  });

  describe('login', () => {
    it('issues a valid access JWT for correct credentials', async () => {
      prisma.user.findUnique.mockResolvedValue(
        makeUser({ emailVerified: true }),
      );

      const result: any = await service.login(validDto);

      expect(result.accessToken).toBeDefined();
      expect(result).not.toHaveProperty('requiresTwoFactor');

      const decoded: any = service['jwtService'].decode(result.accessToken);
      expect(decoded.sub).toBe('user-1');
      expect(decoded.email).toBe(validDto.email);
      expect(decoded.type).toBe('access');
    });

    it('rejects login until the email is verified', async () => {
      prisma.user.findUnique.mockResolvedValue(makeUser());

      await expect(service.login(validDto)).rejects.toThrow(ForbiddenException);
    });

    it('rejects an unknown email', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(service.login(validDto)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('rejects a wrong password', async () => {
      prisma.user.findUnique.mockResolvedValue(
        makeUser({ emailVerified: true }),
      );

      await expect(
        service.login({ ...validDto, password: 'WrongPass123' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('rejects an OAuth-only account without a password', async () => {
      prisma.user.findUnique.mockResolvedValue(
        makeUser({ passwordHash: null, emailVerified: true }),
      );

      await expect(service.login(validDto)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('requests a verification code instead of issuing a JWT when 2FA is enabled', async () => {
      const secret = generateTotpSecret();
      prisma.user.findUnique.mockResolvedValue(
        makeUser({
          twoFactorEnabled: true,
          twoFactorSecret: secret,
          emailVerified: true,
        }),
      );

      const result: any = await service.login(validDto);

      expect(result.requiresTwoFactor).toBe(true);
      expect(result.loginToken).toBeDefined();
      expect(result.accessToken).toBeUndefined();

      const decoded: any = service['jwtService'].decode(result.loginToken);
      expect(decoded.sub).toBe('user-1');
      expect(decoded.type).toBe('two-factor-login');
    });
  });

  describe('verifyTwoFactor', () => {
    it('issues an access JWT when the code is correct', async () => {
      const secret = generateTotpSecret();
      prisma.user.findUnique
        .mockResolvedValueOnce(
          makeUser({
            twoFactorEnabled: true,
            twoFactorSecret: secret,
            emailVerified: true,
          }),
        )
        .mockResolvedValue(
          makeUser({
            twoFactorEnabled: true,
            twoFactorSecret: secret,
            emailVerified: true,
          }),
        );

      const loginResult: any = await service.login(validDto);
      const code = generateTotpCode(secret);

      const result = await service.verifyTwoFactor({
        loginToken: loginResult.loginToken,
        code,
      });

      expect(result.accessToken).toBeDefined();
      const decoded: any = service['jwtService'].decode(result.accessToken);
      expect(decoded.sub).toBe('user-1');
      expect(decoded.type).toBe('access');
    });

    it('rejects an incorrect verification code', async () => {
      const secret = generateTotpSecret();
      prisma.user.findUnique
        .mockResolvedValueOnce(
          makeUser({
            twoFactorEnabled: true,
            twoFactorSecret: secret,
            emailVerified: true,
          }),
        )
        .mockResolvedValue(
          makeUser({
            twoFactorEnabled: true,
            twoFactorSecret: secret,
            emailVerified: true,
          }),
        );

      const loginResult: any = await service.login(validDto);

      await expect(
        service.verifyTwoFactor({
          loginToken: loginResult.loginToken,
          code: '000000',
        }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('rejects when 2FA is not enabled on the account', async () => {
      const loginToken = await service['jwtService'].signAsync(
        { sub: 'user-1', email: validDto.email, type: 'two-factor-login' },
        { expiresIn: '5m' },
      );
      prisma.user.findUnique.mockResolvedValue(
        makeUser({ twoFactorEnabled: false }),
      );

      await expect(
        service.verifyTwoFactor({ loginToken, code: '123456' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('rejects an invalid or tampered login token', async () => {
      await expect(
        service.verifyTwoFactor({ loginToken: 'not-a-jwt', code: '123456' }),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('logout', () => {
    it('revokes the access token so it becomes invalid', async () => {
      prisma.user.findUnique.mockResolvedValue(
        makeUser({ emailVerified: true }),
      );
      const loginResult: any = await service.login(validDto);

      const result = await service.logout(loginResult.accessToken);

      expect(result.message).toBe('تم تسجيل الخروج بنجاح');
      expect(tokenRevocation.revoke).toHaveBeenCalledWith(
        loginResult.accessToken,
        expect.any(Number),
      );
    });

    it('revokes with a TTL that expires at the token expiry time', async () => {
      const token = await service['jwtService'].signAsync(
        { sub: 'user-1', email: validDto.email, type: 'access' },
        { expiresIn: 60 },
      );

      await service.logout(token);

      const ttl = tokenRevocation.revoke.mock.calls[0][1];
      expect(ttl).toBeGreaterThan(0);
      expect(ttl).toBeLessThanOrEqual(60);
    });
  });

  describe('refresh', () => {
    it('issues a new token pair for a valid refresh token', async () => {
      prisma.user.findUnique.mockResolvedValue(
        makeUser({ emailVerified: true }),
      );
      const loginResult: any = await service.login(validDto);
      prisma.refreshToken.findUnique.mockResolvedValue({
        id: 'rt-1',
        userId: 'user-1',
        tokenHash: 'hash',
        expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 7),
        revokedAt: null,
        createdAt: new Date(),
      });

      const result: any = await service.refresh(loginResult.refreshToken);

      expect(result.accessToken).toBeDefined();
      expect(result.refreshToken).toBeDefined();
      expect(result.refreshToken).not.toBe(loginResult.refreshToken);
      expect(prisma.refreshToken.update).toHaveBeenCalled();
    });

    it('rejects a token that is not a JWT', async () => {
      await expect(service.refresh('not-a-jwt')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('rejects an access token used as a refresh token', async () => {
      prisma.user.findUnique.mockResolvedValue(
        makeUser({ emailVerified: true }),
      );
      const loginResult: any = await service.login(validDto);

      await expect(service.refresh(loginResult.accessToken)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('rejects a revoked refresh token and revokes the whole token family', async () => {
      prisma.user.findUnique.mockResolvedValue(
        makeUser({ emailVerified: true }),
      );
      const loginResult: any = await service.login(validDto);
      prisma.refreshToken.findUnique.mockResolvedValue({
        id: 'rt-1',
        userId: 'user-1',
        tokenHash: 'hash',
        expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 7),
        revokedAt: new Date(),
        createdAt: new Date(),
      });

      await expect(service.refresh(loginResult.refreshToken)).rejects.toThrow(
        UnauthorizedException,
      );
      expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
        where: { userId: 'user-1', revokedAt: null },
        data: { revokedAt: expect.any(Date) },
      });
    });
  });

  describe('getProfile', () => {
    it('returns the user profile without sensitive fields', async () => {
      const user = makeUser({ createdAt: new Date() });
      prisma.user.findUnique.mockResolvedValue(user);

      const result = await service.getProfile('user-1');

      expect(result).toEqual({
        id: 'user-1',
        name: validDto.name,
        email: validDto.email,
        emailVerified: false,
        twoFactorEnabled: false,
        createdAt: user.createdAt,
      });
      expect(result).not.toHaveProperty('passwordHash');
      expect(result).not.toHaveProperty('twoFactorSecret');
    });

    it('throws NotFound when the user does not exist', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(service.getProfile('missing')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('setupTwoFactor', () => {
    it('generates a secret and otpauth URL, and stores the secret', async () => {
      const user = makeUser();
      prisma.user.findUnique.mockResolvedValue(user);
      prisma.user.update.mockResolvedValue(user);

      const result = await service.setupTwoFactor('user-1');

      expect(result.secret).toBeDefined();
      expect(result.otpauthUrl).toContain('otpauth://totp/');
      expect(result.otpauthUrl).toContain(validDto.email.replace('@', '%40'));
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { twoFactorSecret: result.secret },
      });
    });

    it('rejects setup when 2FA is already enabled', async () => {
      prisma.user.findUnique.mockResolvedValue(
        makeUser({ twoFactorEnabled: true }),
      );

      await expect(service.setupTwoFactor('user-1')).rejects.toThrow(
        ConflictException,
      );
    });

    it('throws NotFound when the user does not exist', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(service.setupTwoFactor('missing')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('enableTwoFactor', () => {
    it('enables 2FA, returns recovery codes and revokes existing sessions', async () => {
      const secret = generateTotpSecret();
      prisma.user.findUnique.mockResolvedValue(
        makeUser({ twoFactorSecret: secret }),
      );
      prisma.user.update.mockResolvedValue(
        makeUser({ twoFactorEnabled: true, twoFactorSecret: secret }),
      );

      const code = generateTotpCode(secret);
      const result = await service.enableTwoFactor('user-1', { code });

      expect(result.message).toBe(
        'Two-factor authentication enabled successfully',
      );
      expect(Array.isArray(result.recoveryCodes)).toBe(true);
      expect(result.recoveryCodes).toHaveLength(10);
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { twoFactorEnabled: true },
      });
      expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
        where: { userId: 'user-1', revokedAt: null },
        data: { revokedAt: expect.any(Date) },
      });
    });

    it('stores hashed (never plaintext) recovery codes in Redis', async () => {
      const secret = generateTotpSecret();
      prisma.user.findUnique.mockResolvedValue(
        makeUser({ twoFactorSecret: secret }),
      );
      prisma.user.update.mockResolvedValue(
        makeUser({ twoFactorEnabled: true, twoFactorSecret: secret }),
      );

      const code = generateTotpCode(secret);
      const result = await service.enableTwoFactor('user-1', { code });

      const raw = await fakeRedis.get('2fa-recovery:user-1');
      const storedHashes = JSON.parse(raw);
      const sampleHash = result.recoveryCodes[0].replace('-', '').toUpperCase();
      const expectedHash = createHash('sha256')
        .update(sampleHash)
        .digest('hex');
      expect(storedHashes).toContain(expectedHash);
      expect(storedHashes).not.toContain(result.recoveryCodes[0]);
    });

    it('rejects an incorrect verification code', async () => {
      const secret = generateTotpSecret();
      prisma.user.findUnique.mockResolvedValue(
        makeUser({ twoFactorSecret: secret }),
      );

      await expect(
        service.enableTwoFactor('user-1', { code: '000000' }),
      ).rejects.toThrow(UnauthorizedException);
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('rejects enabling when 2FA is already enabled', async () => {
      const secret = generateTotpSecret();
      prisma.user.findUnique.mockResolvedValue(
        makeUser({ twoFactorEnabled: true, twoFactorSecret: secret }),
      );

      await expect(
        service.enableTwoFactor('user-1', { code: '123456' }),
      ).rejects.toThrow(ConflictException);
    });

    it('rejects enabling without a prior setup', async () => {
      prisma.user.findUnique.mockResolvedValue(makeUser());

      await expect(
        service.enableTwoFactor('user-1', { code: '123456' }),
      ).rejects.toThrow('Please request a 2FA setup first');
    });
  });

  describe('disableTwoFactor', () => {
    it('disables 2FA when code and password match, and revokes sessions', async () => {
      const secret = generateTotpSecret();
      prisma.user.findUnique.mockResolvedValue(
        makeUser({ twoFactorEnabled: true, twoFactorSecret: secret }),
      );
      prisma.user.update.mockResolvedValue(makeUser());
      await fakeRedis.set(
        '2fa-recovery:user-1',
        JSON.stringify(['hash1', 'hash2']),
      );

      const code = generateTotpCode(secret);
      const result = await service.disableTwoFactor('user-1', {
        code,
        password: validDto.password,
      });

      expect(result.message).toBe(
        'Two-factor authentication disabled successfully',
      );
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { twoFactorEnabled: false, twoFactorSecret: null },
      });
      expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
        where: { userId: 'user-1', revokedAt: null },
        data: { revokedAt: expect.any(Date) },
      });
      expect(await fakeRedis.get('2fa-recovery:user-1')).toBeNull();
    });

    it('rejects a wrong password even with a valid code', async () => {
      const secret = generateTotpSecret();
      prisma.user.findUnique.mockResolvedValue(
        makeUser({ twoFactorEnabled: true, twoFactorSecret: secret }),
      );

      const code = generateTotpCode(secret);
      await expect(
        service.disableTwoFactor('user-1', {
          code,
          password: 'WrongPass123',
        }),
      ).rejects.toThrow(UnauthorizedException);
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('rejects an incorrect verification code', async () => {
      const secret = generateTotpSecret();
      prisma.user.findUnique.mockResolvedValue(
        makeUser({ twoFactorEnabled: true, twoFactorSecret: secret }),
      );

      await expect(
        service.disableTwoFactor('user-1', {
          code: '000000',
          password: validDto.password,
        }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('rejects disabling when 2FA is not enabled', async () => {
      prisma.user.findUnique.mockResolvedValue(makeUser());

      await expect(
        service.disableTwoFactor('user-1', {
          code: '123456',
          password: validDto.password,
        }),
      ).rejects.toThrow('Two-factor authentication is not enabled');
    });
  });

  describe('verifyRecoveryCode', () => {
    const getLoginToken = () =>
      service['jwtService'].signAsync(
        {
          sub: 'user-1',
          email: validDto.email,
          type: 'two-factor-login',
          jti: 'recovery-login-1',
        },
        { expiresIn: '5m' },
      );

    it('issues tokens when a valid unused recovery code is presented', async () => {
      const secret = generateTotpSecret();
      prisma.user.findUnique.mockResolvedValue(
        makeUser({ twoFactorEnabled: true, twoFactorSecret: secret }),
      );

      const plainCode = 'a1b2c-d3e4f';
      const hash = createHash('sha256')
        .update(plainCode.replace('-', '').toUpperCase())
        .digest('hex');
      await fakeRedis.set(
        '2fa-recovery:user-1',
        JSON.stringify([hash, 'other-hash']),
      );

      const loginToken = await getLoginToken();
      const result: any = await service.verifyRecoveryCode({
        loginToken,
        recoveryCode: plainCode,
      });

      expect(result.accessToken).toBeDefined();
      expect(result.refreshToken).toBeDefined();
      const stored = JSON.parse(await fakeRedis.get('2fa-recovery:user-1'));
      expect(stored).not.toContain(hash);
      expect(stored).toContain('other-hash');
    });

    it('rejects an unknown or already-used recovery code', async () => {
      const secret = generateTotpSecret();
      prisma.user.findUnique.mockResolvedValue(
        makeUser({ twoFactorEnabled: true, twoFactorSecret: secret }),
      );
      await fakeRedis.set('2fa-recovery:user-1', JSON.stringify(['some-hash']));

      const loginToken = await getLoginToken();
      await expect(
        service.verifyRecoveryCode({
          loginToken,
          recoveryCode: 'zzzzz-zzzzz',
        }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('rejects when 2FA is not enabled', async () => {
      prisma.user.findUnique.mockResolvedValue(makeUser());
      const loginToken = await getLoginToken();

      await expect(
        service.verifyRecoveryCode({
          loginToken,
          recoveryCode: 'a1b2c-d3e4f',
        }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('rejects an invalid login token', async () => {
      await expect(
        service.verifyRecoveryCode({
          loginToken: 'not-a-jwt',
          recoveryCode: 'a1b2c-d3e4f',
        }),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('forgotPassword', () => {
    it('sends a reset link to the registered email', async () => {
      prisma.user.findUnique.mockResolvedValue(makeUser());

      const result = await service.forgotPassword({ email: validDto.email });

      expect(result.message).toBe(
        'تم إرسال رابط إعادة تعيين كلمة المرور إلى بريدك الإلكتروني',
      );
      expect(mailService.sendPasswordResetEmail).toHaveBeenCalledWith(
        validDto.email,
        expect.stringContaining('token='),
      );

      const resetLink: string =
        mailService.sendPasswordResetEmail.mock.calls[0][1];
      expect(
        resetLink.startsWith(
          'http://localhost:8087/api/v1/auth/reset-password',
        ),
      ).toBe(true);

      const token = new URL(resetLink).searchParams.get('token') as string;
      const decoded: any = service['jwtService'].decode(token);
      expect(decoded.sub).toBe('user-1');
      expect(decoded.type).toBe('password-reset');
      expect(decoded.jti).toBeDefined();
      expect(decoded.prn).toBeDefined();
    });

    it('stores the reset nonce so only the latest link stays valid', async () => {
      prisma.user.findUnique.mockResolvedValue(makeUser());

      await service.forgotPassword({ email: validDto.email });

      const storedNonce = await fakeRedis.get('password-reset:user-1');
      expect(storedNonce).toBeDefined();
    });

    it('does not reveal whether an email is registered', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      const result = await service.forgotPassword({
        email: 'nobody@example.com',
      });

      expect(result.message).toBe(
        'تم إرسال رابط إعادة تعيين كلمة المرور إلى بريدك الإلكتروني',
      );
      expect(mailService.sendPasswordResetEmail).not.toHaveBeenCalled();
    });
  });

  describe('resetPassword', () => {
    const newPassword = 'NewStrongPass456';

    const getValidToken = () =>
      service['jwtService'].signAsync(
        {
          sub: 'user-1',
          email: validDto.email,
          type: 'password-reset',
          jti: 'reset-1',
          prn: 'current-nonce',
        },
        { expiresIn: '15m' },
      );

    const seedValidNonce = () =>
      fakeRedis.set('password-reset:user-1', 'current-nonce');

    it('updates the password with a new hash and revokes the token', async () => {
      const token = await getValidToken();
      await seedValidNonce();
      prisma.user.findUnique.mockResolvedValue(makeUser());
      prisma.user.update.mockResolvedValue(makeUser());

      const result = await service.resetPassword({ token, newPassword });

      expect(result.message).toBe('تم إعادة تعيين كلمة المرور بنجاح');

      const updateData = prisma.user.update.mock.calls[0][0].data;
      expect(updateData.passwordHash).not.toBe(newPassword);
      expect(await bcrypt.compare(newPassword, updateData.passwordHash)).toBe(
        true,
      );
      expect(
        await bcrypt.compare(validDto.password, updateData.passwordHash),
      ).toBe(false);

      expect(tokenRevocation.revoke).toHaveBeenCalledWith(
        token,
        expect.any(Number),
      );
    });

    it('invalidates all existing sessions after a password reset', async () => {
      const token = await getValidToken();
      await seedValidNonce();
      prisma.user.findUnique.mockResolvedValue(makeUser());
      prisma.user.update.mockResolvedValue(makeUser());

      await service.resetPassword({ token, newPassword });

      expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
        where: { userId: 'user-1', revokedAt: null },
        data: { revokedAt: expect.any(Date) },
      });
      expect(await fakeRedis.get('password-reset:user-1')).toBeNull();
    });

    it('rejects resetting to the current password', async () => {
      const token = await getValidToken();
      await seedValidNonce();
      prisma.user.findUnique.mockResolvedValue(
        makeUser({
          passwordHash: await bcrypt.hash(newPassword, 10),
        }),
      );

      await expect(
        service.resetPassword({ token, newPassword }),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('rejects a reset link that is not the latest one issued', async () => {
      const token = await getValidToken();
      prisma.user.findUnique.mockResolvedValue(makeUser());
      // Store a different nonce than the one embedded in the token
      await fakeRedis.set('password-reset:user-1', 'stale-nonce');

      await expect(
        service.resetPassword({ token, newPassword }),
      ).rejects.toThrow(
        'هذا رابط إعادة التعيين لم يعد ساريًا. يرجى طلب رابط جديد.',
      );
    });

    it('rejects an expired reset link', async () => {
      const token = await service['jwtService'].signAsync(
        {
          sub: 'user-1',
          email: validDto.email,
          type: 'password-reset',
          jti: 'reset-1',
        },
        { expiresIn: 0 },
      );

      await expect(
        service.resetPassword({ token, newPassword }),
      ).rejects.toThrow('انتهت صلاحية رابط إعادة التعيين. يرجى طلب رابط جديد.');
    });

    it('rejects a token that is not a reset token', async () => {
      const token = await service['jwtService'].signAsync(
        { sub: 'user-1', email: validDto.email, type: 'access', jti: 'x' },
        { expiresIn: '15m' },
      );

      await expect(
        service.resetPassword({ token, newPassword }),
      ).rejects.toThrow('رابط إعادة الضبط غير صالح. يرجى طلب رابط جديد.');
    });

    it('rejects a reset link that was already used', async () => {
      const token = await getValidToken();
      tokenRevocation.isRevoked.mockResolvedValue(true);

      await expect(
        service.resetPassword({ token, newPassword }),
      ).rejects.toThrow(
        'هذا رابط إعادة التعيين تم استخدامه بالفعل. يرجى طلب رابط جديد.',
      );
    });
  });

  describe('verifyEmail', () => {
    const seedValidCode = (code = '123456') =>
      fakeRedis.set('email-verification:user-1', code);

    it('marks the email as verified when the code matches', async () => {
      await seedValidCode();
      prisma.user.findUnique.mockResolvedValue(makeUser());
      prisma.user.update.mockResolvedValue(makeUser({ emailVerified: true }));

      const result = await service.verifyEmail(validDto.email, '123456');

      expect(result.message).toBe('تم التحقق من بريدك الإلكتروني بنجاح');
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { emailVerified: true },
      });
      expect(await fakeRedis.get('email-verification:user-1')).toBeNull();
      expect(
        await fakeRedis.get('email-verification:attempts:user-1'),
      ).toBeNull();
    });

    it('reports success when the email is already verified', async () => {
      await seedValidCode();
      prisma.user.findUnique.mockResolvedValue(
        makeUser({ emailVerified: true }),
      );

      const result = await service.verifyEmail(validDto.email, '123456');

      expect(result.message).toBe('تم التحقق من بريدك الإلكتروني بالفعل');
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('rejects an unknown email', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(
        service.verifyEmail('nobody@example.com', '123456'),
      ).rejects.toThrow('رمز التحقق غير صالح. يرجى طلب رمز جديد.');
    });

    it('rejects a wrong code', async () => {
      await seedValidCode();
      prisma.user.findUnique.mockResolvedValue(makeUser());

      await expect(
        service.verifyEmail(validDto.email, '000000'),
      ).rejects.toThrow('رمز التحقق غير صحيح');
    });

    it('rejects a code that was never issued (expired)', async () => {
      prisma.user.findUnique.mockResolvedValue(makeUser());

      await expect(
        service.verifyEmail(validDto.email, '123456'),
      ).rejects.toThrow('انتهت صلاحية رمز التحقق. يرجى طلب رمز جديد.');
    });

    it('locks out after too many failed attempts', async () => {
      await seedValidCode();
      prisma.user.findUnique.mockResolvedValue(makeUser());

      for (let i = 0; i < 5; i++) {
        await expect(
          service.verifyEmail(validDto.email, '000000'),
        ).rejects.toThrow('رمز التحقق غير صحيح');
      }
      await expect(
        service.verifyEmail(validDto.email, '123456'),
      ).rejects.toThrow('لقد استنفدت محاولات التحقق. يرجى طلب رمز جديد.');
      expect(prisma.user.update).not.toHaveBeenCalled();
    });
  });

  describe('resendVerification', () => {
    it('sends a fresh verification code for an unverified account', async () => {
      prisma.user.findUnique.mockResolvedValue(makeUser());

      const result = await service.resendVerification(validDto.email);

      expect(result.message).toBe('تم إرسال رمز التحقق إلى بريدك الإلكتروني');
      expect(mailService.sendVerificationEmail).toHaveBeenCalledWith(
        validDto.email,
        expect.stringMatching(/^\d{6}$/),
      );
    });

    it('does not send a code for an already verified account', async () => {
      prisma.user.findUnique.mockResolvedValue(
        makeUser({ emailVerified: true }),
      );

      await service.resendVerification(validDto.email);

      expect(mailService.sendVerificationEmail).not.toHaveBeenCalled();
    });

    it('does not reveal whether an email is registered', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      const result = await service.resendVerification('nobody@example.com');

      expect(result.message).toBe('تم إرسال رمز التحقق إلى بريدك الإلكتروني');
      expect(mailService.sendVerificationEmail).not.toHaveBeenCalled();
    });
  });

  describe('getGoogleOAuthUrl', () => {
    it('builds a Google consent URL with the configured client id', async () => {
      const url = await service.getGoogleOAuthUrl();

      expect(url).toContain('https://accounts.google.com/o/oauth2/v2/auth?');
      expect(url).toContain('client_id=google-client-id');
      expect(url).toContain('redirect_uri=');
      expect(url).toContain('scope=');
      expect(url).toContain('state=');
    });

    it('stores the state so the callback can be validated', async () => {
      const url = await service.getGoogleOAuthUrl();
      const state = new URL(url).searchParams.get('state') as string;

      expect(await fakeRedis.get(`oauth-state:${state}`)).toBe('google');
    });

    it('throws when Google OAuth is not configured', async () => {
      configService.get.mockImplementation((key: string) =>
        key === 'FRONTEND_URL' ? 'http://localhost:3000' : undefined,
      );

      await expect(service.getGoogleOAuthUrl()).rejects.toThrow(
        'إعدادات OAuth الخاصة بـ Google غير مكتملة. يرجى الاتصال بمسؤول النظام.',
      );
    });
  });

  describe('handleGoogleOAuthCallback', () => {
    it('exchanges the code and creates an account for a new Google user', async () => {
      mockGoogleApis();
      prisma.user.findFirst.mockResolvedValue(null);
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.user.create.mockImplementation(async ({ data }) => ({
        id: 'user-2',
        ...data,
        twoFactorEnabled: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      }));

      const state = await service
        .getGoogleOAuthUrl()
        .then((url) => new URL(url).searchParams.get('state'));

      const result: any = await service.handleGoogleOAuthCallback(
        'code-1',
        state,
      );

      expect(result.accessToken).toBeDefined();
      expect(result.user.id).toBe('user-2');
      expect(result.user.emailVerified).toBe(true);
      expect(prisma.user.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            oauthProvider: 'google',
            oauthProviderId: 'google-id-1',
            email: validDto.email,
          }),
        }),
      );
    });

    it('links Google to an existing account with the same email', async () => {
      mockGoogleApis();
      prisma.user.findFirst.mockResolvedValue(null);
      prisma.user.findUnique.mockResolvedValue(makeUser());
      prisma.user.update.mockResolvedValue(
        makeUser({ oauthProvider: 'google', oauthProviderId: 'google-id-1' }),
      );

      const state = await service
        .getGoogleOAuthUrl()
        .then((url) => new URL(url).searchParams.get('state'));

      const result: any = await service.handleGoogleOAuthCallback(
        'code-1',
        state,
      );

      expect(prisma.user.create).not.toHaveBeenCalled();
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: expect.objectContaining({ oauthProvider: 'google' }),
      });
      expect(result.user.id).toBe('user-1');
    });

    it('requires a 2FA step when the account has 2FA enabled', async () => {
      mockGoogleApis();
      prisma.user.findFirst.mockResolvedValue(
        makeUser({
          twoFactorEnabled: true,
          oauthProvider: 'google',
          oauthProviderId: 'google-id-1',
        }),
      );

      const state = await service
        .getGoogleOAuthUrl()
        .then((url) => new URL(url).searchParams.get('state'));

      const result: any = await service.handleGoogleOAuthCallback(
        'code-1',
        state,
      );

      expect(result.requiresTwoFactor).toBe(true);
      expect(result.loginToken).toBeDefined();
      expect(result.accessToken).toBeUndefined();
    });

    it('rejects a callback with an unknown or used state', async () => {
      mockGoogleApis();

      await expect(
        service.handleGoogleOAuthCallback('code-1', 'forged-state'),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('rejects when Google cannot exchange the authorization code', async () => {
      (global as any).fetch = jest.fn().mockResolvedValueOnce({
        ok: false,
        json: jest.fn().mockResolvedValue({ error: 'invalid_grant' }),
      });
      prisma.user.findFirst.mockResolvedValue(null);
      await fakeRedis.set('oauth-state:valid-state', 'google');

      await expect(
        service.handleGoogleOAuthCallback('bad-code', 'valid-state'),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('rejects when Google returns no profile', async () => {
      (global as any).fetch = jest
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: jest
            .fn()
            .mockResolvedValue({ access_token: 'google-access-token' }),
        })
        .mockResolvedValueOnce({
          ok: false,
          json: jest.fn().mockResolvedValue({ error: 'invalid_token' }),
        });
      await fakeRedis.set('oauth-state:valid-state', 'google');

      await expect(
        service.handleGoogleOAuthCallback('code-1', 'valid-state'),
      ).rejects.toThrow(UnauthorizedException);
    });
  });
});
