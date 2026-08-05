import * as bcrypt from 'bcryptjs';

export const SESSION_EXPIRED_MESSAGE =
  'Your session has expired. Please log in again';
export const AUTH_REQUIRED_MESSAGE = 'Authentication required';

export const BCRYPT_SALT_ROUNDS = 10;
export const ACCESS_TOKEN_EXPIRES_IN = '1h';
export const DEFAULT_REFRESH_TOKEN_EXPIRES_IN = '7d';
export const TWO_FACTOR_LOGIN_TOKEN_EXPIRES_IN = '5m';
export const PASSWORD_RESET_TOKEN_EXPIRES_IN = '15m';
export const PASSWORD_RESET_TOKEN_TTL_SECONDS = 15 * 60;
export const EMAIL_VERIFICATION_TOKEN_EXPIRES_IN = '24h';
export const EMAIL_VERIFICATION_TOKEN_TTL_SECONDS = 24 * 60 * 60;
export const OAUTH_STATE_TTL_SECONDS = 10 * 60;
export const TOTP_ISSUER = 'AI Exam';
export const RECOVERY_CODE_COUNT = 10;
export const RECOVERY_CODE_TTL_SECONDS = 365 * 24 * 60 * 60; // 1 year
export const GOOGLE_OAUTH_AUTH_URL =
  'https://accounts.google.com/o/oauth2/v2/auth';
export const GOOGLE_OAUTH_TOKEN_URL = 'https://oauth2.googleapis.com/token';
export const GOOGLE_OAUTH_USERINFO_URL =
  'https://www.googleapis.com/oauth2/v2/userinfo';
export const GOOGLE_OAUTH_SCOPE = 'openid email profile';

/**
 * Pre-computed bcrypt hash used to equalize login timing for unknown emails,
 * preventing attackers from distinguishing valid from invalid accounts.
 */
export const DUMMY_PASSWORD_HASH = bcrypt.hashSync(
  'ai-exam-timing-equalizer',
  BCRYPT_SALT_ROUNDS,
);

/**
 * Fallback JWT secret used only in development/test environments.
 * Must NOT be used in production — a startup check enforces this.
 */
export const DEV_JWT_SECRET = 'ai-exam-dev-secret';
