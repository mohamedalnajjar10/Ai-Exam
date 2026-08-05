import {
  Controller,
  Post,
  Get,
  Body,
  Query,
  Res,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import type { User } from '@prisma/client';
import { AuthService } from './services/auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { VerifyTwoFactorDto } from './dto/verify-two-factor.dto';
import { EnableTwoFactorDto } from './dto/enable-two-factor.dto';
import { DisableTwoFactorDto } from './dto/disable-two-factor.dto';
import { VerifyRecoveryCodeDto } from './dto/verify-recovery-code.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { ResendVerificationDto } from './dto/resend-verification.dto';
import { ThrottleGuard } from '../common/guards/throttle.guard';
import { Throttle } from '../common/decorators/throttle.decorator';
import { CurrentUser, Public, AccessToken } from '../common';
import { resetPasswordPage, verificationResultPage } from './utils/pages';
import { getFrontendUrl } from './utils/app-urls.util';

/**
 * Controller for user account management and authentication
 */
@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  /**
   * Creates a new user account with email and password
   */
  @Public()
  @UseGuards(ThrottleGuard)
  @Throttle({ limit: 10, windowMs: 60_000 })
  @Post('register')
  @ApiOperation({ summary: 'Register a new user account' })
  @ApiResponse({ status: 201, description: 'Account created successfully' })
  @ApiResponse({ status: 400, description: 'Invalid or incomplete data' })
  @ApiResponse({ status: 409, description: 'Email is already registered' })
  @ApiResponse({ status: 429, description: 'Too many requests' })
  @HttpCode(HttpStatus.CREATED)
  register(@Body() registerDto: RegisterDto) {
    return this.authService.register(registerDto);
  }

  /**
   * Verifies the email address using the token from the emailed link.
   * Renders a result page when opened in a browser.
   */
  @Public()
  @Get('verify-email')
  @ApiOperation({
    summary: 'Verify an email address using the emailed verification link',
  })
  @ApiResponse({ status: 200, description: 'Email verified (HTML page)' })
  @ApiResponse({ status: 401, description: 'Invalid or expired link' })
  async verifyEmail(
    @Query('token') token: string,
    @Res() res: Response,
  ): Promise<void> {
    try {
      const result = await this.authService.verifyEmail(token);
      res
        .status(HttpStatus.OK)
        .setHeader('Content-Type', 'text/html')
        .send(verificationResultPage(result.message, true));
    } catch (error: any) {
      const message =
        error?.message ?? 'Verification failed. Please request a new link.';
      res
        .status(error?.status ?? HttpStatus.BAD_REQUEST)
        .setHeader('Content-Type', 'text/html')
        .send(verificationResultPage(message, false));
    }
  }

  /**
   * Sends a fresh verification link to the given email
   */
  @Public()
  @UseGuards(ThrottleGuard)
  @Throttle({ limit: 3, windowMs: 10 * 60_000 })
  @Post('resend-verification')
  @ApiOperation({ summary: 'Resend the email verification link' })
  @ApiResponse({ status: 200, description: 'Verification link sent' })
  @ApiResponse({ status: 400, description: 'Invalid input' })
  @ApiResponse({ status: 429, description: 'Too many requests' })
  @HttpCode(HttpStatus.OK)
  resendVerification(@Body() resendVerificationDto: ResendVerificationDto) {
    return this.authService.resendVerification(resendVerificationDto.email);
  }

  /**
   * Logs a user in with email and password.
   * Returns a JWT, or a temporary login token if 2FA is enabled.
   */
  @Public()
  @UseGuards(ThrottleGuard)
  @Throttle({ limit: 10, windowMs: 10 * 60_000 })
  @Post('login')
  @ApiOperation({ summary: 'Log in with email and password' })
  @ApiResponse({
    status: 200,
    description:
      'Login successful (JWT returned, or loginToken when 2FA is required)',
  })
  @ApiResponse({ status: 400, description: 'Invalid input' })
  @ApiResponse({ status: 401, description: 'Invalid email or password' })
  @ApiResponse({ status: 429, description: 'Too many requests' })
  @HttpCode(HttpStatus.OK)
  login(@Body() loginDto: LoginDto) {
    return this.authService.login(loginDto);
  }

  /**
   * Completes a login by verifying the two-factor authentication code
   */
  @Public()
  @UseGuards(ThrottleGuard)
  @Throttle({ limit: 5, windowMs: 60_000 })
  @Post('verify-2fa')
  @ApiOperation({
    summary: 'Verify two-factor authentication code to complete login',
  })
  @ApiResponse({ status: 200, description: 'Code verified, JWT returned' })
  @ApiResponse({ status: 400, description: 'Invalid input' })
  @ApiResponse({ status: 401, description: 'Invalid code or login token' })
  @ApiResponse({ status: 429, description: 'Too many requests' })
  @HttpCode(HttpStatus.OK)
  verifyTwoFactor(@Body() verifyTwoFactorDto: VerifyTwoFactorDto) {
    return this.authService.verifyTwoFactor(verifyTwoFactorDto);
  }

  /**
   * Completes a login using a one-time 2FA recovery code
   */
  @Public()
  @UseGuards(ThrottleGuard)
  @Throttle({ limit: 5, windowMs: 60_000 })
  @Post('2fa/recovery')
  @ApiOperation({
    summary: 'Complete a login using a one-time 2FA recovery code',
  })
  @ApiResponse({
    status: 200,
    description: 'Recovery code verified, JWT returned',
  })
  @ApiResponse({ status: 400, description: 'Invalid input' })
  @ApiResponse({ status: 401, description: 'Invalid code or login token' })
  @ApiResponse({ status: 429, description: 'Too many requests' })
  @HttpCode(HttpStatus.OK)
  verifyRecoveryCode(@Body() verifyRecoveryCodeDto: VerifyRecoveryCodeDto) {
    return this.authService.verifyRecoveryCode(verifyRecoveryCodeDto);
  }

  /**
   * Exchanges a valid refresh token for a new access/refresh token pair
   */
  @Public()
  @UseGuards(ThrottleGuard)
  @Throttle({ limit: 30, windowMs: 60_000 })
  @Post('refresh')
  @ApiOperation({
    summary: 'Get a new access token using a valid refresh token',
  })
  @ApiResponse({ status: 200, description: 'New token pair issued' })
  @ApiResponse({ status: 400, description: 'Invalid input' })
  @ApiResponse({ status: 401, description: 'Invalid or expired refresh token' })
  @ApiResponse({ status: 429, description: 'Too many requests' })
  @HttpCode(HttpStatus.OK)
  refresh(@Body() refreshTokenDto: RefreshTokenDto) {
    return this.authService.refresh(refreshTokenDto.refreshToken);
  }

  /**
   * Logs the user out by revoking the current access token
   */
  @Post('logout')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Log out and revoke the current session token' })
  @ApiResponse({ status: 200, description: 'Logged out successfully' })
  @ApiResponse({
    status: 401,
    description: 'Not authenticated or session expired',
  })
  @HttpCode(HttpStatus.OK)
  logout(@AccessToken() token: string) {
    return this.authService.logout(token ?? '');
  }

  /**
   * Returns the profile of the currently authenticated user
   */
  @Get('me')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get the currently authenticated user profile' })
  @ApiResponse({ status: 200, description: 'Profile returned' })
  @ApiResponse({
    status: 401,
    description: 'Not authenticated or session expired',
  })
  profile(@CurrentUser() user: User) {
    return this.authService.getProfile(user.id);
  }

  /**
   * Generates a TOTP secret and otpauth URL for setting up 2FA
   */
  @UseGuards(ThrottleGuard)
  @Throttle({ limit: 5, windowMs: 60_000 })
  @Post('2fa/setup')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Generate a TOTP secret and otpauth URL to set up 2FA',
  })
  @ApiResponse({ status: 200, description: 'Secret and otpauth URL returned' })
  @ApiResponse({
    status: 401,
    description: 'Not authenticated or session expired',
  })
  @ApiResponse({ status: 409, description: '2FA is already enabled' })
  @ApiResponse({ status: 429, description: 'Too many requests' })
  setupTwoFactor(@CurrentUser() user: User) {
    return this.authService.setupTwoFactor(user.id);
  }

  /**
   * Verifies a TOTP code and enables 2FA on the account
   */
  @UseGuards(ThrottleGuard)
  @Throttle({ limit: 5, windowMs: 60_000 })
  @Post('2fa/enable')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Verify a TOTP code and enable 2FA on the account',
  })
  @ApiResponse({
    status: 200,
    description: '2FA enabled, recovery codes returned',
  })
  @ApiResponse({ status: 400, description: 'Invalid input or no setup first' })
  @ApiResponse({
    status: 401,
    description: 'Not authenticated or invalid code',
  })
  @ApiResponse({ status: 409, description: '2FA is already enabled' })
  @ApiResponse({ status: 429, description: 'Too many requests' })
  @HttpCode(HttpStatus.OK)
  enableTwoFactor(
    @CurrentUser() user: User,
    @Body() enableTwoFactorDto: EnableTwoFactorDto,
  ) {
    return this.authService.enableTwoFactor(user.id, enableTwoFactorDto);
  }

  /**
   * Verifies a TOTP code and the account password, then disables 2FA
   */
  @UseGuards(ThrottleGuard)
  @Throttle({ limit: 5, windowMs: 60_000 })
  @Post('2fa/disable')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Verify a TOTP code and password, then disable 2FA',
  })
  @ApiResponse({ status: 200, description: '2FA disabled successfully' })
  @ApiResponse({ status: 400, description: 'Invalid input or 2FA not enabled' })
  @ApiResponse({
    status: 401,
    description: 'Not authenticated or invalid code/password',
  })
  @ApiResponse({ status: 429, description: 'Too many requests' })
  @HttpCode(HttpStatus.OK)
  disableTwoFactor(
    @CurrentUser() user: User,
    @Body() disableTwoFactorDto: DisableTwoFactorDto,
  ) {
    return this.authService.disableTwoFactor(user.id, disableTwoFactorDto);
  }

  /**
   * Sends a password reset link to the given email
   */
  @Public()
  @UseGuards(ThrottleGuard)
  @Throttle({ limit: 3, windowMs: 10 * 60_000 })
  @Post('forgot-password')
  @ApiOperation({ summary: 'Send a password reset link to the user email' })
  @ApiResponse({ status: 200, description: 'Reset link sent' })
  @ApiResponse({ status: 400, description: 'Invalid input' })
  @ApiResponse({ status: 429, description: 'Too many requests' })
  @HttpCode(HttpStatus.OK)
  forgotPassword(@Body() forgotPasswordDto: ForgotPasswordDto) {
    return this.authService.forgotPassword(forgotPasswordDto);
  }

  /**
   * Sets a new password using a valid reset token
   */
  @Public()
  @UseGuards(ThrottleGuard)
  @Throttle({ limit: 5, windowMs: 10 * 60_000 })
  @Post('reset-password')
  @ApiOperation({ summary: 'Reset the password using a reset token' })
  @ApiResponse({ status: 200, description: 'Password reset successfully' })
  @ApiResponse({ status: 400, description: 'Invalid input' })
  @ApiResponse({
    status: 401,
    description: 'Invalid or expired reset link',
  })
  @ApiResponse({ status: 429, description: 'Too many requests' })
  @HttpCode(HttpStatus.OK)
  resetPassword(@Body() resetPasswordDto: ResetPasswordDto) {
    return this.authService.resetPassword(resetPasswordDto);
  }

  /**
   * Serves the password reset form page linked from reset emails
   */
  @Public()
  @Get('reset-password')
  @ApiOperation({
    summary: 'Serve the password reset form (HTML page, linked from emails)',
  })
  @ApiResponse({ status: 200, description: 'Reset password form (HTML page)' })
  getResetPasswordPage(@Res() res: Response): void {
    res
      .status(HttpStatus.OK)
      .setHeader('Content-Type', 'text/html')
      .send(resetPasswordPage());
  }

  /**
   * Redirects the user to Google's OAuth consent screen
   */
  @Public()
  @Get('oauth/google')
  @ApiOperation({ summary: 'Start Google OAuth login (redirect to Google)' })
  @ApiResponse({
    status: 302,
    description: 'Redirect to Google consent screen',
  })
  async oauthGoogle(@Res() res: Response): Promise<void> {
    try {
      const url = await this.authService.getGoogleOAuthUrl();
      res.redirect(url);
    } catch (error: any) {
      res.redirect(this.oauthErrorRedirect(error?.message));
    }
  }

  /**
   * Handles the Google OAuth callback and redirects the user back to the
   * frontend with the issued tokens (or an error).
   */
  @Public()
  @Get('oauth/google/callback')
  @ApiOperation({
    summary:
      'Google OAuth callback - completes login and redirects to frontend',
  })
  @ApiResponse({
    status: 302,
    description: 'Redirect to frontend with tokens or an error',
  })
  async oauthGoogleCallback(
    @Query('code') code: string,
    @Query('state') state: string,
    @Query('error') oauthError: string,
    @Res() res: Response,
  ): Promise<void> {
    if (oauthError || !code || !state) {
      res.redirect(
        this.oauthErrorRedirect(
          oauthError ?? 'Google login was cancelled or incomplete',
        ),
      );
      return;
    }
    try {
      const result = await this.authService.handleGoogleOAuthCallback(
        code,
        state,
      );
      const base = `${getFrontendUrl()}/oauth/callback`;
      if ((result as any).requiresTwoFactor) {
        const fragment = new URLSearchParams({
          requires_two_factor: 'true',
          login_token: (result as any).loginToken,
        }).toString();
        res.redirect(`${base}#${fragment}`);
      } else {
        const fragment = new URLSearchParams({
          access_token: (result as any).accessToken,
          refresh_token: (result as any).refreshToken,
          user: JSON.stringify((result as any).user),
        }).toString();
        res.redirect(`${base}#${fragment}`);
      }
    } catch (error: any) {
      res.redirect(this.oauthErrorRedirect(error?.message));
    }
  }

  private oauthErrorRedirect(message: string): string {
    const sanitized = String(message ?? 'OAuth login failed')
      .replace(/[^\w\s.,!?-]/g, '')
      .slice(0, 200);
    const params = new URLSearchParams({ error: sanitized });
    return `${getFrontendUrl()}/oauth/callback?${params.toString()}`;
  }
}
