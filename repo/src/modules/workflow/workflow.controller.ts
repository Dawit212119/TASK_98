import { Body, Controller, HttpCode, HttpStatus, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiForbiddenResponse, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Idempotent } from '../../common/decorators/idempotent.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { AuthenticatedUser } from '../../common/types/request-with-context';
import { ApproveWorkflowRequestDto, RejectWorkflowRequestDto } from './dto/workflow-action.dto';
import { CreateWorkflowDefinitionDto } from './dto/create-workflow-definition.dto';
import { CreateWorkflowRequestDto } from './dto/create-workflow-request.dto';
import { WorkflowService } from './workflow.service';

@Controller('workflows')
@UseGuards(JwtAuthGuard)
@ApiTags('Workflow')
@ApiBearerAuth('bearer')
@ApiUnauthorizedResponse({ description: 'Missing or invalid JWT token' })
@ApiForbiddenResponse({ description: 'Insufficient role for workflow action' })
export class WorkflowController {
  constructor(private readonly workflowService: WorkflowService) {}

  @Post('definitions')
  @Idempotent()
  @HttpCode(HttpStatus.CREATED)
  createDefinition(
    @CurrentUser() user: AuthenticatedUser,
    @Body() payload: CreateWorkflowDefinitionDto
  ): Promise<Record<string, unknown>> {
    return this.workflowService.createDefinition(user.userId, payload);
  }

  @Post('requests')
  @Idempotent()
  @HttpCode(HttpStatus.CREATED)
  submitRequest(
    @CurrentUser() user: AuthenticatedUser,
    @Body() payload: CreateWorkflowRequestDto
  ): Promise<Record<string, unknown>> {
    return this.workflowService.submitRequest(user.userId, payload);
  }

  @Post('requests/:request_id/approve')
  @Idempotent()
  @HttpCode(HttpStatus.OK)
  approveRequest(
    @CurrentUser() user: AuthenticatedUser,
    @Param('request_id') requestId: string,
    @Body() payload: ApproveWorkflowRequestDto
  ): Promise<Record<string, unknown>> {
    return this.workflowService.approveRequest(user.userId, requestId, payload);
  }

  @Post('requests/:request_id/reject')
  @Idempotent()
  @HttpCode(HttpStatus.OK)
  rejectRequest(
    @CurrentUser() user: AuthenticatedUser,
    @Param('request_id') requestId: string,
    @Body() payload: RejectWorkflowRequestDto
  ): Promise<Record<string, unknown>> {
    return this.workflowService.rejectRequest(user.userId, requestId, payload);
  }
}
