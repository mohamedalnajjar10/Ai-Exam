import {
  Injectable,
  ConflictException,
  UnauthorizedException,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { TokenRevocationService } from './token-revocation.service';
import { RedisService } from '../../redis/redis.service';
import { MailService } from '../../mail/mail.service';
import { TokenService } from './token.service';
import { TwoFactorService } from './two-factor.service';
import { OAuthService } from './oauth.service';
import { PasswordService } from './password.service';
import { RegisterDto } from '../dto/register.dto';
import { LoginDto } from '../dto/login.dto';
import { VerifyTwoFactorDto } from '../dto/verify-two-factor.dto';
import { EnableTwoFactorDto } from '../dto/enable-two-factor.dto';
import { DisableTwoFactorDto } from '../dto/disable-two-factor.dto';
import { VerifyRecoveryCodeDto } from '../dto/verify-recovery-code.dto';
import { ForgotPasswordDto } from '../dto/forgot-password.dto';
import { ResetPasswordDto } from '../dto/reset-password.dto';
import {
  BCRYPT_SALT_ROUNDS,
  EMAIL_VERIFICATION_TOKEN_TTL_SECONDS,
  DUMMY_PASSWORD_HASH,
} from '../constant/auth-messages';
import { getBackendUrl } from '../utils/app-urls.util';
import type { TokenPayload } from '../interfaces/auth.interfaces';

/**
 * Core authentication flows: account registration, email verification,
 * credential login, logout and profile. Token, 2FA, OAuth and password
 * recovery concerns live in their own focused services.
 */
@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly tokenRevocationService: TokenRevocationService,
    private readonly redisService: RedisService,
    private readonly mailService: MailService,
    private readonly configService: ConfigService,
    private readonly tokenService: TokenService,
    private readonly twoFactorService: TwoFactorService,
    private readonly oauthService: OAuthService,
    private readonly passwordService: PasswordService,
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

    await this.tokenService.revokeToken(token);
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
      return this.twoFactorService.createLoginToken(user.id, user.email);
    }

    return this.tokenService.issueTokens(
      user.id,
      user.email,
      user.emailVerified,
    );
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
      await this.tokenService.revokeAllRefreshTokens(decoded.sub);
    }
    return { message: 'Logged out successfully' };
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

  verifyTwoFactor(verifyTwoFactorDto: VerifyTwoFactorDto) {
    return this.twoFactorService.verifyTwoFactor(verifyTwoFactorDto);
  }

  verifyRecoveryCode(verifyRecoveryCodeDto: VerifyRecoveryCodeDto) {
    return this.twoFactorService.verifyRecoveryCode(verifyRecoveryCodeDto);
  }

  setupTwoFactor(userId: string) {
    return this.twoFactorService.setupTwoFactor(userId);
  }

  enableTwoFactor(userId: string, enableTwoFactorDto: EnableTwoFactorDto) {
    return this.twoFactorService.enableTwoFactor(userId, enableTwoFactorDto);
  }

  disableTwoFactor(userId: string, disableTwoFactorDto: DisableTwoFactorDto) {
    return this.twoFactorService.disableTwoFactor(userId, disableTwoFactorDto);
  }

  refresh(refreshToken: string) {
    return this.tokenService.refresh(refreshToken);
  }

  forgotPassword(forgotPasswordDto: ForgotPasswordDto) {
    return this.passwordService.forgotPassword(forgotPasswordDto);
  }

  resetPassword(resetPasswordDto: ResetPasswordDto) {
    return this.passwordService.resetPassword(resetPasswordDto);
  }

  getGoogleOAuthUrl(): Promise<string> {
    return this.oauthService.getGoogleOAuthUrl();
  }

  handleGoogleOAuthCallback(code: string, state: string) {
    return this.oauthService.handleGoogleOAuthCallback(code, state);
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

    const verifyToken = await this.tokenService.signEmailVerificationToken(
      userId,
      email,
      nonce,
    );
    const verifyLink = `${getBackendUrl(
      this.configService,
    )}/api/v1/auth/verify-email?token=${verifyToken}`;

    await this.mailService.sendVerificationEmail(email, verifyLink);
  }

  private emailVerificationKey(userId: string): string {
    return `email-verification:${userId}`;
  }
}
