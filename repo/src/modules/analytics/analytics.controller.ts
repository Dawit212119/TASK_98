import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiForbiddenResponse, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { Response } from 'express';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Idempotent } from '../../common/decorators/idempotent.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { AuthenticatedUser } from '../../common/types/request-with-context';
import { AnalyticsService } from './analytics.service';
import { CreateCsvExportDto } from './dto/create-csv-export.dto';
import { CreateExperimentDto } from './dto/create-experiment.dto';
import { FunnelQueryDto } from './dto/funnel-query.dto';
import { IngestEventDto } from './dto/ingest-event.dto';
import { RetentionQueryDto } from './dto/retention-query.dto';

@Controller('analytics')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@ApiTags('Analytics')
@ApiBearerAuth('bearer')
@ApiUnauthorizedResponse({ description: 'Missing or invalid JWT token' })
@ApiForbiddenResponse({ description: 'Insufficient permissions' })
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @Post('events')
  @RequirePermissions('analytics.api.use')
  @Idempotent()
  @HttpCode(HttpStatus.CREATED)
  ingestEvent(@CurrentUser() user: AuthenticatedUser, @Body() payload: IngestEventDto): Promise<Record<string, unknown>> {
    return this.analyticsService.ingestEvent(user.userId, payload);
  }

  @Get('aggregations/funnel')
  @RequirePermissions('analytics.api.use')
  @HttpCode(HttpStatus.OK)
  getFunnel(@CurrentUser() user: AuthenticatedUser, @Query() query: FunnelQueryDto): Promise<Record<string, unknown>> {
    return this.analyticsService.getFunnelAggregation(user.userId, query);
  }

  @Get('aggregations/retention')
  @RequirePermissions('analytics.api.use')
  @HttpCode(HttpStatus.OK)
  getRetention(@CurrentUser() user: AuthenticatedUser, @Query() query: RetentionQueryDto): Promise<Record<string, unknown>> {
    return this.analyticsService.getRetentionAggregation(user.userId, query);
  }

  @Get('aggregations/content-quality')
  @RequirePermissions('analytics.api.use')
  @HttpCode(HttpStatus.OK)
  getContentQuality(@CurrentUser() user: AuthenticatedUser, @Query() query: FunnelQueryDto): Promise<Record<string, unknown>> {
    return this.analyticsService.getContentQualityAggregation(user.userId, query);
  }

  @Post('experiments')
  @RequirePermissions('analytics.api.use')
  @Idempotent()
  @HttpCode(HttpStatus.CREATED)
  createExperiment(
    @CurrentUser() user: AuthenticatedUser,
    @Body() payload: CreateExperimentDto
  ): Promise<Record<string, unknown>> {
    return this.analyticsService.createExperiment(user.userId, payload);
  }

  @Get('experiments/:experiment_id/assignment/:user_id')
  @RequirePermissions('analytics.api.use')
  @HttpCode(HttpStatus.OK)
  getAssignment(
    @CurrentUser() user: AuthenticatedUser,
    @Param('experiment_id') experimentId: string,
    @Param('user_id') targetUserId: string
  ): Promise<Record<string, unknown>> {
    return this.analyticsService.getDeterministicAssignment(user.userId, experimentId, targetUserId);
  }

  @Post('exports/csv')
  @RequirePermissions('analytics.api.use')
  @Idempotent()
  @HttpCode(HttpStatus.ACCEPTED)
  createCsvExport(
    @CurrentUser() user: AuthenticatedUser,
    @Body() payload: CreateCsvExportDto
  ): Promise<Record<string, unknown>> {
    return this.analyticsService.createCsvExport(user.userId, payload);
  }

  @Get('exports/:export_id/download')
  @RequirePermissions('analytics.api.use')
  @HttpCode(HttpStatus.OK)
  async downloadExport(
    @CurrentUser() user: AuthenticatedUser,
    @Param('export_id') exportId: string,
    @Res() res: Response
  ): Promise<void> {
    const prepared = await this.analyticsService.prepareExportDownload(user.userId, exportId);
    res.setHeader('Content-Type', prepared.mimeType);
    res.setHeader('Content-Disposition', `attachment; filename="${prepared.filename}"`);
    prepared.stream.pipe(res);
  }

  @Get('exports/:export_id')
  @RequirePermissions('analytics.api.use')
  @HttpCode(HttpStatus.OK)
  getCsvExport(
    @CurrentUser() user: AuthenticatedUser,
    @Param('export_id') exportId: string
  ): Promise<Record<string, unknown>> {
    return this.analyticsService.getCsvExport(user.userId, exportId);
  }
}
