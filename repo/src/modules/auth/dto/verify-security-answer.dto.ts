import { IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class VerifySecurityAnswerDto {
  @ApiProperty({ example: 'demo_patient' })
  @IsString()
  @MinLength(3)
  @MaxLength(100)
  username!: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  security_question_id!: string;

  @ApiProperty({ example: 'blue' })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  security_answer!: string;
}
