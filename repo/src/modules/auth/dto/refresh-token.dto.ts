import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

export class RefreshTokenDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  session_id!: string;

  @ApiProperty({ description: 'Opaque refresh token from login/register/refresh response', minLength: 32 })
  @IsString()
  @MinLength(32)
  @MaxLength(128)
  refresh_token!: string;
}
