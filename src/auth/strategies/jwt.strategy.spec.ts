import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { User } from '@prisma/client';
import { Role } from '@prisma/client';
import { JwtStrategy } from './jwt.strategy';
import { PrismaService } from '../../prisma/prisma.service';
import { TokenRevocationService } from '../token-revocation.service';

const mockPrismaService = {
  user: {
    findUnique: jest.fn(),
  },
};

const mockConfigService = {
  get: jest.fn(),
};

const mockTokenRevocation = {
  revoke: jest.fn(),
  isRevoked: jest.fn().mockResolvedValue(false),
};

const mockUser: User = {
  id: 'user-1',
  email: 'john@example.com',
  name: 'John Doe',
  passwordHash: 'hashed-password',
  role: Role.STUDENT,
  googleId: null,
  avatar: null,
  branchId: null,
  twoFactorEnabled: false,
  twoFactorSecret: null,
  emailVerified: true,
  oauthProvider: null,
  oauthProviderId: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const payload = (overrides: Record<string, unknown> = {}) => ({
  sub: 'user-1',
  email: 'john@example.com',
  jti: 'jti-1',
  type: 'access',
  ...overrides,
});

const requestWithToken = (token = 'some-access-token') =>
  ({ headers: { authorization: `Bearer ${token}` } }) as unknown as Request;

describe('JwtStrategy', () => {
  let strategy: JwtStrategy;

  beforeEach(() => {
    jest.clearAllMocks();
    mockConfigService.get.mockReturnValue('test-secret');
    mockTokenRevocation.isRevoked.mockResolvedValue(false);
    strategy = new JwtStrategy(
      mockConfigService as unknown as ConfigService,
      mockPrismaService as unknown as PrismaService,
      mockTokenRevocation as unknown as TokenRevocationService,
    );
  });

  it('should be defined', () => {
    expect(strategy).toBeDefined();
  });

  it('should return the user for a valid access token', async () => {
    mockPrismaService.user.findUnique.mockResolvedValue(mockUser);

    await expect(
      strategy.validate(requestWithToken(), payload()),
    ).resolves.toBe(mockUser);
    expect(mockTokenRevocation.isRevoked).toHaveBeenCalledWith(
      'some-access-token',
    );
  });

  it('should skip the revocation check when no token is present', async () => {
    mockPrismaService.user.findUnique.mockResolvedValue(mockUser);

    await expect(
      strategy.validate({ headers: {} } as unknown as Request, payload()),
    ).resolves.toBe(mockUser);
    expect(mockTokenRevocation.isRevoked).not.toHaveBeenCalled();
  });

  it('should reject a revoked (logged-out) token', async () => {
    mockTokenRevocation.isRevoked.mockResolvedValue(true);

    await expect(
      strategy.validate(requestWithToken(), payload()),
    ).rejects.toThrow(UnauthorizedException);
    await expect(
      strategy.validate(requestWithToken(), payload()),
    ).rejects.toThrow('Session has been terminated. Please log in again.');
  });

  it('should reject non-access token types (e.g. two-factor login)', async () => {
    mockPrismaService.user.findUnique.mockResolvedValue(mockUser);

    await expect(
      strategy.validate(
        requestWithToken(),
        payload({ type: 'two-factor-login' }),
      ),
    ).rejects.toThrow(UnauthorizedException);
    expect(mockPrismaService.user.findUnique).not.toHaveBeenCalled();
  });

  it('should reject a payload whose user no longer exists', async () => {
    mockPrismaService.user.findUnique.mockResolvedValue(null);

    await expect(
      strategy.validate(requestWithToken(), payload()),
    ).rejects.toThrow(UnauthorizedException);
  });
});
