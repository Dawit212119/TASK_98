import { IsString, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { IsStrongPassword } from '../../../common/validators/strong-password.decorator';

export class ConfirmPasswordResetDto {
  @ApiProperty({ example: '1f9a1f...reset-token' })
  @IsString()
  @MinLength(16)
  reset_token!: string;

  @ApiProperty({ example: 'NewPassword123!' })
  @IsString()
  @IsStrongPassword()
  new_password!: string;
}
