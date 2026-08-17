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
import { randomInt, createHash, timingSafeEqual } from 'crypto';
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
  EMAIL_VERIFICATION_CODE_TTL_SECONDS,
  EMAIL_VERIFICATION_MAX_ATTEMPTS,
  DUMMY_PASSWORD_HASH,
} from '../constant/auth-messages';

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
      throw new ConflictException('البريد الإلكتروني مسجل بالفعل');
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
        'تم إنشاء الحساب بنجاح. تم إرسال رمز التحقق إلى بريدك الإلكتروني قبل تسجيل الدخول.',
    };
  }

  /**
   * Marks a user's email as verified using the code from the email.
   */
  async verifyEmail(email: string, code: string) {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) {
      throw new UnauthorizedException(
        'رمز التحقق غير صالح. يرجى طلب رمز جديد.',
      );
    }

    if (user.emailVerified) {
      return { message: 'تم التحقق من بريدك الإلكتروني بالفعل' };
    }

    const attempts = await this.redisService.incrWithExpiry(
      this.emailVerificationAttemptsKey(user.id),
      EMAIL_VERIFICATION_CODE_TTL_SECONDS,
    );
    if (attempts > EMAIL_VERIFICATION_MAX_ATTEMPTS) {
      throw new UnauthorizedException(
        'لقد استنفدت محاولات التحقق. يرجى طلب رمز جديد.',
      );
    }

    const storedCode = await this.redisService.get(
      this.emailVerificationKey(user.id),
    );
    if (!storedCode) {
      throw new UnauthorizedException(
        'انتهت صلاحية رمز التحقق. يرجى طلب رمز جديد.',
      );
    }
    if (!codesMatch(storedCode, code)) {
      throw new UnauthorizedException('رمز التحقق غير صحيح');
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { emailVerified: true },
    });

    await this.redisService.del(this.emailVerificationKey(user.id));
    await this.redisService.del(this.emailVerificationAttemptsKey(user.id));

    return { message: 'تم التحقق من بريدك الإلكتروني بنجاح' };
  }

  /**
   * Sends a fresh verification code to the user's email. Always returns the
   * same message so the response does not reveal whether the email exists.
   */
  async resendVerification(email: string) {
    const user = await this.prisma.user.findUnique({ where: { email } });

    if (user && !user.emailVerified) {
      await this.sendEmailVerification(user.id, user.email);
    } else if (!user) {
      await bcrypt.compare(email, DUMMY_PASSWORD_HASH);
    }

    return { message: 'تم إرسال رمز التحقق إلى بريدك الإلكتروني' };
  }

  async login(loginDto: LoginDto) {
    const user = await this.prisma.user.findUnique({
      where: { email: loginDto.email },
    });
    if (!user) {
      // Perform a dummy bcrypt comparison so response time does not reveal
      // whether the email is registered.
      await bcrypt.compare(loginDto.password, DUMMY_PASSWORD_HASH);
      throw new UnauthorizedException(
        'البريد الإلكتروني أو كلمة المرور غير صحيحة',
      );
    }

    if (!user.passwordHash) {
      throw new UnauthorizedException(
        'البريد الإلكتروني أو كلمة المرور غير صحيحة',
      );
    }

    const passwordValid = await bcrypt.compare(
      loginDto.password,
      user.passwordHash,
    );
    if (!passwordValid) {
      throw new UnauthorizedException(
        'البريد الإلكتروني أو كلمة المرور غير صحيحة',
      );
    }

    if (!user.emailVerified) {
      throw new ForbiddenException(
        'يرجى التحقق من بريدك الإلكتروني قبل تسجيل الدخول',
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
    return { message: 'تم تسجيل الخروج بنجاح' };
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

  /**
   * Issues a fresh verification code (invalidating any previously sent ones)
   * and emails it to the user.
   */
  private async sendEmailVerification(
    userId: string,
    email: string,
  ): Promise<void> {
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    await this.redisService.set(
      this.emailVerificationKey(userId),
      code,
      EMAIL_VERIFICATION_CODE_TTL_SECONDS,
    );
    await this.redisService.del(this.emailVerificationAttemptsKey(userId));

    await this.mailService.sendVerificationEmail(email, code);
  }

  private emailVerificationKey(userId: string): string {
    return `email-verification:${userId}`;
  }

  private emailVerificationAttemptsKey(userId: string): string {
    return `email-verification:attempts:${userId}`;
  }
}

/** Constant-time comparison of two verification codes */
function codesMatch(a: string, b: string): boolean {
  const aHash = createHash('sha256').update(String(a)).digest();
  const bHash = createHash('sha256').update(String(b)).digest();
  return timingSafeEqual(aHash, bHash);
}
