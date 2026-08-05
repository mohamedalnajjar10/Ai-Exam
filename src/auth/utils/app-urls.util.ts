import { ConfigService } from '@nestjs/config';

/**
 * Application base URLs resolved from the environment with sensible
 * development fallbacks. Shared by every link-building auth flow.
 * Accepts an optional ConfigService so it also works outside DI context.
 */
export function getBackendUrl(configService?: ConfigService): string {
  return (
    configService?.get<string>('BACKEND_URL') ??
    process.env.BACKEND_URL ??
    'http://localhost:8087'
  );
}

export function getFrontendUrl(configService?: ConfigService): string {
  return (
    configService?.get<string>('FRONTEND_URL') ??
    process.env.FRONTEND_URL ??
    'http://localhost:3000'
  );
}
