import { IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/**
 * DTO for rotating a refresh token into a new access/refresh token pair
 */
export class RefreshTokenDto {
  @ApiProperty({
    description: 'The refresh token previously issued at register/login',
    example: 'eyJhbGciOiJIUzI1NiIs...',
  })
  @IsString()
  refreshToken: string;
}
