import { IsEnum, IsString, IsUUID, MaxLength, MinLength, ValidateIf } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';

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
  @MinLength(8)
  @MaxLength(200)
  password!: string;

  @ApiProperty({ enum: SystemRole, example: SystemRole.PATIENT })
  @IsEnum(SystemRole)
  role!: SystemRole;

  @ApiPropertyOptional({
    format: 'uuid',
    nullable: true,
    description:
      'Optional with `security_answer`. Omit **both** for quick local/Swagger registration. Password reset using security questions requires both to be set at registration.'
  })
  @Transform(({ value }) => (value === '' || value === null ? undefined : value))
  @ValidateIf((_obj, value) => value !== undefined && value !== null && String(value).trim() !== '')
  @IsUUID()
  security_question_id?: string;

  @ApiPropertyOptional({
    example: 'blue',
    nullable: true,
    description: 'Optional. Must be set when `security_question_id` is set; omit both fields together.'
  })
  @Transform(({ value }) => (value === '' || value === null ? undefined : value))
  @ValidateIf((_obj, value) => value !== undefined && value !== null && String(value).trim() !== '')
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  security_answer?: string;
}
