import { IsIn, IsOptional, IsUUID } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

export class SupportTicketListQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: ['OPEN', 'ESCALATED', 'RESOLVED'] })
  @IsOptional()
  @IsIn(['OPEN', 'ESCALATED', 'RESOLVED'])
  status?: 'OPEN' | 'ESCALATED' | 'RESOLVED';

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  reservation_id?: string;
}
