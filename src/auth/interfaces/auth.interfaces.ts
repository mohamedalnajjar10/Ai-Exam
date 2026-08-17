/** JWT payload embedded in every token issued by the auth service */
export interface TokenPayload {
  sub: string;
  email: string;
  type: 'access' | 'refresh' | 'two-factor-login' | 'password-reset';
  jti: string;
  /** Nonce - ties a link token to the latest reset/verification request */
  prn?: string;
}

/** Verified profile returned by the Google OAuth userinfo endpoint */
export interface GoogleOAuthProfile {
  id: string;
  email: string;
  name?: string;
  verified_email?: boolean;
}

/** Shape of the decoded access-token used by the JWT strategy */
export interface JwtPayload {
  sub: string;
  email: string;
  jti?: string;
  type?: string;
}
