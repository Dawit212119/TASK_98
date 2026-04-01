import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsInt,
  IsObject,
  IsString,
  Min,
  IsUUID,
  ValidateNested
} from 'class-validator';

export enum SyncEntityType {
  RESERVATION = 'reservation',
  NOTIFICATION = 'notification'
}

export enum SyncOperation {
  UPSERT = 'UPSERT',
  DELETE = 'DELETE'
}

class SyncChangeDto {
  @ApiProperty({ enum: SyncEntityType, example: SyncEntityType.RESERVATION })
  @IsString()
  entity_type!: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  entity_id!: string;

  @ApiProperty({ enum: SyncOperation, example: SyncOperation.UPSERT })
  @IsString()
  operation!: string;

  @ApiProperty({ type: Object })
  @IsObject()
  payload!: Record<string, unknown>;

  @ApiProperty({ example: 3 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  base_version!: number;

  @ApiProperty({ example: '2026-01-01T12:00:00.000Z' })
  @IsDateString()
  updated_at!: string;
}

export class SyncPushDto {
  @ApiProperty({ example: 'mobile-app-1' })
  @IsString()
  client_id!: string;

  @ApiProperty({ type: [SyncChangeDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => SyncChangeDto)
  changes!: SyncChangeDto[];
}
