import { SetMetadata } from '@nestjs/common';

/**
 * Options for the ThrottleGuard - limits how many requests a client may
 * make to the decorated endpoint within a time window.
 */
export interface ThrottleOptions {
  /** Maximum number of requests allowed within the window */
  limit: number;
  /** Window length in milliseconds */
  windowMs: number;
}

export const THROTTLE_METADATA = 'throttle';

/**
 * Decorator that attaches rate-limit configuration to an endpoint.
 * The ThrottleGuard reads this metadata and enforces the limits.
 *
 * @example
 * @Throttle({ limit: 5, windowMs: 60_000 })
 */
export const Throttle = (options: ThrottleOptions) =>
  SetMetadata(THROTTLE_METADATA, options);
