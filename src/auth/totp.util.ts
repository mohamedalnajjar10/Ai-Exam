import { createHmac, randomBytes } from 'crypto';

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const CODE_DIGITS = 6;
const TIME_STEP_SECONDS = 30;
const VERIFY_WINDOW = 1;

function base32Encode(buffer: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }
  return output;
}

function base32Decode(input: string): Buffer {
  const cleaned = input.toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const char of cleaned) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index === -1) continue;
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

function hmacDigest(secret: Buffer, counter: number): Buffer {
  const message = Buffer.alloc(8);
  message.writeUInt32BE(counter, 4);
  return createHmac('sha1', secret).update(message).digest();
}

function codeFromCounter(secret: Buffer, counter: number): string {
  const digest = hmacDigest(secret, counter);
  const offset = digest[digest.length - 1] & 0x0f;
  const binary =
    ((digest[offset] & 0x7f) << 24) |
    (digest[offset + 1] << 16) |
    (digest[offset + 2] << 8) |
    digest[offset + 3];
  return (binary % 10 ** CODE_DIGITS).toString().padStart(CODE_DIGITS, '0');
}

export function generateTotpCode(
  secret: string,
  at: Date = new Date(),
): string {
  const counter = Math.floor(at.getTime() / 1000 / TIME_STEP_SECONDS);
  return codeFromCounter(base32Decode(secret), counter);
}

export function verifyTotp(
  secret: string,
  code: string,
  at: Date = new Date(),
): boolean {
  const counter = Math.floor(at.getTime() / 1000 / TIME_STEP_SECONDS);
  const key = base32Decode(secret);
  for (let i = -VERIFY_WINDOW; i <= VERIFY_WINDOW; i++) {
    if (codeFromCounter(key, counter + i) === code) {
      return true;
    }
  }
  return false;
}
