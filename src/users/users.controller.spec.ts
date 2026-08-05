import { Test, TestingModule } from '@nestjs/testing';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { Role } from '@prisma/client';

const mockUsersService = {
  getProfile: jest.fn(),
};

const mockUser = {
  id: 'user-1',
  email: 'test@example.com',
  name: 'Test User',
  role: Role.STUDENT,
};

describe('UsersController', () => {
  let controller: UsersController;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      controllers: [UsersController],
      providers: [{ provide: UsersService, useValue: mockUsersService }],
    }).compile();

    controller = module.get<UsersController>(UsersController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('getProfile', () => {
    it('should return user profile', async () => {
      const profile = {
        id: 'user-1',
        email: 'test@example.com',
        name: 'Test User',
        role: Role.STUDENT,
      };
      mockUsersService.getProfile.mockResolvedValue(profile);

      const result = await controller.getProfile(mockUser as any);

      expect(result).toEqual(profile);
      expect(mockUsersService.getProfile).toHaveBeenCalledWith('user-1');
    });

    it('should call service with correct userId', async () => {
      mockUsersService.getProfile.mockResolvedValue(mockUser);

      await controller.getProfile({ id: 'user-1' } as any);

      expect(mockUsersService.getProfile).toHaveBeenCalledTimes(1);
      expect(mockUsersService.getProfile).toHaveBeenCalledWith('user-1');
    });
  });
});
