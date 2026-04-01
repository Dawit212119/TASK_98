import { IsString, MaxLength, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ConfirmPasswordResetDto {
  @ApiProperty({ example: '1f9a1f...reset-token' })
  @IsString()
  @MinLength(16)
  reset_token!: string;

  @ApiProperty({ example: 'NewPassword123!' })
  @IsString()
  @MinLength(8)
  @MaxLength(200)
  new_password!: string;
}
