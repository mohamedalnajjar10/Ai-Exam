import { UnauthorizedException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtAuthGuard } from './jwt-auth.guard';
import {
  AUTH_REQUIRED_MESSAGE,
  SESSION_EXPIRED_MESSAGE,
} from '../../auth/constant/auth-messages';

const mockReflector = {
  getAllAndOverride: jest.fn(),
};

const createContext = () =>
  ({
    getHandler: () => 'handler',
    getClass: () => 'controller',
  }) as unknown as ExecutionContext;

describe('JwtAuthGuard', () => {
  let guard: JwtAuthGuard;

  beforeEach(() => {
    jest.clearAllMocks();
    guard = new JwtAuthGuard(mockReflector as unknown as Reflector);
  });

  describe('canActivate', () => {
    it('should allow public routes without authentication', () => {
      mockReflector.getAllAndOverride.mockReturnValue(true);

      expect(guard.canActivate(createContext())).toBe(true);
      expect(mockReflector.getAllAndOverride).toHaveBeenCalledWith('isPublic', [
        'handler',
        'controller',
      ]);
    });
  });

  describe('handleRequest', () => {
    it('should return the user when authentication succeeds', () => {
      const user = { id: 'user-1' };

      expect(guard.handleRequest(null, user, null)).toBe(user);
    });

    it('should rethrow the original error', () => {
      const err = new Error('upstream failure');

      expect(() => guard.handleRequest(err, null, null)).toThrow(
        'upstream failure',
      );
    });

    it('should throw a session-expired message when the token is expired', () => {
      const info = { name: 'TokenExpiredError' };

      expect(() => guard.handleRequest(null, null, info)).toThrow(
        UnauthorizedException,
      );
      expect(() => guard.handleRequest(null, null, info)).toThrow(
        SESSION_EXPIRED_MESSAGE,
      );
    });

    it('should throw an authentication-required message when no user is present', () => {
      expect(() => guard.handleRequest(null, null, null)).toThrow(
        UnauthorizedException,
      );
      expect(() => guard.handleRequest(null, null, null)).toThrow(
        AUTH_REQUIRED_MESSAGE,
      );
    });

    it('should treat non-expiry token errors as missing authentication', () => {
      const info = { name: 'JsonWebTokenError' };

      expect(() => guard.handleRequest(null, null, info)).toThrow(
        AUTH_REQUIRED_MESSAGE,
      );
    });
  });
});
