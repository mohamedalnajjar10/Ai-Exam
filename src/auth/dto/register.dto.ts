import {
  IsString,
  IsEmail,
  MinLength,
  MaxLength,
  Matches,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

/**
 * DTO for registering a new user account
 */
export class RegisterDto {
  @ApiProperty({
    description: 'User display name',
    example: 'Ahmed Ali',
  })
  @IsString()
  @MinLength(2, { message: 'name must be at least 2 characters long' })
  @MaxLength(100, { message: 'name must not exceed 100 characters' })
  name: string;

  @ApiProperty({
    description: 'Login email address (must be unique)',
    example: 'ahmed@example.com',
  })
  @IsEmail({}, { message: 'email must be a valid email address' })
  @Transform(({ value }) =>
    typeof value === 'string' ? value.toLowerCase().trim() : value,
  )
  email: string;

  @ApiProperty({
    description: 'Password - at least 8 characters with letters and numbers',
    example: 'StrongPass123',
  })
  @IsString()
  @MinLength(8, { message: 'password must be at least 8 characters long' })
  @Matches(/[A-Za-z]/, { message: 'password must contain at least one letter' })
  @Matches(/[0-9]/, { message: 'password must contain at least one number' })
  password: string;
}
