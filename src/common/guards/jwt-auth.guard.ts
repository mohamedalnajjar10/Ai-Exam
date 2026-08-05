import {
  Injectable,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import {
  AUTH_REQUIRED_MESSAGE,
  SESSION_EXPIRED_MESSAGE,
} from '../../auth/constant/auth-messages';

interface TokenErrorInfo {
  name?: string;
}

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private reflector: Reflector) {
    super();
  }

  canActivate(context: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }
    return super.canActivate(context);
  }

  handleRequest<TUser = unknown>(
    err: unknown,
    user: TUser,
    info: unknown,
  ): TUser {
    if (err instanceof Error) {
      throw err;
    }
    if (!user) {
      const expired =
        (info as TokenErrorInfo | undefined)?.name === 'TokenExpiredError';
      throw new UnauthorizedException(
        expired ? SESSION_EXPIRED_MESSAGE : AUTH_REQUIRED_MESSAGE,
      );
    }
    return user;
  }
}
