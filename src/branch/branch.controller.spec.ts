import { Test, TestingModule } from '@nestjs/testing';
import { BranchController } from './branch.controller';
import { BranchService } from './branch.service';
import { BranchName, Role } from '@prisma/client';

const mockBranchService = {
  getAll: jest.fn(),
  getOne: jest.fn(),
  create: jest.fn(),
  selectBranch: jest.fn(),
  changeBranch: jest.fn(),
};

const mockBranch = {
  id: 'branch-1',
  name: BranchName.Scientific,
  subjects: [],
  createdAt: new Date(),
};

const mockUser = {
  id: 'user-1',
  email: 'test@example.com',
  role: Role.STUDENT,
  branchId: null,
};

describe('BranchController', () => {
  let controller: BranchController;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      controllers: [BranchController],
      providers: [{ provide: BranchService, useValue: mockBranchService }],
    }).compile();

    controller = module.get<BranchController>(BranchController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('getAll', () => {
    it('should return all branches', async () => {
      mockBranchService.getAll.mockResolvedValue([mockBranch]);

      const result = await controller.getAll();

      expect(result).toEqual([mockBranch]);
      expect(mockBranchService.getAll).toHaveBeenCalled();
    });
  });

  describe('getOne', () => {
    it('should return a branch by id', async () => {
      mockBranchService.getOne.mockResolvedValue(mockBranch);

      const result = await controller.getOne('branch-1');

      expect(result).toEqual(mockBranch);
      expect(mockBranchService.getOne).toHaveBeenCalledWith('branch-1');
    });
  });

  describe('create', () => {
    it('should create a branch', async () => {
      mockBranchService.create.mockResolvedValue(mockBranch);

      const result = await controller.create({
        name: BranchName.Scientific,
        subjects: ['Mathematics'],
      });

      expect(result).toEqual(mockBranch);
      expect(mockBranchService.create).toHaveBeenCalledWith(
        BranchName.Scientific,
        ['Mathematics'],
      );
    });
  });

  describe('selectBranch', () => {
    it('should select a branch', async () => {
      mockBranchService.selectBranch.mockResolvedValue({
        id: 'user-1',
        branchId: 'branch-1',
      });

      const result = await controller.selectBranch(mockUser as any, {
        branchId: 'branch-1',
      });

      expect(result).toHaveProperty('branchId', 'branch-1');
      expect(mockBranchService.selectBranch).toHaveBeenCalledWith(
        'user-1',
        'branch-1',
      );
    });
  });

  describe('changeBranch', () => {
    it('should change branch', async () => {
      mockBranchService.changeBranch.mockResolvedValue({
        id: 'user-1',
        branchId: 'branch-2',
      });

      const result = await controller.changeBranch(mockUser as any, {
        branchId: 'branch-2',
      });

      expect(result).toHaveProperty('branchId', 'branch-2');
      expect(mockBranchService.changeBranch).toHaveBeenCalledWith(
        'user-1',
        'branch-2',
      );
    });
  });
});
