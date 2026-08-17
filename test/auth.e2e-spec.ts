import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomBytes } from 'crypto';
import request from 'supertest';
import * as bcrypt from 'bcryptjs';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { PrismaService } from './../src/prisma/prisma.service';
import { RedisService } from './../src/redis/redis.service';
import { AllExceptionsFilter } from './../src/common';
import { ThrottleGuard } from './../src/common/guards/throttle.guard';
import {
  generateTotpCode,
  generateTotpSecret,
} from './../src/auth/utils/totp.util';

const uniqueEmail = () => `e2e-${Date.now()}@example.com`;

interface ErrorBody {
  message: string | string[];
}

const toMessages = (body: ErrorBody): string[] =>
  Array.isArray(body.message) ? body.message : [body.message];

interface LoginSuccessBody {
  accessToken: string;
  refreshToken: string;
  user: {
    email: string;
    passwordHash?: string;
  };
}

interface TwoFactorRequiredBody {
  requiresTwoFactor: boolean;
  loginToken: string;
  message: string;
}

const registerUser = async (
  prisma: PrismaService,
  email: string,
  overrides: {
    twoFactorEnabled?: boolean;
    twoFactorSecret?: string | null;
    emailVerified?: boolean;
  } = {},
) =>
  prisma.user.create({
    data: {
      name: 'E2E User',
      email,
      passwordHash: await bcrypt.hash('StrongPass1', 10),
      emailVerified: overrides.emailVerified ?? true,
      twoFactorEnabled: overrides.twoFactorEnabled ?? false,
      twoFactorSecret: overrides.twoFactorSecret ?? null,
    },
  });

