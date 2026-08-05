import { IsString, IsEmail } from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

/**
 * DTO for logging in with email and password
 */
export class LoginDto {
  @ApiProperty({
    description: 'Registered email address',
    example: 'ahmed@example.com',
  })
  @IsEmail({}, { message: 'email must be a valid email address' })
  @Transform(({ value }) =>
    typeof value === 'string' ? value.toLowerCase().trim() : value,
  )
  email: string;

  @ApiProperty({
    description: 'Account password',
    example: 'StrongPass123',
  })
  @IsString()
  password: string;
}
