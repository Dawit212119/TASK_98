import { Body, Controller, Get, HttpCode, HttpStatus, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiForbiddenResponse, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Idempotent } from '../../common/decorators/idempotent.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { AuthenticatedUser } from '../../common/types/request-with-context';
import { SyncPullQueryDto } from './dto/sync-pull-query.dto';
import { SyncPushDto } from './dto/sync-push.dto';
import { SyncService } from './sync.service';

@Controller('sync')
@UseGuards(JwtAuthGuard)
@ApiTags('Sync')
@ApiBearerAuth('bearer')
@ApiUnauthorizedResponse({ description: 'Missing or invalid JWT token' })
@ApiForbiddenResponse({ description: 'Insufficient role or out-of-scope entity' })
export class SyncController {
  constructor(private readonly syncService: SyncService) {}

  @Post('push')
  @Idempotent()
  @HttpCode(HttpStatus.OK)
  pushChanges(@CurrentUser() user: AuthenticatedUser, @Body() payload: SyncPushDto): Promise<Record<string, unknown>> {
    return this.syncService.pushChanges(user.userId, payload);
  }

  @Get('pull')
  @HttpCode(HttpStatus.OK)
  pullChanges(@CurrentUser() user: AuthenticatedUser, @Query() query: SyncPullQueryDto): Promise<Record<string, unknown>> {
    return this.syncService.pullChanges(user.userId, query);
  }
}
