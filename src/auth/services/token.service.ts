import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { randomUUID, createHash } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { TokenRevocationService } from './token-revocation.service';
import {
  ACCESS_TOKEN_EXPIRES_IN,
  DEFAULT_REFRESH_TOKEN_EXPIRES_IN,
  PASSWORD_RESET_TOKEN_EXPIRES_IN,
  TWO_FACTOR_LOGIN_TOKEN_EXPIRES_IN,
} from '../constant/auth-messages';
import type { TokenPayload } from '../interfaces/auth.interfaces';

/**
 * Central ownership of JWT signing, verification and session bookkeeping.
 * Every token issued by the auth flows goes through this service.
 */
@Injectable()
export class TokenService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly tokenRevocationService: TokenRevocationService,
  ) {}

  /**
   * Issues a fresh access/refresh token pair and persists the refresh token
   * (hashed) so it can be rotated and revoked server-side.
   */
  async issueTokens(userId: string, email: string, emailVerified = false) {
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

  /** Short-lived token proving the first (password) step of a 2FA login. */
  signTwoFactorLoginToken(userId: string, email: string): Promise<string> {
    return this.jwtService.signAsync(
      this.buildPayload(userId, email, 'two-factor-login'),
      { expiresIn: TWO_FACTOR_LOGIN_TOKEN_EXPIRES_IN },
    );
  }

  /** One-time password reset link token bound to the latest nonce. */
  signPasswordResetToken(
    userId: string,
    email: string,
    nonce: string,
  ): Promise<string> {
    return this.jwtService.signAsync(
      this.buildPayload(userId, email, 'password-reset', nonce),
      { expiresIn: PASSWORD_RESET_TOKEN_EXPIRES_IN },
    );
  }

  hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  /** Revokes a JWT until its natural expiry so it cannot be replayed. */
  async revokeToken(token: string): Promise<void> {
    const decoded = this.jwtService.decode(token);
    const ttlSeconds = Math.max(
      0,
      (decoded?.exp ?? 0) - Math.floor(Date.now() / 1000),
    );
    await this.tokenRevocationService.revoke(token, ttlSeconds);
  }

  /** Revokes every active refresh token for a user (session invalidation). */
  async revokeAllRefreshTokens(userId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  /** Rotates a refresh token and returns a new access/refresh pair. */
  async refresh(refreshToken: string) {
    let payload: TokenPayload;
    try {
      payload = await this.jwtService.verifyAsync<TokenPayload>(refreshToken);
    } catch {
      throw new UnauthorizedException('رمز التحديث غير صالح أو منتهي الصلاحية');
    }
    if (payload.type !== 'refresh') {
      throw new UnauthorizedException('رمز التحديث غير صالح أو منتهي الصلاحية');
    }

    const tokenHash = this.hashToken(refreshToken);
    const record = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
    });
    if (!record || record.expiresAt < new Date()) {
      throw new UnauthorizedException('رمز التحديث غير صالح أو منتهي الصلاحية');
    }
    if (record.revokedAt) {
      // Reuse of a rotated token is a sign of theft: revoke the whole family
      await this.prisma.refreshToken.updateMany({
        where: { userId: record.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      throw new UnauthorizedException('رمز التحديث غير صالح أو منتهي الصلاحية');
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

  private buildPayload(
    userId: string,
    email: string,
    type: TokenPayload['type'],
    prn?: string,
  ): TokenPayload {
    return { sub: userId, email, type, jti: randomUUID(), prn };
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
}
