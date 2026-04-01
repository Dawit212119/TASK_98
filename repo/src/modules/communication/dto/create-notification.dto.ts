import { IsObject, IsString, IsUUID, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateNotificationDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  user_id!: string;

  @ApiProperty({ example: 'SYSTEM' })
  @IsString()
  @MaxLength(50)
  type!: string;

  @ApiProperty({ example: 'Policy update' })
  @IsString()
  @MaxLength(150)
  title!: string;

  @ApiProperty({ example: 'Your settings were updated.' })
  @IsString()
  @MaxLength(2000)
  body!: string;

  @ApiProperty({ type: Object, example: { source: 'ops' } })
  @IsObject()
  payload!: Record<string, unknown>;
}
