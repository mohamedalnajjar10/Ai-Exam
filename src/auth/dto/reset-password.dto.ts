import { IsString, MinLength, MaxLength, Matches } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/**
 * DTO for setting a new password using a reset token
 */
export class ResetPasswordDto {
  @ApiProperty({
    description: 'Password reset token from the emailed link',
    example: 'eyJhbGciOiJIUzI1NiIs...',
  })
  @IsString()
  token: string;

  @ApiProperty({
    description:
      'New password - at least 8 characters with letters and numbers',
    example: 'NewStrongPass456',
  })
  @IsString()
  @MinLength(8, { message: 'password must be at least 8 characters long' })
  @MaxLength(100, { message: 'password must not exceed 100 characters' })
  @Matches(/[A-Za-z]/, { message: 'password must contain at least one letter' })
  @Matches(/[0-9]/, { message: 'password must contain at least one number' })
  newPassword: string;
}
