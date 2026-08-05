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

@Module({
  imports: [
    PrismaModule,
    MailModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const secret = configService.get<string>('JWT_SECRET');
        if (configService.get<string>('NODE_ENV') === 'production' && !secret) {
          throw new Error(
            'JWT_SECRET must be set in the environment when NODE_ENV=production',
          );
        }
        return { secret: secret ?? 'ai-exam-dev-secret' };
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
