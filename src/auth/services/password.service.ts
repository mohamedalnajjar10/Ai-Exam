import {
  Injectable,
  UnauthorizedException,
  BadRequestException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { MailService } from '../../mail/mail.service';
import { TokenRevocationService } from './token-revocation.service';
import { TokenService } from './token.service';
import { ForgotPasswordDto } from '../dto/forgot-password.dto';
import { ResetPasswordDto } from '../dto/reset-password.dto';
import {
  BCRYPT_SALT_ROUNDS,
  PASSWORD_RESET_TOKEN_TTL_SECONDS,
  DUMMY_PASSWORD_HASH,
} from '../constant/auth-messages';
import { getBackendUrl } from '../utils/app-urls.util';
import type { TokenPayload } from '../interfaces/auth.interfaces';

/**
 * Password recovery flows: issuing reset links, validating them and
 * updating the password with session invalidation.
 */
@Injectable()
export class PasswordService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly redisService: RedisService,
    private readonly mailService: MailService,
    private readonly tokenRevocationService: TokenRevocationService,
    private readonly tokenService: TokenService,
  ) {}

  async forgotPassword(forgotPasswordDto: ForgotPasswordDto) {
    const user = await this.prisma.user.findUnique({
      where: { email: forgotPasswordDto.email },
    });

    if (user) {
      // Issue a fresh nonce that invalidates any previously sent reset links
      const nonce = randomUUID();
      await this.redisService.set(
        `password-reset:${user.id}`,
        nonce,
        PASSWORD_RESET_TOKEN_TTL_SECONDS,
      );

      const resetToken = await this.tokenService.signPasswordResetToken(
        user.id,
        user.email,
        nonce,
      );
      const resetLink = `${getBackendUrl(
        this.configService,
      )}/api/v1/auth/reset-password?token=${resetToken}`;

      await this.mailService.sendPasswordResetEmail(user.email, resetLink);

      return {
        message: 'تم إرسال رابط إعادة تعيين كلمة المرور إلى بريدك الإلكتروني',
        resetLink,
      };
    } else {
      // Equalize response timing so the response does not reveal
      // whether the email is registered
      await bcrypt.compare(forgotPasswordDto.email, DUMMY_PASSWORD_HASH);
    }

    // Always return the same message to prevent user enumeration
    return {
      message: 'تم إرسال رابط إعادة تعيين كلمة المرور إلى بريدك الإلكتروني',
    };
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
        'رابط إعادة الضبط غير صالح. يرجى طلب رابط جديد.',
      );
    }

    const samePassword =
      !!user.passwordHash &&
      (await bcrypt.compare(resetPasswordDto.newPassword, user.passwordHash));
    if (samePassword) {
      throw new BadRequestException(
        'يجب أن تكون كلمة المرور الجديدة مختلفة عن كلمة المرور الحالية',
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
    await this.tokenService.revokeAllRefreshTokens(user.id);

    await this.redisService.del(`password-reset:${user.id}`);

    await this.tokenService.revokeToken(resetPasswordDto.token);

    return { message: 'تم إعادة تعيين كلمة المرور بنجاح' };
  }

  private async resolvePasswordResetToken(
    resetToken: string,
  ): Promise<TokenPayload> {
    let payload: TokenPayload;
    try {
      payload = await this.jwtService.verifyAsync<TokenPayload>(resetToken);
    } catch {
      throw new UnauthorizedException(
        'انتهت صلاحية رابط إعادة التعيين. يرجى طلب رابط جديد.',
      );
    }
    if (payload.type !== 'password-reset') {
      throw new UnauthorizedException(
        'رابط إعادة الضبط غير صالح. يرجى طلب رابط جديد.',
      );
    }
    if (await this.tokenRevocationService.isRevoked(resetToken)) {
      throw new UnauthorizedException(
        'هذا رابط إعادة التعيين تم استخدامه بالفعل. يرجى طلب رابط جديد.',
      );
    }
    // The link is only valid if it was the most recently issued one
    if (payload.prn) {
      const storedNonce = await this.redisService.get(
        `password-reset:${payload.sub}`,
      );
      if (storedNonce !== payload.prn) {
        throw new UnauthorizedException(
          'هذا رابط إعادة التعيين لم يعد ساريًا. يرجى طلب رابط جديد.',
        );
      }
    }
    return payload;
  }
}
