import { IsString, Matches } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/**
 * Base DTO containing a six-digit TOTP verification code
 */
export class TwoFactorCodeDto {
  @ApiProperty({
    description: 'Six-digit TOTP verification code from the authenticator app',
    example: '123456',
  })
  @IsString()
  @Matches(/^\d{6}$/, { message: 'code must be a 6-digit number' })
  code: string;
}
