import {
  Injectable,
  UnauthorizedException,
  InternalServerErrorException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID, randomBytes } from 'crypto';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { TokenService } from './token.service';
import {
  BCRYPT_SALT_ROUNDS,
  OAUTH_STATE_TTL_SECONDS,
  GOOGLE_OAUTH_AUTH_URL,
  GOOGLE_OAUTH_TOKEN_URL,
  GOOGLE_OAUTH_USERINFO_URL,
  GOOGLE_OAUTH_SCOPE,
} from '../constant/auth-messages';
import { getBackendUrl } from '../utils/app-urls.util';
import type { GoogleOAuthProfile } from '../interfaces/auth.interfaces';

/**
 * Google OAuth flows: consent URL generation, code exchange and
 * find-or-create account resolution.
 */
@Injectable()
export class OAuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly redisService: RedisService,
    private readonly tokenService: TokenService,
  ) {}

  /**
   * Builds the Google OAuth consent URL the user is redirected to.
   */
  async getGoogleOAuthUrl(): Promise<string> {
    const config = this.getGoogleConfig();
    const state = randomUUID();
    await this.redisService.set(
      `oauth-state:${state}`,
      'google',
      OAUTH_STATE_TTL_SECONDS,
    );

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
      const loginToken = await this.tokenService.signTwoFactorLoginToken(
        user.id,
        user.email,
      );
      return { requiresTwoFactor: true, loginToken };
    }

    return this.tokenService.issueTokens(
      user.id,
      user.email,
      user.emailVerified,
    );
  }

  private async consumeOAuthState(state: string): Promise<void> {
    const stored = await this.redisService.get(`oauth-state:${state}`);
    if (!stored) {
      throw new UnauthorizedException(
        'حالة OAuth غير صالحة. يرجى إعادة عملية تسجيل الدخول.',
      );
    }
    await this.redisService.del(`oauth-state:${state}`);
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
      throw new UnauthorizedException('لم تتمكن Google من استبدال رمز التفويض');
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
      throw new UnauthorizedException('لم تتمكن Google من تقديم ملف المستخدم');
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
      `${getBackendUrl(this.configService)}/api/v1/auth/oauth/google/callback`;

    if (!clientId || !clientSecret) {
      throw new InternalServerErrorException(
        'إعدادات OAuth الخاصة بـ Google غير مكتملة. يرجى الاتصال بمسؤول النظام.',
      );
    }
    return { clientId, clientSecret, redirectUri };
  }
}
