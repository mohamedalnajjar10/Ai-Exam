import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { UsersService } from './users.service';
import { PrismaService } from '../prisma/prisma.service';
import { Role } from '@prisma/client';

const mockPrismaService = {
  user: {
    findUnique: jest.fn(),
  },
};

const mockUser = {
  id: 'user-1',
  email: 'test@example.com',
  name: 'Test User',
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
  branch: null,
};

describe('UsersService', () => {
  let service: UsersService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: PrismaService, useValue: mockPrismaService },
      ],
    }).compile();

    service = module.get<UsersService>(UsersService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getProfile', () => {
    it('should return user profile without passwordHash', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue(mockUser);

      const result = await service.getProfile('user-1');

      expect(result).not.toHaveProperty('passwordHash');
      expect(result).toHaveProperty('id', 'user-1');
      expect(result).toHaveProperty('email', 'test@example.com');
    });

    it('should throw NotFoundException if user not found', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue(null);

      await expect(service.getProfile('nonexistent')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should call prisma with correct params', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue(mockUser);

      await service.getProfile('user-1');

      expect(mockPrismaService.user.findUnique).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        include: { branch: true },
      });
    });

    it('should include branch data in the result', async () => {
      const userWithBranch = {
        ...mockUser,
        branch: { id: 'branch-1', name: 'Scientific' },
      };
      mockPrismaService.user.findUnique.mockResolvedValue(userWithBranch);

      const result = await service.getProfile('user-1');

      expect(result).toHaveProperty('branch');
    });
  });
});
