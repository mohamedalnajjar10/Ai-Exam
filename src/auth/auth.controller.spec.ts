import { HttpStatus } from '@nestjs/common';
import type { Request, Response } from 'express';
import { ConfigService } from '@nestjs/config';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

const mockAuthService = {
  register: jest.fn(),
  verifyEmail: jest.fn(),
  resendVerification: jest.fn(),
  login: jest.fn(),
  verifyTwoFactor: jest.fn(),
  verifyRecoveryCode: jest.fn(),
  refresh: jest.fn(),
  logout: jest.fn(),
  getProfile: jest.fn(),
  setupTwoFactor: jest.fn(),
  enableTwoFactor: jest.fn(),
  disableTwoFactor: jest.fn(),
  forgotPassword: jest.fn(),
  resetPassword: jest.fn(),
  getGoogleOAuthUrl: jest.fn(),
  handleGoogleOAuthCallback: jest.fn(),
};

const mockConfigService = {
  get: jest.fn((key: string) => {
    if (key === 'FRONTEND_URL') return 'http://localhost:3000';
    return undefined;
  }),
};

const requestWithToken = (token = 'access-token') =>
  ({
    headers: { authorization: `Bearer ${token}` },
  }) as unknown as Request;

const mockUser = {
  id: 'user-1',
  email: 'ahmed@example.com',
  name: 'Ahmed Ali',
  emailVerified: true,
  twoFactorEnabled: false,
  createdAt: new Date(),
};

const mockRes = () => {
  const res = {
    status: jest.fn().mockReturnThis(),
    setHeader: jest.fn().mockReturnThis(),
    send: jest.fn().mockReturnThis(),
    redirect: jest.fn().mockReturnThis(),
  };
  return res as unknown as Response;
};

