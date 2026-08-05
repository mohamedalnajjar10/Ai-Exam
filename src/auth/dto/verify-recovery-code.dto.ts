import { IsString, Matches } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/**
 * DTO for completing a login with a one-time 2FA recovery code
 */
export class VerifyRecoveryCodeDto {
  @ApiProperty({
    description: 'Temporary login token issued when 2FA is required',
    example: 'eyJhbGciOiJIUzI1NiIs...',
  })
  @IsString()
  loginToken: string;

  @ApiProperty({
    description:
      'One-time recovery code (format xxxxx-xxxxx) issued when 2FA was enabled',
    example: 'a1b2c-d3e4f',
  })
  @IsString()
  @Matches(/^[a-z0-9]{5}-[a-z0-9]{5}$/i, {
    message: 'recoveryCode must have the format xxxxx-xxxxx',
  })
  recoveryCode: string;
}
