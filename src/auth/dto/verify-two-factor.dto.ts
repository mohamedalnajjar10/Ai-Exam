import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';
import { TwoFactorCodeDto } from './two-factor-code.dto';

/**
 * DTO for completing a login with a two-factor authentication code
 */
export class VerifyTwoFactorDto extends TwoFactorCodeDto {
  @ApiProperty({
    description: 'Temporary login token issued when 2FA is required',
    example: 'eyJhbGciOiJIUzI1NiIs...',
  })
  @IsString()
  loginToken: string;
}
