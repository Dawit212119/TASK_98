import { IsString, MaxLength, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class SendMessageDto {
  @ApiProperty({ example: 'Hello, I am on my way.' })
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  content!: string;
}