describe('AuthController', () => {
  let controller: AuthController;

  beforeEach(() => {
    jest.clearAllMocks();
    controller = new AuthController(
      mockAuthService as unknown as AuthService,
      mockConfigService as unknown as ConfigService,
    );
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('register', () => {
    it('should delegate to AuthService.register', async () => {
      const dto = {
        name: 'Ahmed Ali',
        email: 'ahmed@example.com',
        password: 'StrongPass123',
      };
      const result = {
        message:
          'Account created successfully. Please verify your email before logging in.',
      };
      mockAuthService.register.mockResolvedValue(result);

      await expect(controller.register(dto)).resolves.toEqual(result);
      expect(mockAuthService.register).toHaveBeenCalledWith(dto);
    });
  });

  describe('verifyEmail', () => {
    it('renders a success page when verification succeeds', async () => {
      const res = mockRes();
      mockAuthService.verifyEmail.mockResolvedValue({
        message: 'Your email has been verified successfully',
      });

      await controller.verifyEmail('valid-token', res);

      expect(mockAuthService.verifyEmail).toHaveBeenCalledWith('valid-token');
      expect(res.status).toHaveBeenCalledWith(HttpStatus.OK);
      expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'text/html');
    });

    it('renders an error page when verification fails', async () => {
      const res = mockRes();
      mockAuthService.verifyEmail.mockRejectedValue(
        new Error(
          'This verification link has expired. Please request a new one.',
        ),
      );

      await controller.verifyEmail('expired-token', res);

      expect(res.status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
      expect(res.send).toHaveBeenCalledWith(
        expect.stringContaining('Verification failed'),
      );
    });
  });

  describe('resendVerification', () => {
    it('should delegate to AuthService.resendVerification', async () => {
      const dto = { email: 'ahmed@example.com' };
      const result = { message: 'Verification link sent to your email' };
      mockAuthService.resendVerification.mockResolvedValue(result);

      await expect(controller.resendVerification(dto)).resolves.toEqual(result);
      expect(mockAuthService.resendVerification).toHaveBeenCalledWith(
        dto.email,
      );
    });
  });

  describe('login', () => {
    it('should delegate to AuthService.login', async () => {
      const dto = {
        email: 'ahmed@example.com',
        password: 'StrongPass123',
      };
      const result = {
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
      };
      mockAuthService.login.mockResolvedValue(result);

      await expect(controller.login(dto)).resolves.toEqual(result);
      expect(mockAuthService.login).toHaveBeenCalledWith(dto);
    });
  });

  describe('verifyTwoFactor', () => {
    it('should delegate to AuthService.verifyTwoFactor', async () => {
      const dto = { loginToken: 'login-token', code: '123456' };
      const result = {
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
      };
      mockAuthService.verifyTwoFactor.mockResolvedValue(result);

      await expect(controller.verifyTwoFactor(dto)).resolves.toEqual(result);
      expect(mockAuthService.verifyTwoFactor).toHaveBeenCalledWith(dto);
    });
  });

  describe('verifyRecoveryCode', () => {
    it('should delegate to AuthService.verifyRecoveryCode', async () => {
      const dto = { loginToken: 'login-token', recoveryCode: 'a1b2c-d3e4f' };
      const result = {
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
      };
      mockAuthService.verifyRecoveryCode.mockResolvedValue(result);

      await expect(controller.verifyRecoveryCode(dto)).resolves.toEqual(result);
      expect(mockAuthService.verifyRecoveryCode).toHaveBeenCalledWith(dto);
    });
  });

  describe('refresh', () => {
    it('should delegate to AuthService.refresh', async () => {
      const dto = { refreshToken: 'refresh-token' };
      const result = {
        accessToken: 'new-access-token',
        refreshToken: 'new-refresh-token',
      };
      mockAuthService.refresh.mockResolvedValue(result);

      await expect(controller.refresh(dto)).resolves.toEqual(result);
      expect(mockAuthService.refresh).toHaveBeenCalledWith('refresh-token');
    });
  });

  describe('logout', () => {
    it('extracts the bearer token and delegates to AuthService.logout', async () => {
      const result = { message: 'Logged out successfully' };
      mockAuthService.logout.mockResolvedValue(result);

      await expect(
        controller.logout(requestWithToken('access-token')),
      ).resolves.toEqual(result);
      expect(mockAuthService.logout).toHaveBeenCalledWith('access-token');
    });

    it('passes an empty token when no authorization header is present', async () => {
      mockAuthService.logout.mockResolvedValue({
        message: 'Logged out successfully',
      });

      await controller.logout({
        headers: {},
      } as unknown as Request);

      expect(mockAuthService.logout).toHaveBeenCalledWith('');
    });
  });

  describe('profile', () => {
    it('should delegate to AuthService.getProfile with the user id', async () => {
      mockAuthService.getProfile.mockResolvedValue(mockUser);

      await expect(controller.profile(mockUser as any)).resolves.toEqual(
        mockUser,
      );
      expect(mockAuthService.getProfile).toHaveBeenCalledWith('user-1');
    });
  });

  describe('setupTwoFactor', () => {
    it('should delegate to AuthService.setupTwoFactor', async () => {
      const result = {
        secret: 'secret',
        otpauthUrl: 'otpauth://totp/AI%20Exam:ahmed@example.com?...',
      };
      mockAuthService.setupTwoFactor.mockResolvedValue(result);

      await expect(controller.setupTwoFactor(mockUser as any)).resolves.toEqual(
        result,
      );
      expect(mockAuthService.setupTwoFactor).toHaveBeenCalledWith('user-1');
    });
  });

  describe('enableTwoFactor', () => {
    it('should delegate to AuthService.enableTwoFactor', async () => {
      const dto = { code: '123456' };
      const result = {
        message: 'Two-factor authentication enabled successfully',
        recoveryCodes: ['a1b2c-d3e4f'],
      };
      mockAuthService.enableTwoFactor.mockResolvedValue(result);

      await expect(
        controller.enableTwoFactor(mockUser as any, dto),
      ).resolves.toEqual(result);
      expect(mockAuthService.enableTwoFactor).toHaveBeenCalledWith(
        'user-1',
        dto,
      );
    });
  });

  describe('disableTwoFactor', () => {
    it('should delegate to AuthService.disableTwoFactor', async () => {
      const dto = { code: '123456', password: 'StrongPass123' };
      const result = {
        message: 'Two-factor authentication disabled successfully',
      };
      mockAuthService.disableTwoFactor.mockResolvedValue(result);

      await expect(
        controller.disableTwoFactor(mockUser as any, dto),
      ).resolves.toEqual(result);
      expect(mockAuthService.disableTwoFactor).toHaveBeenCalledWith(
        'user-1',
        dto,
      );
    });
  });

  describe('forgotPassword', () => {
    it('should delegate to AuthService.forgotPassword', async () => {
      const dto = { email: 'ahmed@example.com' };
      const result = { message: 'Password reset link sent to your email' };
      mockAuthService.forgotPassword.mockResolvedValue(result);

      await expect(controller.forgotPassword(dto)).resolves.toEqual(result);
      expect(mockAuthService.forgotPassword).toHaveBeenCalledWith(dto);
    });
  });

  describe('resetPassword', () => {
    it('should delegate to AuthService.resetPassword', async () => {
      const dto = {
        token: 'reset-token',
        newPassword: 'NewStrongPass456',
      };
      const result = { message: 'Password has been reset successfully' };
      mockAuthService.resetPassword.mockResolvedValue(result);

      await expect(controller.resetPassword(dto)).resolves.toEqual(result);
      expect(mockAuthService.resetPassword).toHaveBeenCalledWith(dto);
    });
  });

  describe('getResetPasswordPage', () => {
    it('serves the reset password HTML page', () => {
      const res = mockRes();

      controller.getResetPasswordPage(res);

      expect(res.status).toHaveBeenCalledWith(HttpStatus.OK);
      expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'text/html');
      expect(res.send).toHaveBeenCalledWith(
        expect.stringContaining('Reset your password'),
      );
    });
  });

  describe('oauthGoogle', () => {
    it('redirects to the Google consent URL', async () => {
      const res = mockRes();
      mockAuthService.getGoogleOAuthUrl.mockResolvedValue(
        'https://accounts.google.com/o/oauth2/v2/auth?...',
      );

      await controller.oauthGoogle(res);

      expect(res.redirect).toHaveBeenCalledWith(
        'https://accounts.google.com/o/oauth2/v2/auth?...',
      );
    });

    it('redirects to the frontend with an error when Google OAuth fails', async () => {
      const res = mockRes();
      mockAuthService.getGoogleOAuthUrl.mockRejectedValue(
        new Error('Google OAuth is not configured'),
      );

      await controller.oauthGoogle(res);

      expect(res.redirect).toHaveBeenCalledWith(
        'http://localhost:3000/oauth/callback?error=Google+OAuth+is+not+configured',
      );
    });
  });

  describe('oauthGoogleCallback', () => {
    it('redirects to the frontend with the issued tokens', async () => {
      const res = mockRes();
      mockAuthService.handleGoogleOAuthCallback.mockResolvedValue({
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
        user: { id: 'user-1' },
      });

      await controller.oauthGoogleCallback('code-1', 'state-1', '', res);

      expect(mockAuthService.handleGoogleOAuthCallback).toHaveBeenCalledWith(
        'code-1',
        'state-1',
      );
      expect(res.redirect).toHaveBeenCalledWith(
        expect.stringContaining('/oauth/callback?access_token=access-token'),
      );
    });

    it('redirects with a login token when 2FA is required', async () => {
      const res = mockRes();
      mockAuthService.handleGoogleOAuthCallback.mockResolvedValue({
        requiresTwoFactor: true,
        loginToken: 'login-token',
      });

      await controller.oauthGoogleCallback('code-1', 'state-1', '', res);

      expect(res.redirect).toHaveBeenCalledWith(
        expect.stringContaining('requires_two_factor=true'),
      );
    });

    it('redirects to the frontend with an error when Google rejects the code', async () => {
      const res = mockRes();

      await controller.oauthGoogleCallback('', 'state-1', '', res);

      expect(res.redirect).toHaveBeenCalledWith(
        expect.stringContaining('error='),
      );
    });
  });
});
