import {
  Injectable,
  ConflictException,
  UnauthorizedException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { TokenService } from './token.service';
import { generateTotpSecret, verifyTotp } from '../utils/totp.util';
import { VerifyTwoFactorDto } from '../dto/verify-two-factor.dto';
import { EnableTwoFactorDto } from '../dto/enable-two-factor.dto';
import { DisableTwoFactorDto } from '../dto/disable-two-factor.dto';
import { VerifyRecoveryCodeDto } from '../dto/verify-recovery-code.dto';
import {
  TOTP_ISSUER,
  RECOVERY_CODE_COUNT,
  RECOVERY_CODE_TTL_SECONDS,
} from '../constant/auth-messages';
import type { TokenPayload } from '../interfaces/auth.interfaces';

/**
 * All two-factor authentication flows: TOTP setup, enabling/disabling,
 * login verification and single-use recovery codes.
 */
@Injectable()
export class TwoFactorService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly redisService: RedisService,
    private readonly tokenService: TokenService,
  ) {}

  /** Issues a short-lived login token to complete the 2FA step. */
  async createLoginToken(userId: string, email: string) {
    const loginToken = await this.tokenService.signTwoFactorLoginToken(
      userId,
      email,
    );
    return { requiresTwoFactor: true, loginToken };
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

    return this.tokenService.issueTokens(
      user.id,
      user.email,
      user.emailVerified,
    );
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
    const presentedHash = this.tokenService.hashToken(normalized);
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

    return this.tokenService.issueTokens(
      user.id,
      user.email,
      user.emailVerified,
    );
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
    await this.tokenService.revokeAllRefreshTokens(user.id);

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
    await this.tokenService.revokeAllRefreshTokens(user.id);
    await this.clearRecoveryCodes(user.id);

    return { message: 'Two-factor authentication disabled successfully' };
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

  private async issueRecoveryCodes(userId: string): Promise<string[]> {
    const codes = this.generateRecoveryCodes(RECOVERY_CODE_COUNT);
    const hashed = codes.map((code) =>
      this.tokenService.hashToken(code.replace('-', '').toUpperCase()),
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
}
