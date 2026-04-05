import { IsEnum, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { IsStrongPassword } from '../../../common/validators/strong-password.decorator';

export enum SystemRole {
  PATIENT = 'patient',
  STAFF = 'staff',
  PROVIDER = 'provider',
  MERCHANT = 'merchant',
  OPS_ADMIN = 'ops_admin',
  ANALYTICS_VIEWER = 'analytics_viewer'
}

export class RegisterDto {
  @ApiProperty({ example: 'demo_patient' })
  @IsString()
  @MinLength(3)
  @MaxLength(100)
  username!: string;

  @ApiProperty({ example: 'Password123!' })
  @IsString()
  @IsStrongPassword()
  password!: string;

  @ApiProperty({ enum: SystemRole, example: SystemRole.PATIENT })
  @IsEnum(SystemRole)
  role!: SystemRole;

  @ApiProperty({
    format: 'uuid',
    description: 'Required. Use `GET /auth/security-questions` to list valid ids. Needed for password reset via security questions.'
  })
  @IsUUID()
  security_question_id!: string;

  @ApiProperty({ example: 'blue' })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  security_answer!: string;
}
