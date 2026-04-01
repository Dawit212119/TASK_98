import { IsOptional, IsString, Length, MaxLength, MinLength } from 'class-validator';

export class CreateIdentityDocumentDto {
  @IsString()
  @MinLength(2)
  @MaxLength(50)
  document_type!: string;

  @IsString()
  @MinLength(4)
  @MaxLength(128)
  document_number!: string;

  @IsOptional()
  @IsString()
  @Length(2, 2)
  country?: string;
}
