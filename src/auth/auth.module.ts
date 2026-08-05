import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { AuthService } from './services/auth.service';
import { TokenService } from './services/token.service';
import { TwoFactorService } from './services/two-factor.service';
import { OAuthService } from './services/oauth.service';
import { PasswordService } from './services/password.service';
import { AuthController } from './auth.controller';
import { TokenRevocationService } from './services/token-revocation.service';
import { JwtStrategy } from './strategies/jwt.strategy';
import { PrismaModule } from '../prisma/prisma.module';
import { MailModule } from '../mail/mail.module';
import { ThrottleGuard } from '../common/guards/throttle.guard';
import { DEV_JWT_SECRET } from './constant/auth-messages';

@Module({
  imports: [
    PrismaModule,
    MailModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const secret = configService.get<string>('JWT_SECRET');
        const nodeEnv = configService.get<string>('NODE_ENV');
        if (
          nodeEnv === 'production' &&
          (!secret || secret === DEV_JWT_SECRET)
        ) {
          throw new Error(
            'JWT_SECRET must be set to a secure value in production. ' +
              'The default dev secret is not allowed when NODE_ENV=production.',
          );
        }
        return { secret: secret ?? DEV_JWT_SECRET };
      },
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    TokenService,
    TwoFactorService,
    OAuthService,
    PasswordService,
    TokenRevocationService,
    JwtStrategy,
    ThrottleGuard,
  ],
  exports: [JwtModule],
})
export class AuthModule {}
