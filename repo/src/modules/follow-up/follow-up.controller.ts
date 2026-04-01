import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiForbiddenResponse, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Idempotent } from '../../common/decorators/idempotent.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { AuthenticatedUser } from '../../common/types/request-with-context';
import { AdherenceQueryDto } from './dto/adherence-query.dto';
import { CreatePlanDto } from './dto/create-plan.dto';
import { CreatePlanTemplateDto } from './dto/create-plan-template.dto';
import { IngestTagsDto } from './dto/ingest-tags.dto';
import { RecordTaskOutcomeDto } from './dto/record-task-outcome.dto';
import { FollowUpService } from './follow-up.service';

@Controller('follow-up')
@UseGuards(JwtAuthGuard)
@ApiTags('Follow-up')
@ApiBearerAuth('bearer')
@ApiUnauthorizedResponse({ description: 'Missing or invalid JWT token' })
@ApiForbiddenResponse({ description: 'Insufficient role or out-of-scope follow-up data' })
export class FollowUpController {
  constructor(private readonly followUpService: FollowUpService) {}

  @Post('tags/ingest')
  @Idempotent()
  @HttpCode(HttpStatus.CREATED)
  ingestTags(@CurrentUser() user: AuthenticatedUser, @Body() payload: IngestTagsDto): Promise<Record<string, unknown>> {
    return this.followUpService.ingestTags(user.userId, payload);
  }

  @Post('plan-templates')
  @Idempotent()
  @HttpCode(HttpStatus.CREATED)
  createPlanTemplate(
    @CurrentUser() user: AuthenticatedUser,
    @Body() payload: CreatePlanTemplateDto
  ): Promise<Record<string, unknown>> {
    return this.followUpService.createPlanTemplate(user.userId, payload);
  }

  @Post('plans')
  @Idempotent()
  @HttpCode(HttpStatus.CREATED)
  createPlan(@CurrentUser() user: AuthenticatedUser, @Body() payload: CreatePlanDto): Promise<Record<string, unknown>> {
    return this.followUpService.createPlan(user.userId, payload);
  }

  @Get('plans/:plan_id')
  @HttpCode(HttpStatus.OK)
  getPlan(@CurrentUser() user: AuthenticatedUser, @Param('plan_id') planId: string): Promise<Record<string, unknown>> {
    return this.followUpService.getPlanById(user.userId, planId);
  }

  @Post('tasks/:task_id/outcomes')
  @Idempotent()
  @HttpCode(HttpStatus.CREATED)
  recordTaskOutcome(
    @CurrentUser() user: AuthenticatedUser,
    @Param('task_id') taskId: string,
    @Body() payload: RecordTaskOutcomeDto
  ): Promise<Record<string, unknown>> {
    return this.followUpService.recordTaskOutcome(user.userId, taskId, payload);
  }

  @Get('adherence')
  @HttpCode(HttpStatus.OK)
  getAdherence(@CurrentUser() user: AuthenticatedUser, @Query() query: AdherenceQueryDto): Promise<Record<string, unknown>> {
    return this.followUpService.getAdherenceMetrics(user.userId, query);
  }
}
