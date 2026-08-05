import { Test, TestingModule } from '@nestjs/testing';
import {
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { BranchService } from './branch.service';
import { PrismaService } from '../prisma/prisma.service';
import { BranchName, Prisma } from '@prisma/client';

const mockPrismaService = {
  branch: {
    findUnique: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
  },
  user: {
    findUnique: jest.fn(),
    update: jest.fn(),
  },
};

const mockBranch = {
  id: 'branch-1',
  name: BranchName.Scientific,
  createdAt: new Date(),
  subjects: [],
};

describe('BranchService', () => {
  let service: BranchService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BranchService,
        { provide: PrismaService, useValue: mockPrismaService },
      ],
    }).compile();

    service = module.get<BranchService>(BranchService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('create', () => {
    it('should create a new branch', async () => {
      mockPrismaService.branch.findUnique.mockResolvedValue(null);
      mockPrismaService.branch.create.mockResolvedValue({
        ...mockBranch,
        subjects: [{ id: 'sub-1', name: 'Mathematics' }],
      });

      const result = await service.create(BranchName.Scientific, [
        'Mathematics',
      ]);

      expect(result).toHaveProperty('id');
      expect(mockPrismaService.branch.create).toHaveBeenCalled();
    });

    it('should throw ConflictException if branch already exists', async () => {
      mockPrismaService.branch.findUnique.mockResolvedValue(mockBranch);

      await expect(
        service.create(BranchName.Scientific, ['Mathematics']),
      ).rejects.toThrow(ConflictException);
    });

    it('should create branch with nested subjects', async () => {
      mockPrismaService.branch.findUnique.mockResolvedValue(null);
      mockPrismaService.branch.create.mockResolvedValue(mockBranch);

      await service.create(BranchName.Scientific, ['Math', 'Physics']);

      expect(mockPrismaService.branch.create).toHaveBeenCalledWith({
        data: {
          name: BranchName.Scientific,
          subjects: {
            create: [{ name: 'Math' }, { name: 'Physics' }],
          },
        },
        include: { subjects: { orderBy: { name: 'asc' } } },
      });
    });
  });

  describe('getAll', () => {
    it('should return all branches', async () => {
      mockPrismaService.branch.findMany.mockResolvedValue([mockBranch]);

      const result = await service.getAll();

      expect(result).toEqual([mockBranch]);
    });

    it('should call findMany with correct params', async () => {
      mockPrismaService.branch.findMany.mockResolvedValue([]);

      await service.getAll();

      expect(mockPrismaService.branch.findMany).toHaveBeenCalledWith({
        include: { _count: { select: { subjects: true } } },
      });
    });
  });

  describe('getOne', () => {
    it('should return a branch by id', async () => {
      mockPrismaService.branch.findUnique.mockResolvedValue(mockBranch);

      const result = await service.getOne('branch-1');

      expect(result).toEqual(mockBranch);
    });

    it('should throw NotFoundException if branch not found', async () => {
      mockPrismaService.branch.findUnique.mockResolvedValue(null);

      await expect(service.getOne('nonexistent')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('selectBranch', () => {
    it('should select a branch for user', async () => {
      mockPrismaService.branch.findUnique.mockResolvedValue(mockBranch);
      mockPrismaService.user.update.mockResolvedValue({
        id: 'user-1',
        branchId: 'branch-1',
        branch: mockBranch,
      });

      const result = await service.selectBranch('user-1', 'branch-1');

      expect(result).toHaveProperty('branchId', 'branch-1');
    });

    it('should throw NotFoundException if branch not found', async () => {
      mockPrismaService.branch.findUnique.mockResolvedValue(null);

      await expect(
        service.selectBranch('user-1', 'nonexistent'),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException if branch already selected', async () => {
      mockPrismaService.branch.findUnique.mockResolvedValue(mockBranch);
      mockPrismaService.user.update.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Record not found', {
          code: 'P2025',
          clientVersion: '1.0.0',
        }),
      );
      mockPrismaService.user.findUnique.mockResolvedValue({
        id: 'user-1',
        branchId: 'branch-1',
      });

      await expect(service.selectBranch('user-1', 'branch-1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw NotFoundException if user not found on error', async () => {
      mockPrismaService.branch.findUnique.mockResolvedValue(mockBranch);
      mockPrismaService.user.update.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Record not found', {
          code: 'P2025',
          clientVersion: '1.0.0',
        }),
      );
      mockPrismaService.user.findUnique.mockResolvedValue(null);

      await expect(
        service.selectBranch('nonexistent', 'branch-1'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('changeBranch', () => {
    it('should change user branch', async () => {
      mockPrismaService.branch.findUnique.mockResolvedValue(mockBranch);
      mockPrismaService.user.update.mockResolvedValue({
        id: 'user-1',
        branchId: 'branch-2',
        branch: mockBranch,
      });

      const result = await service.changeBranch('user-1', 'branch-2');

      expect(result).toHaveProperty('branchId', 'branch-2');
    });

    it('should throw NotFoundException if new branch not found', async () => {
      mockPrismaService.branch.findUnique.mockResolvedValue(null);

      await expect(
        service.changeBranch('user-1', 'nonexistent'),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException if no branch currently selected', async () => {
      mockPrismaService.branch.findUnique.mockResolvedValue(mockBranch);
      mockPrismaService.user.update.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Record not found', {
          code: 'P2025',
          clientVersion: '1.0.0',
        }),
      );
      mockPrismaService.user.findUnique.mockResolvedValue({
        id: 'user-1',
        branchId: null,
      });

      await expect(service.changeBranch('user-1', 'branch-2')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw BadRequestException if already on same branch', async () => {
      mockPrismaService.branch.findUnique.mockResolvedValue(mockBranch);
      mockPrismaService.user.update.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Record not found', {
          code: 'P2025',
          clientVersion: '1.0.0',
        }),
      );
      mockPrismaService.user.findUnique.mockResolvedValue({
        id: 'user-1',
        branchId: 'branch-1',
      });

      await expect(service.changeBranch('user-1', 'branch-1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw NotFoundException if user not found on error', async () => {
      mockPrismaService.branch.findUnique.mockResolvedValue(mockBranch);
      mockPrismaService.user.update.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Record not found', {
          code: 'P2025',
          clientVersion: '1.0.0',
        }),
      );
      mockPrismaService.user.findUnique.mockResolvedValue(null);

      await expect(
        service.changeBranch('nonexistent', 'branch-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('should rethrow non-P2025 errors', async () => {
      mockPrismaService.branch.findUnique.mockResolvedValue(mockBranch);
      const dbError = new Prisma.PrismaClientKnownRequestError(
        'Some other error',
        { code: 'P1000', clientVersion: '1.0.0' },
      );
      mockPrismaService.user.update.mockRejectedValue(dbError);

      await expect(service.changeBranch('user-1', 'branch-2')).rejects.toThrow(
        dbError,
      );
    });
  });
});