describe('Auth registration (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let jwtService: JwtService;
  let configService: ConfigService;
  let redisService: RedisService;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();

    prisma = moduleFixture.get<PrismaService>(PrismaService);
    jwtService = moduleFixture.get<JwtService>(JwtService);
    configService = moduleFixture.get<ConfigService>(ConfigService);
    redisService = moduleFixture.get<RedisService>(RedisService);
  });

  beforeEach(async () => {
    const client = redisService.getClient() as any;
    if (client && typeof client.keys === 'function') {
      const keys = await client.keys('auth-throttle:*');
      if (keys.length > 0 && typeof client.del === 'function') {
        await client.del(...keys);
      }
    } else if (client) {
      if (client.strings instanceof Map) {
        for (const key of client.strings.keys()) {
          if (key.startsWith('auth-throttle:')) {
            client.strings.delete(key);
          }
        }
      }
      if (client.counters instanceof Map) {
        for (const key of client.counters.keys()) {
          if (key.startsWith('auth-throttle:')) {
            client.counters.delete(key);
          }
        }
      }
    }
  });

  afterAll(async () => {
    await app.close();
  });

  describe('Scenario 1: happy path - account creation successful', () => {
    it('POST /api/v1/auth/register creates an account and confirms success', async () => {
      const email = uniqueEmail();
      const response = await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({ name: 'John Doe', email, password: 'StrongPass1' })
        .expect(201);

      const body = response.body as { message: string };
      expect(body.message).toMatch(/account created successfully/i);

      const stored = await prisma.user.findUnique({ where: { email } });
      expect(stored).not.toBeNull();
      expect(stored?.passwordHash).not.toBe('StrongPass1');
    });
  });

  describe('Scenario 2: email already in use', () => {
    it('POST /api/v1/auth/register returns 409 and prompts for a different email', async () => {
      const email = uniqueEmail();
      await prisma.user.create({
        data: { name: 'Existing', email, passwordHash: 'hashed' },
      });

      const response = await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({ name: 'New User', email, password: 'StrongPass1' })
        .expect(409);

      const body = response.body as ErrorBody;
      expect(body.message).toMatch(/already registered/i);
    });
  });

  describe('Scenario 3: invalid data', () => {
    it('POST /api/v1/auth/register rejects incomplete data with field messages', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({ name: '', email: 'not-an-email', password: '123' })
        .expect(400);

      const messages = toMessages(response.body as ErrorBody);
      expect(messages.some((m) => m.toLowerCase().includes('name'))).toBe(true);
      expect(messages.some((m) => m.toLowerCase().includes('email'))).toBe(
        true,
      );
      expect(messages.some((m) => m.toLowerCase().includes('password'))).toBe(
        true,
      );
    });

    it('POST /api/v1/auth/register rejects a weak password', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({ name: 'John Doe', email: uniqueEmail(), password: 'weak' })
        .expect(400);

      const messages = toMessages(response.body as ErrorBody);
      expect(messages.some((m) => m.toLowerCase().includes('password'))).toBe(
        true,
      );
    });

    it('POST /api/v1/auth/register rejects unknown fields', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({
          name: 'John Doe',
          email: uniqueEmail(),
          password: 'StrongPass1',
          admin: true,
        })
        .expect(400);
    });
  });

  describe('Scenario 1: login - successful login', () => {
    it('POST /api/v1/auth/login returns JWT tokens and the user', async () => {
      const email = uniqueEmail();
      await registerUser(prisma, email);

      const response = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email, password: 'StrongPass1' })
        .expect(200);

      const body = response.body as LoginSuccessBody;
      expect(body.accessToken).toBeTruthy();
      expect(body.refreshToken).toBeTruthy();
      expect(body.user).toMatchObject({ email });
      expect(body.user).not.toHaveProperty('passwordHash');
      expect(body).not.toHaveProperty('requiresTwoFactor');
    });
  });

  describe('Scenario 2: login - invalid credentials', () => {
    it('POST /api/v1/auth/login returns 401 for a wrong password', async () => {
      const email = uniqueEmail();
      await registerUser(prisma, email);

      const response = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email, password: 'WrongPass1' })
        .expect(401);

      const messages = toMessages(response.body as ErrorBody);
      expect(
        messages.some((m) => /invalid/i.test(m) && /password/i.test(m)),
      ).toBe(true);
    });

    it('POST /api/v1/auth/login returns 401 for an unknown email', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: uniqueEmail(), password: 'StrongPass1' })
        .expect(401);

      const messages = toMessages(response.body as ErrorBody);
      expect(
        messages.some((m) => /invalid/i.test(m) && /password/i.test(m)),
      ).toBe(true);
    });

    it('POST /api/v1/auth/login returns 401 and never grants tokens', async () => {
      const email = uniqueEmail();
      await registerUser(prisma, email);

      const response = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email, password: 'WrongPass1' })
        .expect(401);

      expect(response.body as ErrorBody).not.toHaveProperty('accessToken');
      expect(response.body as ErrorBody).not.toHaveProperty('refreshToken');
    });
  });

  describe('Scenario 3: login - two-factor authentication', () => {
    it('POST /api/v1/auth/login requests a code when 2FA is enabled and grants no tokens', async () => {
      const email = uniqueEmail();
      const secret = generateTotpSecret();
      await registerUser(prisma, email, {
        twoFactorEnabled: true,
        twoFactorSecret: secret,
      });

      const response = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email, password: 'StrongPass1' })
        .expect(200);

      const body = response.body as TwoFactorRequiredBody;
      expect(body.requiresTwoFactor).toBe(true);
      expect(body.loginToken).toBeTruthy();
      expect(body).not.toHaveProperty('accessToken');
      expect(body).not.toHaveProperty('refreshToken');
    });

    it('POST /api/v1/auth/verify-2fa grants access with the correct code', async () => {
      const email = uniqueEmail();
      const secret = generateTotpSecret();
      await registerUser(prisma, email, {
        twoFactorEnabled: true,
        twoFactorSecret: secret,
      });

      const loginResponse = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email, password: 'StrongPass1' })
        .expect(200);
      const { loginToken } = loginResponse.body as TwoFactorRequiredBody;

      const response = await request(app.getHttpServer())
        .post('/api/v1/auth/verify-2fa')
        .send({ loginToken, code: generateTotpCode(secret) })
        .expect(200);

      const body = response.body as LoginSuccessBody;
      expect(body.accessToken).toBeTruthy();
      expect(body.refreshToken).toBeTruthy();
      expect(body.user).toMatchObject({ email });
      expect(body.user).not.toHaveProperty('passwordHash');
    });

    it('POST /api/v1/auth/verify-2fa rejects a wrong code', async () => {
      const email = uniqueEmail();
      const secret = generateTotpSecret();
      await registerUser(prisma, email, {
        twoFactorEnabled: true,
        twoFactorSecret: secret,
      });

      const loginResponse = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email, password: 'StrongPass1' })
        .expect(200);
      const { loginToken } = loginResponse.body as TwoFactorRequiredBody;

      const response = await request(app.getHttpServer())
        .post('/api/v1/auth/verify-2fa')
        .send({ loginToken, code: '000000' })
        .expect(401);

      const messages = toMessages(response.body as ErrorBody);
      expect(messages.some((m) => /verification code/i.test(m))).toBe(true);
    });

    it('POST /api/v1/auth/verify-2fa rejects a missing or invalid token', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/auth/verify-2fa')
        .send({ loginToken: 'not-a-valid-token', code: '123456' })
        .expect(401);
    });
  });

  describe('Scenario 1: logout - session ends securely', () => {
    it('POST /api/v1/auth/logout revokes the access and refresh tokens', async () => {
      const email = uniqueEmail();
      await registerUser(prisma, email);
      const loginResponse = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email, password: 'StrongPass1' })
        .expect(200);
      const { accessToken, refreshToken } =
        loginResponse.body as LoginSuccessBody;

      const logoutResponse = await request(app.getHttpServer())
        .post('/api/v1/auth/logout')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ refreshToken })
        .expect(200);
      expect(logoutResponse.body).toEqual({
        message: 'Logged out successfully',
      });

      const storedToken = await prisma.refreshToken.findUnique({
        where: {
          tokenHash: createHash('sha256').update(refreshToken).digest('hex'),
        },
      });
      expect(storedToken).not.toBeNull();
      expect(storedToken?.revokedAt).not.toBeNull();
    });

    it('protected pages cannot be accessed with a revoked access token', async () => {
      const email = uniqueEmail();
      await registerUser(prisma, email);
      const loginResponse = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email, password: 'StrongPass1' })
        .expect(200);
      const { accessToken } = loginResponse.body as LoginSuccessBody;

      await request(app.getHttpServer())
        .post('/api/v1/auth/logout')
        .set('Authorization', `Bearer ${accessToken}`)
        .send()
        .expect(200);

      const response = await request(app.getHttpServer())
        .get('/api/v1/users/profile')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(401);

      const messages = toMessages(response.body as ErrorBody);
      expect(
        messages.some((m) => /session/i.test(m) && /log in again/i.test(m)),
      ).toBe(true);
    });

    it('POST /api/v1/auth/logout without a token returns 401', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/auth/logout')
        .send()
        .expect(401);
    });
  });

  describe('Scenario 2/3: session expiration', () => {
    it('protected pages reject an expired token with a log-in-again message', async () => {
      const email = uniqueEmail();
      const user = await registerUser(prisma, email);
      const accessSecret =
        configService.get<string>('JWT_SECRET') ?? 'ai-exam-dev-secret';
      const expiredToken = await jwtService.signAsync(
        { sub: user.id, email },
        { secret: accessSecret, expiresIn: '-1s' },
      );

      const response = await request(app.getHttpServer())
        .get('/api/v1/users/profile')
        .set('Authorization', `Bearer ${expiredToken}`)
        .expect(401);

      const messages = toMessages(response.body as ErrorBody);
      expect(
        messages.some((m) => /session/i.test(m) && /log in again/i.test(m)),
      ).toBe(true);
    });

    it('protected pages reject a request without any token', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/users/profile')
        .expect(401);

      const messages = toMessages(response.body as ErrorBody);
      expect(messages.some((m) => /authentication required/i.test(m))).toBe(
        true,
      );
    });
  });

  describe('Scenario 1: password reset - happy path', () => {
    it('forgot-password sends a link, reset-password updates the password', async () => {
      const email = uniqueEmail();
      await registerUser(prisma, email);

      const forgotResponse = await request(app.getHttpServer())
        .post('/api/v1/auth/forgot-password')
        .send({ email })
        .expect(200);
      const forgotBody = forgotResponse.body as {
        message: string;
        resetLink: string;
      };
      expect(forgotBody.message).toMatch(/reset link sent/i);
      const token = forgotBody.resetLink.split('token=')[1];
      expect(token).toBeDefined();

      await request(app.getHttpServer())
        .post('/api/v1/auth/reset-password')
        .send({ token, newPassword: 'NewStrongPass1' })
        .expect(200);

      const loginResponse = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email, password: 'NewStrongPass1' })
        .expect(200);
      expect(loginResponse.body).toHaveProperty('accessToken');

      await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email, password: 'StrongPass1' })
        .expect(401);
    });

    it('the new password is stored encrypted (bcrypt)', async () => {
      const email = uniqueEmail();
      await registerUser(prisma, email);

      const forgotResponse = await request(app.getHttpServer())
        .post('/api/v1/auth/forgot-password')
        .send({ email })
        .expect(200);
      const token = (
        forgotResponse.body as { resetLink: string }
      ).resetLink.split('token=')[1];

      await request(app.getHttpServer())
        .post('/api/v1/auth/reset-password')
        .send({ token, newPassword: 'NewStrongPass1' })
        .expect(200);

      const stored = await prisma.user.findUnique({ where: { email } });
      expect(stored?.passwordHash).not.toBe('NewStrongPass1');
      expect(stored?.passwordHash).toMatch(/^\$2[aby]\$/);
      expect(
        await bcrypt.compare('NewStrongPass1', stored?.passwordHash ?? ''),
      ).toBe(true);
    });

    it('the reset token is single-use and sessions are ended', async () => {
      const email = uniqueEmail();
      await registerUser(prisma, email);
      const loginResponse = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email, password: 'StrongPass1' })
        .expect(200);
      const { refreshToken } = loginResponse.body as LoginSuccessBody;

      const forgotResponse = await request(app.getHttpServer())
        .post('/api/v1/auth/forgot-password')
        .send({ email })
        .expect(200);
      const token = (
        forgotResponse.body as { resetLink: string }
      ).resetLink.split('token=')[1];

      await request(app.getHttpServer())
        .post('/api/v1/auth/reset-password')
        .send({ token, newPassword: 'NewStrongPass1' })
        .expect(200);

      await request(app.getHttpServer())
        .post('/api/v1/auth/reset-password')
        .send({ token, newPassword: 'AnotherPass1' })
        .expect(401);

      const storedToken = await prisma.refreshToken.findUnique({
        where: {
          tokenHash: createHash('sha256').update(refreshToken).digest('hex'),
        },
      });
      expect(storedToken).not.toBeNull();
      expect(storedToken?.revokedAt).not.toBeNull();
    });
  });

  describe('Scenario 2: password reset - unregistered email', () => {
    it('forgot-password returns the same success message to prevent user enumeration', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/auth/forgot-password')
        .send({ email: uniqueEmail() })
        .expect(200);

      const messages = toMessages(response.body as ErrorBody);
      expect(messages.some((m) => /reset link sent/i.test(m))).toBe(true);
    });
  });

  describe('Scenario 3: password reset - expired link', () => {
    it('reset-password rejects an expired link and prompts for a new one', async () => {
      const email = uniqueEmail();
      const user = await registerUser(prisma, email);
      const accessSecret =
        configService.get<string>('JWT_ACCESS_SECRET') ?? 'dev-secret';
      const expiredToken = await jwtService.signAsync(
        {
          sub: user.id,
          email,
          type: 'password-reset',
          jti: 'expired-reset-1',
          prn: 'some-nonce',
        },
        { secret: accessSecret, expiresIn: '-1s' },
      );

      const response = await request(app.getHttpServer())
        .post('/api/v1/auth/reset-password')
        .send({ token: expiredToken, newPassword: 'NewStrongPass1' })
        .expect(401);

      const messages = toMessages(response.body as ErrorBody);
      expect(
        messages.some(
          (m) => /expired/i.test(m) && /request a new one/i.test(m),
        ),
      ).toBe(true);

      const stored = await prisma.user.findUnique({ where: { id: user.id } });
      expect(
        await bcrypt.compare('StrongPass1', stored?.passwordHash ?? ''),
      ).toBe(true);
    });

    it('reset-password rejects a token with an invalid type', async () => {
      const email = uniqueEmail();
      const user = await registerUser(prisma, email);
      const accessSecret =
        configService.get<string>('JWT_ACCESS_SECRET') ?? 'dev-secret';
      const wrongTypeToken = await jwtService.signAsync(
        {
          sub: user.id,
          email,
          type: 'access',
          jti: 'wrong-type-1',
        },
        { secret: accessSecret, expiresIn: '15m' },
      );

      await request(app.getHttpServer())
        .post('/api/v1/auth/reset-password')
        .send({ token: wrongTypeToken, newPassword: 'NewStrongPass1' })
        .expect(401);
    });

    it('reset-password rejects a weak new password', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/auth/reset-password')
        .send({ token: 'd'.repeat(64), newPassword: 'weak' })
        .expect(400);
    });
  });
});
