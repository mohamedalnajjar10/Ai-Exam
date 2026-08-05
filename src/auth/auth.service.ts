import {
  Injectable,
  ConflictException,
  UnauthorizedException,
  NotFoundException,
  BadRequestException,
  InternalServerErrorException,
  ForbiddenException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcryptjs';
import { randomUUID, createHash, randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { TokenRevocationService } from './token-revocation.service';
import { RedisService } from '../redis/redis.service';
import { MailService } from '../mail/mail.service';
import { generateTotpSecret, verifyTotp } from './totp.util';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { VerifyTwoFactorDto } from './dto/verify-two-factor.dto';
import { EnableTwoFactorDto } from './dto/enable-two-factor.dto';
import { DisableTwoFactorDto } from './dto/disable-two-factor.dto';
import { VerifyRecoveryCodeDto } from './dto/verify-recovery-code.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import {
  BCRYPT_SALT_ROUNDS,
  ACCESS_TOKEN_EXPIRES_IN,
  DEFAULT_REFRESH_TOKEN_EXPIRES_IN,
  TWO_FACTOR_LOGIN_TOKEN_EXPIRES_IN,
  PASSWORD_RESET_TOKEN_EXPIRES_IN,
  PASSWORD_RESET_TOKEN_TTL_SECONDS,
  EMAIL_VERIFICATION_TOKEN_EXPIRES_IN,
  EMAIL_VERIFICATION_TOKEN_TTL_SECONDS,
  OAUTH_STATE_TTL_SECONDS,
  TOTP_ISSUER,
  RECOVERY_CODE_COUNT,
  RECOVERY_CODE_TTL_SECONDS,
  GOOGLE_OAUTH_AUTH_URL,
  GOOGLE_OAUTH_TOKEN_URL,
  GOOGLE_OAUTH_USERINFO_URL,
  GOOGLE_OAUTH_SCOPE,
  DUMMY_PASSWORD_HASH,
} from './constant/auth-messages';

import type {
  TokenPayload,
  GoogleOAuthProfile,
} from './interfaces/auth.interfaces';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly tokenRevocationService: TokenRevocationService,
    private readonly redisService: RedisService,
    private readonly mailService: MailService,
    private readonly configService: ConfigService,
  ) {}

  async register(registerDto: RegisterDto) {
    const existing = await this.prisma.user.findUnique({
      where: { email: registerDto.email },
    });
    if (existing) {
      throw new ConflictException('Email is already registered');
    }

    const passwordHash = await bcrypt.hash(
      registerDto.password,
      BCRYPT_SALT_ROUNDS,
    );

    const user = await this.prisma.user.create({
      data: {
        name: registerDto.name,
        email: registerDto.email,
        passwordHash,
      },
    });

    await this.sendEmailVerification(user.id, user.email);

    return {
      message:
        'Account created successfully. Please verify your email before logging in.',
    };
  }

  /**
   * Marks a user's email as verified using the token from the emailed link.
   */
  async verifyEmail(token: string) {
    const payload = await this.resolveEmailVerificationToken(token);

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
    });
    if (!user || user.email !== payload.email) {
      throw new UnauthorizedException(
        'Invalid verification link. Please request a new one.',
      );
    }

    if (user.emailVerified) {
      return { message: 'Your email is already verified' };
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { emailVerified: true },
    });

    await this.revokeToken(token);
    const redis: any = this.redisService.getClient();
    if (redis) {
      await redis.del(this.emailVerificationKey(user.id));
    }

    return { message: 'Your email has been verified successfully' };
  }

  /**
   * Sends a fresh verification link to the user's email. Always returns the
   * same message so the response does not reveal whether the email exists.
   */
  async resendVerification(email: string) {
    const user = await this.prisma.user.findUnique({ where: { email } });

    if (user && !user.emailVerified) {
      await this.sendEmailVerification(user.id, user.email);
    } else if (!user) {
      await bcrypt.compare(email, DUMMY_PASSWORD_HASH);
    }

    return { message: 'Verification link sent to your email' };
  }

  /**
   * Builds the Google OAuth consent URL the user is redirected to.
   */
  async getGoogleOAuthUrl(): Promise<string> {
    const config = this.getGoogleConfig();
    const state = randomUUID();
    const redis: any = this.redisService.getClient();
    if (redis) {
      await redis.set(
        `oauth-state:${state}`,
        'google',
        'EX',
        OAUTH_STATE_TTL_SECONDS,
      );
    }

    const params = new URLSearchParams({
      client_id: config.clientId,
      redirect_uri: config.redirectUri,
      response_type: 'code',
      scope: GOOGLE_OAUTH_SCOPE,
      access_type: 'online',
      state,
    });
    return `${GOOGLE_OAUTH_AUTH_URL}?${params.toString()}`;
  }

  /**
   * Completes a Google OAuth login: exchanges the authorization code for
   * tokens, resolves the profile, and finds-or-creates the user account.
   */
  async handleGoogleOAuthCallback(code: string, state: string) {
    const config = this.getGoogleConfig();
    await this.consumeOAuthState(state);

    const tokens = await this.exchangeGoogleCode(code, config);
    const profile = await this.fetchGoogleProfile(tokens.access_token);

    const user = await this.findOrCreateOAuthUser(profile);

    if (user.twoFactorEnabled) {
      const loginToken = await this.jwtService.signAsync(
        this.buildPayload(user.id, user.email, 'two-factor-login'),
        { expiresIn: TWO_FACTOR_LOGIN_TOKEN_EXPIRES_IN },
      );
      return { requiresTwoFactor: true, loginToken };
    }

    return this.issueTokens(user.id, user.email, user.emailVerified);
  }

  async login(loginDto: LoginDto) {
    const user = await this.prisma.user.findUnique({
      where: { email: loginDto.email },
    });
    if (!user) {
      // Perform a dummy bcrypt comparison so response time does not reveal
      // whether the email is registered.
      await bcrypt.compare(loginDto.password, DUMMY_PASSWORD_HASH);
      throw new UnauthorizedException('Invalid email or password');
    }

    if (!user.passwordHash) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const passwordValid = await bcrypt.compare(
      loginDto.password,
      user.passwordHash,
    );
    if (!passwordValid) {
      throw new UnauthorizedException('Invalid email or password');
    }

    if (!user.emailVerified) {
      throw new ForbiddenException(
        'Please verify your email address before logging in',
      );
    }

    if (user.twoFactorEnabled) {
      const loginToken = await this.jwtService.signAsync(
        this.buildPayload(user.id, user.email, 'two-factor-login'),
        { expiresIn: TWO_FACTOR_LOGIN_TOKEN_EXPIRES_IN },
      );
      return {
        requiresTwoFactor: true,
        loginToken,
      };
    }

    return this.issueTokens(user.id, user.email, user.emailVerified);
  }

  async verifyTwoFactor(verifyTwoFactorDto: VerifyTwoFactorDto) {
    const payload = await this.resolveTwoFactorLoginToken(
      verifyTwoFactorDto.loginToken,
    );

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
    });
    if (!user || !user.twoFactorEnabled || !user.twoFactorSecret) {
      throw new UnauthorizedException(
        'Two-factor authentication is not enabled for this account',
      );
    }

    const codeValid = verifyTotp(user.twoFactorSecret, verifyTwoFactorDto.code);
    if (!codeValid) {
      throw new UnauthorizedException('Invalid verification code');
    }

    return this.issueTokens(user.id, user.email, user.emailVerified);
  }

  async verifyRecoveryCode(verifyRecoveryCodeDto: VerifyRecoveryCodeDto) {
    const payload = await this.resolveTwoFactorLoginToken(
      verifyRecoveryCodeDto.loginToken,
    );

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
    });
    if (!user || !user.twoFactorEnabled) {
      throw new UnauthorizedException(
        'Two-factor authentication is not enabled for this account',
      );
    }

    const redis: any = this.redisService.getClient();
    if (!redis) {
      throw new UnauthorizedException('Recovery codes are unavailable');
    }

    const raw = await redis.get(this.recoveryCodesKey(user.id));
    const storedHashes: string[] = raw ? JSON.parse(raw) : [];

    const normalized = verifyRecoveryCodeDto.recoveryCode
      .replace('-', '')
      .toUpperCase();
    const presentedHash = this.hashToken(normalized);
    const index = storedHashes.indexOf(presentedHash);

    if (index === -1) {
      throw new UnauthorizedException('Invalid recovery code');
    }

    // Recovery codes are single-use: remove the used code and persist the rest
    storedHashes.splice(index, 1);
    await redis.set(
      this.recoveryCodesKey(user.id),
      JSON.stringify(storedHashes),
      'EX',
      RECOVERY_CODE_TTL_SECONDS,
    );

    return this.issueTokens(user.id, user.email, user.emailVerified);
  }

  async setupTwoFactor(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });
    if (!user) {
      throw new NotFoundException('User not found');
    }
    if (user.twoFactorEnabled) {
      throw new ConflictException(
        'Two-factor authentication is already enabled',
      );
    }

    const secret = generateTotpSecret();
    const otpauthUrl = `otpauth://totp/${encodeURIComponent(
      TOTP_ISSUER,
    )}:${encodeURIComponent(user.email)}?secret=${secret}&issuer=${encodeURIComponent(
      TOTP_ISSUER,
    )}`;

    await this.prisma.user.update({
      where: { id: user.id },
      data: { twoFactorSecret: secret },
    });

    return { secret, otpauthUrl };
  }

  async enableTwoFactor(userId: string, dto: EnableTwoFactorDto) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });
    if (!user) {
      throw new NotFoundException('User not found');
    }
    if (user.twoFactorEnabled) {
      throw new ConflictException(
        'Two-factor authentication is already enabled',
      );
    }
    if (!user.twoFactorSecret) {
      throw new BadRequestException('Please request a 2FA setup first');
    }

    const codeValid = verifyTotp(user.twoFactorSecret, dto.code);
    if (!codeValid) {
      throw new UnauthorizedException('Invalid verification code');
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { twoFactorEnabled: true },
    });

    // Invalidate all existing sessions now that 2FA is required
    await this.revokeAllRefreshTokens(user.id);

    // Issue one-time recovery codes as a fallback for lost authenticator devices
    const recoveryCodes = await this.issueRecoveryCodes(user.id);

    return {
      message: 'Two-factor authentication enabled successfully',
      recoveryCodes,
    };
  }

  async disableTwoFactor(userId: string, dto: DisableTwoFactorDto) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });
    if (!user) {
      throw new NotFoundException('User not found');
    }
    if (!user.twoFactorEnabled || !user.twoFactorSecret) {
      throw new BadRequestException('Two-factor authentication is not enabled');
    }

    // Re-authenticate with the password so 2FA cannot be removed by
    // someone holding only a transient TOTP code
    const passwordValid =
      !!user.passwordHash &&
      (await bcrypt.compare(dto.password, user.passwordHash));
    if (!passwordValid) {
      throw new UnauthorizedException('Invalid password');
    }

    const codeValid = verifyTotp(user.twoFactorSecret, dto.code);
    if (!codeValid) {
      throw new UnauthorizedException('Invalid verification code');
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { twoFactorEnabled: false, twoFactorSecret: null },
    });

    // Invalidate existing sessions and delete recovery codes
    await this.revokeAllRefreshTokens(user.id);
    await this.clearRecoveryCodes(user.id);

    return { message: 'Two-factor authentication disabled successfully' };
  }

  async logout(token: string) {
    const decoded = this.jwtService.decode(token);
    if (decoded?.exp) {
      const ttlSeconds = Math.max(
        0,
        decoded.exp - Math.floor(Date.now() / 1000),
      );
      await this.tokenRevocationService.revoke(token, ttlSeconds);
    }
    if (decoded?.sub) {
      await this.revokeAllRefreshTokens(decoded.sub);
    }
    return { message: 'Logged out successfully' };
  }

  async refresh(refreshToken: string) {
    let payload: TokenPayload;
    try {
      payload = await this.jwtService.verifyAsync<TokenPayload>(refreshToken);
    } catch {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }
    if (payload.type !== 'refresh') {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const tokenHash = this.hashToken(refreshToken);
    const record = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
    });
    if (!record || record.expiresAt < new Date()) {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }
    if (record.revokedAt) {
      // Reuse of a rotated token is a sign of theft: revoke the whole family
      await this.prisma.refreshToken.updateMany({
        where: { userId: record.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    // Rotate: revoke the current refresh token and issue a new pair
    await this.prisma.refreshToken.update({
      where: { tokenHash },
      data: { revokedAt: new Date() },
    });

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
    });

    return this.issueTokens(
      payload.sub,
      payload.email,
      user?.emailVerified ?? false,
    );
  }

  async getProfile(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });
    if (!user) {
      throw new NotFoundException('User not found');
    }
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      emailVerified: user.emailVerified,
      twoFactorEnabled: user.twoFactorEnabled,
      createdAt: user.createdAt,
    };
  }

  async forgotPassword(forgotPasswordDto: ForgotPasswordDto) {
    const user = await this.prisma.user.findUnique({
      where: { email: forgotPasswordDto.email },
    });

    if (user) {
      // Issue a fresh nonce that invalidates any previously sent reset links
      const nonce = randomUUID();
      const redis: any = this.redisService.getClient();
      if (redis) {
        await redis.set(
          `password-reset:${user.id}`,
          nonce,
          'EX',
          PASSWORD_RESET_TOKEN_TTL_SECONDS,
        );
      }

      const resetToken = await this.jwtService.signAsync(
        this.buildPayload(user.id, user.email, 'password-reset', nonce),
        { expiresIn: PASSWORD_RESET_TOKEN_EXPIRES_IN },
      );
      const resetLink = `${this.getBackendUrl()}/api/v1/auth/reset-password?token=${resetToken}`;

      await this.mailService.sendPasswordResetEmail(user.email, resetLink);
    } else {
      // Equalize response timing so the response does not reveal
      // whether the email is registered
      await bcrypt.compare(forgotPasswordDto.email, DUMMY_PASSWORD_HASH);
    }

    // Always return the same message to prevent user enumeration
    return { message: 'Password reset link sent to your email' };
  }

  async resetPassword(resetPasswordDto: ResetPasswordDto) {
    const payload = await this.resolvePasswordResetToken(
      resetPasswordDto.token,
    );

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
    });
    if (!user || user.email !== payload.email) {
      throw new UnauthorizedException(
        'Invalid reset link. Please request a new one.',
      );
    }

    const samePassword =
      !!user.passwordHash &&
      (await bcrypt.compare(resetPasswordDto.newPassword, user.passwordHash));
    if (samePassword) {
      throw new BadRequestException(
        'New password must be different from the current password',
      );
    }

    const passwordHash = await bcrypt.hash(
      resetPasswordDto.newPassword,
      BCRYPT_SALT_ROUNDS,
    );

    await this.prisma.user.update({
      where: { id: user.id },
      data: { passwordHash },
    });

    // Invalidate all existing sessions after a password change
    await this.revokeAllRefreshTokens(user.id);

    const redis: any = this.redisService.getClient();
    if (redis) {
      await redis.del(`password-reset:${user.id}`);
    }

    const decoded = this.jwtService.decode(resetPasswordDto.token);
    const ttlSeconds = Math.max(
      0,
      (decoded?.exp ?? 0) - Math.floor(Date.now() / 1000),
    );
    await this.tokenRevocationService.revoke(
      resetPasswordDto.token,
      ttlSeconds,
    );

    return { message: 'Password has been reset successfully' };
  }

  private async resolveEmailVerificationToken(
    token: string,
  ): Promise<TokenPayload> {
    let payload: TokenPayload;
    try {
      payload = await this.jwtService.verifyAsync<TokenPayload>(token);
    } catch {
      throw new UnauthorizedException(
        'This verification link has expired. Please request a new one.',
      );
    }
    if (payload.type !== 'email-verification') {
      throw new UnauthorizedException(
        'Invalid verification link. Please request a new one.',
      );
    }
    if (await this.tokenRevocationService.isRevoked(token)) {
      throw new UnauthorizedException(
        'This verification link has already been used. Please request a new one.',
      );
    }
    // The link is only valid if it was the most recently issued one
    const redis: any = this.redisService.getClient();
    if (payload.prn && redis) {
      const storedNonce = await redis.get(
        this.emailVerificationKey(payload.sub),
      );
      if (storedNonce !== payload.prn) {
        throw new UnauthorizedException(
          'This verification link is no longer valid. Please request a new one.',
        );
      }
    }
    return payload;
  }

  /**
   * Issues a fresh verification link (invalidating any previously sent ones)
   * and emails it to the user.
   */
  private async sendEmailVerification(
    userId: string,
    email: string,
  ): Promise<void> {
    const nonce = randomUUID();
    const redis: any = this.redisService.getClient();
    if (redis) {
      await redis.set(
        this.emailVerificationKey(userId),
        nonce,
        'EX',
        EMAIL_VERIFICATION_TOKEN_TTL_SECONDS,
      );
    }

    const verifyToken = await this.jwtService.signAsync(
      this.buildPayload(userId, email, 'email-verification', nonce),
      { expiresIn: EMAIL_VERIFICATION_TOKEN_EXPIRES_IN },
    );
    const verifyLink = `${this.getBackendUrl()}/api/v1/auth/verify-email?token=${verifyToken}`;

    await this.mailService.sendVerificationEmail(email, verifyLink);
  }

  private emailVerificationKey(userId: string): string {
    return `email-verification:${userId}`;
  }

  /** Revokes a JWT until its natural expiry so it cannot be replayed. */
  private async revokeToken(token: string): Promise<void> {
    const decoded = this.jwtService.decode(token);
    const ttlSeconds = Math.max(
      0,
      (decoded?.exp ?? 0) - Math.floor(Date.now() / 1000),
    );
    await this.tokenRevocationService.revoke(token, ttlSeconds);
  }

  private async consumeOAuthState(state: string): Promise<void> {
    const redis: any = this.redisService.getClient();
    if (!redis) {
      throw new UnauthorizedException('OAuth state verification unavailable');
    }
    const stored = await redis.get(`oauth-state:${state}`);
    if (!stored) {
      throw new UnauthorizedException(
        'Invalid OAuth state. Please start the login again.',
      );
    }
    await redis.del(`oauth-state:${state}`);
  }

  private async exchangeGoogleCode(
    code: string,
    config: { clientId: string; clientSecret: string; redirectUri: string },
  ): Promise<{ access_token: string; refresh_token?: string }> {
    const response = await fetch(GOOGLE_OAUTH_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code,
        client_id: config.clientId,
        client_secret: config.clientSecret,
        redirect_uri: config.redirectUri,
        grant_type: 'authorization_code',
      }),
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.access_token) {
      throw new UnauthorizedException(
        'Google could not exchange the authorization code',
      );
    }
    return data;
  }

  private async fetchGoogleProfile(
    accessToken: string,
  ): Promise<GoogleOAuthProfile> {
    const response = await fetch(GOOGLE_OAUTH_USERINFO_URL, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    const profile = await response.json().catch(() => null);
    if (!response.ok || !profile?.id || !profile?.email) {
      throw new UnauthorizedException(
        'Google could not provide the user profile',
      );
    }
    return profile as GoogleOAuthProfile;
  }

  /**
   * Resolves a Google profile into an AI Exam account. A user is matched by
   * the provider ID first, then by email (linking an existing account to
   * Google on first sign-in).
   */
  private async findOrCreateOAuthUser(profile: GoogleOAuthProfile): Promise<{
    id: string;
    email: string;
    emailVerified: boolean;
    twoFactorEnabled: boolean;
  }> {
    let user = await this.prisma.user.findFirst({
      where: { oauthProvider: 'google', oauthProviderId: profile.id },
    });

    if (!user) {
      user = await this.prisma.user.findUnique({
        where: { email: profile.email },
      });
    }
    if (user) {
      if (user.oauthProviderId !== profile.id) {
        user = await this.prisma.user.update({
          where: { id: user.id },
          data: {
            oauthProvider: 'google',
            oauthProviderId: profile.id,
            emailVerified:
              user.emailVerified || profile.verified_email === true,
          },
        });
      }
      return {
        id: user.id,
        email: user.email,
        emailVerified: user.emailVerified,
        twoFactorEnabled: user.twoFactorEnabled,
      };
    }

    const passwordHash = await bcrypt.hash(
      randomBytes(32).toString('hex'),
      BCRYPT_SALT_ROUNDS,
    );
    const created = await this.prisma.user.create({
      data: {
        name: profile.name || profile.email.split('@')[0],
        email: profile.email,
        passwordHash,
        emailVerified: profile.verified_email === true,
        oauthProvider: 'google',
        oauthProviderId: profile.id,
      },
    });

    return {
      id: created.id,
      email: created.email,
      emailVerified: created.emailVerified,
      twoFactorEnabled: created.twoFactorEnabled,
    };
  }

  private getGoogleConfig(): {
    clientId: string;
    clientSecret: string;
    redirectUri: string;
  } {
    const clientId = this.configService.get<string>('GOOGLE_CLIENT_ID');
    const clientSecret = this.configService.get<string>('GOOGLE_CLIENT_SECRET');
    const redirectUri =
      this.configService.get<string>('GOOGLE_REDIRECT_URI') ??
      `${this.getBackendUrl()}/api/v1/auth/oauth/google/callback`;

    if (!clientId || !clientSecret) {
      throw new InternalServerErrorException(
        'Google OAuth is not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.',
      );
    }
    return { clientId, clientSecret, redirectUri };
  }

  private async resolvePasswordResetToken(
    resetToken: string,
  ): Promise<TokenPayload> {
    let payload: TokenPayload;
    try {
      payload = await this.jwtService.verifyAsync<TokenPayload>(resetToken);
    } catch {
      throw new UnauthorizedException(
        'This reset link has expired. Please request a new one.',
      );
    }
    if (payload.type !== 'password-reset') {
      throw new UnauthorizedException(
        'Invalid reset link. Please request a new one.',
      );
    }
    if (await this.tokenRevocationService.isRevoked(resetToken)) {
      throw new UnauthorizedException(
        'This reset link has already been used. Please request a new one.',
      );
    }
    // The link is only valid if it was the most recently issued one
    const redis: any = this.redisService.getClient();
    if (payload.prn && redis) {
      const storedNonce = await redis.get(`password-reset:${payload.sub}`);
      if (storedNonce !== payload.prn) {
        throw new UnauthorizedException(
          'This reset link is no longer valid. Please request a new one.',
        );
      }
    }
    return payload;
  }

  private async issueRecoveryCodes(userId: string): Promise<string[]> {
    const codes = this.generateRecoveryCodes(RECOVERY_CODE_COUNT);
    const hashed = codes.map((code) =>
      this.hashToken(code.replace('-', '').toUpperCase()),
    );

    const redis: any = this.redisService.getClient();
    if (redis) {
      await redis.set(
        this.recoveryCodesKey(userId),
        JSON.stringify(hashed),
        'EX',
        RECOVERY_CODE_TTL_SECONDS,
      );
    }

    return codes;
  }

  private async clearRecoveryCodes(userId: string): Promise<void> {
    const redis: any = this.redisService.getClient();
    if (redis) {
      await redis.del(this.recoveryCodesKey(userId));
    }
  }

  private recoveryCodesKey(userId: string): string {
    return `2fa-recovery:${userId}`;
  }

  private generateRecoveryCodes(count: number): string[] {
    const codes: string[] = [];
    for (let i = 0; i < count; i++) {
      const hex = randomBytes(5).toString('hex');
      codes.push(`${hex.slice(0, 5)}-${hex.slice(5)}`);
    }
    return codes;
  }

  private async revokeAllRefreshTokens(userId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  private getFrontendUrl(): string {
    return (
      this.configService.get<string>('FRONTEND_URL') ?? 'http://localhost:3000'
    );
  }

  private getBackendUrl(): string {
    return (
      this.configService.get<string>('BACKEND_URL') ?? 'http://localhost:8087'
    );
  }

  private async resolveTwoFactorLoginToken(
    loginToken: string,
  ): Promise<TokenPayload> {
    let payload: TokenPayload;
    try {
      payload = await this.jwtService.verifyAsync<TokenPayload>(loginToken);
    } catch {
      throw new UnauthorizedException('Invalid or expired login token');
    }
    if (payload.type !== 'two-factor-login') {
      throw new UnauthorizedException('Invalid login token');
    }
    return payload;
  }

  private buildPayload(
    userId: string,
    email: string,
    type: TokenPayload['type'],
    prn?: string,
  ): TokenPayload {
    return { sub: userId, email, type, jti: randomUUID(), prn };
  }

  private async issueTokens(
    userId: string,
    email: string,
    emailVerified = false,
  ) {
    const refreshExpiresInSeconds = this.getRefreshExpiresInSeconds();

    const accessToken = await this.jwtService.signAsync(
      this.buildPayload(userId, email, 'access'),
      { expiresIn: ACCESS_TOKEN_EXPIRES_IN },
    );
    const refreshToken = await this.jwtService.signAsync(
      this.buildPayload(userId, email, 'refresh'),
      { expiresIn: refreshExpiresInSeconds },
    );

    const expiresAt = new Date(Date.now() + refreshExpiresInSeconds * 1000);
    await this.prisma.refreshToken.create({
      data: {
        userId,
        tokenHash: this.hashToken(refreshToken),
        expiresAt,
      },
    });

    return {
      accessToken,
      refreshToken,
      user: { id: userId, email, emailVerified },
    };
  }

  /**
   * Parses the JWT_REFRESH_EXPIRES_IN value (e.g. "7d", "12h", "30m") into
   * seconds. Falls back to 7 days when unset or malformed.
   */
  private getRefreshExpiresInSeconds(): number {
    const value =
      this.configService.get<string>('JWT_REFRESH_EXPIRES_IN') ??
      DEFAULT_REFRESH_TOKEN_EXPIRES_IN;

    const match = /^(\d+)([smhdw])$/.exec(value.trim());
    if (!match) {
      return 7 * 24 * 60 * 60;
    }

    const amount = Number(match[1]);
    const unitMultiplier: Record<string, number> = {
      s: 1,
      m: 60,
      h: 60 * 60,
      d: 24 * 60 * 60,
      w: 7 * 24 * 60 * 60,
    };
    return amount * unitMultiplier[match[2]];
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }
}
