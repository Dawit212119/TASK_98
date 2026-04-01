import { IsEnum, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export enum ProvisionableSystemRole {
  STAFF = 'staff',
  PROVIDER = 'provider',
  MERCHANT = 'merchant',
  OPS_ADMIN = 'ops_admin',
  ANALYTICS_VIEWER = 'analytics_viewer'
}

export class ProvisionUserDto {
  @ApiProperty({ example: 'staff_demo' })
  @IsString()
  @MinLength(3)
  @MaxLength(100)
  username!: string;

  @ApiProperty({ example: 'Password123!' })
  @IsString()
  @MinLength(8)
  @MaxLength(200)
  password!: string;

  @ApiProperty({ enum: ProvisionableSystemRole, example: ProvisionableSystemRole.STAFF })
  @IsEnum(ProvisionableSystemRole)
  role!: ProvisionableSystemRole;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  security_question_id!: string;

  @ApiProperty({ example: 'blue' })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  security_answer!: string;
}
