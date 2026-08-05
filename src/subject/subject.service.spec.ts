import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { SubjectService } from './subject.service';
import { PrismaService } from '../prisma/prisma.service';

const mockPrismaService = {
  branch: {
    findUnique: jest.fn(),
  },
  subject: {
    findMany: jest.fn(),
  },
  user: {
    findUnique: jest.fn(),
  },
};

const mockBranch = {
  id: 'branch-1',
  name: 'Scientific',
};

const mockSubjects = [
  { id: 'sub-1', name: 'Mathematics', branchId: 'branch-1' },
  { id: 'sub-2', name: 'Physics', branchId: 'branch-1' },
];

describe('SubjectService', () => {
  let service: SubjectService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SubjectService,
        { provide: PrismaService, useValue: mockPrismaService },
      ],
    }).compile();

    service = module.get<SubjectService>(SubjectService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getByBranch', () => {
    it('should return subjects for a branch', async () => {
      mockPrismaService.branch.findUnique.mockResolvedValue(mockBranch);
      mockPrismaService.subject.findMany.mockResolvedValue(mockSubjects);

      const result = await service.getByBranch('branch-1');

      expect(result).toEqual(mockSubjects);
    });

    it('should throw NotFoundException if branch not found', async () => {
      mockPrismaService.branch.findUnique.mockResolvedValue(null);

      await expect(service.getByBranch('nonexistent')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should call subject.findMany with correct params', async () => {
      mockPrismaService.branch.findUnique.mockResolvedValue(mockBranch);
      mockPrismaService.subject.findMany.mockResolvedValue([]);

      await service.getByBranch('branch-1');

      expect(mockPrismaService.subject.findMany).toHaveBeenCalledWith({
        where: { branchId: 'branch-1' },
        orderBy: { name: 'asc' },
      });
    });
  });

  describe('getByUserBranch', () => {
    it('should return subjects for user branch', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue({
        id: 'user-1',
        branchId: 'branch-1',
      });
      mockPrismaService.branch.findUnique.mockResolvedValue(mockBranch);
      mockPrismaService.subject.findMany.mockResolvedValue(mockSubjects);

      const result = await service.getByUserBranch('user-1');

      expect(result).toEqual(mockSubjects);
    });

    it('should throw NotFoundException if user not found', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue(null);

      await expect(service.getByUserBranch('nonexistent')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw NotFoundException if user has no branch', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue({
        id: 'user-1',
        branchId: null,
      });

      await expect(service.getByUserBranch('user-1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
