import { Test, TestingModule } from '@nestjs/testing';
import { SubjectController } from './subject.controller';
import { SubjectService } from './subject.service';
import { Role } from '@prisma/client';

const mockSubjectService = {
  getByBranch: jest.fn(),
  getByUserBranch: jest.fn(),
};

const mockSubjects = [
  { id: 'sub-1', name: 'Mathematics', branchId: 'branch-1' },
  { id: 'sub-2', name: 'Physics', branchId: 'branch-1' },
];

const mockUser = {
  id: 'user-1',
  email: 'test@example.com',
  role: Role.STUDENT,
  branchId: 'branch-1',
};

describe('SubjectController', () => {
  let controller: SubjectController;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      controllers: [SubjectController],
      providers: [{ provide: SubjectService, useValue: mockSubjectService }],
    }).compile();

    controller = module.get<SubjectController>(SubjectController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('getMySubjects', () => {
    it('should return subjects for user branch', async () => {
      mockSubjectService.getByUserBranch.mockResolvedValue(mockSubjects);

      const result = await controller.getMySubjects(mockUser as any);

      expect(result).toEqual(mockSubjects);
      expect(mockSubjectService.getByUserBranch).toHaveBeenCalledWith('user-1');
    });
  });

  describe('getByBranch', () => {
    it('should return subjects for a branch', async () => {
      mockSubjectService.getByBranch.mockResolvedValue(mockSubjects);

      const result = await controller.getByBranch('branch-1');

      expect(result).toEqual(mockSubjects);
      expect(mockSubjectService.getByBranch).toHaveBeenCalledWith('branch-1');
    });
  });
});
