import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import type { Request } from 'express';
import type { User } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { TokenRevocationService } from '../token-revocation.service';
import type { JwtPayload } from '../interfaces/auth.interfaces';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    config: ConfigService,
    private prisma: PrismaService,
    private tokenRevocationService: TokenRevocationService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get<string>('JWT_SECRET') ?? 'ai-exam-dev-secret',
      passReqToCallback: true,
    });
  }

  async validate(request: Request, payload: JwtPayload): Promise<User> {
    if (payload.type && payload.type !== 'access') {
      throw new UnauthorizedException('Invalid session. Please log in again.');
    }

    const token = ExtractJwt.fromAuthHeaderAsBearerToken()(request);
    if (token && (await this.tokenRevocationService.isRevoked(token))) {
      throw new UnauthorizedException(
        'Session has been terminated. Please log in again.',
      );
    }

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
    });
    if (!user) {
      throw new UnauthorizedException('Invalid session. Please log in again.');
    }
    return user;
  }
}
