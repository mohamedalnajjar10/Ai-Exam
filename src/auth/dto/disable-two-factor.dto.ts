import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';
import { TwoFactorCodeDto } from './two-factor-code.dto';

/**
 * DTO for disabling two-factor authentication.
 * Requires the account password in addition to a valid TOTP code so that
 * 2FA cannot be removed by someone with only a transient code.
 */
export class DisableTwoFactorDto extends TwoFactorCodeDto {
  @ApiProperty({
    description: 'Current account password for re-authentication',
    example: 'StrongPass123',
  })
  @IsString()
  password: string;
}
