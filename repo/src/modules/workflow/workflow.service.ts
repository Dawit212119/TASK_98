import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, IsNull, Repository } from 'typeorm';
import { AppException } from '../../common/exceptions/app.exception';
import { AccessControlService } from '../access-control/access-control.service';
import { AccessBasis, buildPrivilegedAuditPayload } from '../audit/privileged-audit.builder';
import { AuditService } from '../audit/audit.service';
import { ApproveWorkflowRequestDto, RejectWorkflowRequestDto } from './dto/workflow-action.dto';
import { CreateWorkflowDefinitionDto } from './dto/create-workflow-definition.dto';
import { CreateWorkflowRequestDto } from './dto/create-workflow-request.dto';
import { WorkflowApprovalEntity } from './entities/workflow-approval.entity';
import { WorkflowApprovalMode, WorkflowDefinitionEntity } from './entities/workflow-definition.entity';
import { WorkflowRequestEntity, WorkflowRequestStatus } from './entities/workflow-request.entity';
import { WorkflowStepEntity } from './entities/workflow-step.entity';
import { isAllRequiredStepSatisfied, isAnyOneStepSatisfied } from './workflow-approval.util';
import { WorkflowBusinessTimeService } from './workflow-business-time.service';
import { isWorkflowDeadlinePassed } from './workflow-sla-expiry.util';

@Injectable()
export class WorkflowService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly accessControlService: AccessControlService,
    private readonly workflowBusinessTimeService: WorkflowBusinessTimeService,
    private readonly auditService: AuditService,
    @InjectRepository(WorkflowDefinitionEntity)
    private readonly definitionRepository: Repository<WorkflowDefinitionEntity>,
    @InjectRepository(WorkflowStepEntity)
    private readonly stepRepository: Repository<WorkflowStepEntity>,
    @InjectRepository(WorkflowRequestEntity)
    private readonly requestRepository: Repository<WorkflowRequestEntity>,
    @InjectRepository(WorkflowApprovalEntity)
    private readonly approvalRepository: Repository<WorkflowApprovalEntity>
  ) {}

  async createDefinition(userId: string, payload: CreateWorkflowDefinitionDto): Promise<Record<string, unknown>> {
    await this.requireOpsAdmin(userId);

    const sortedSteps = [...payload.steps].sort((a, b) => a.order - b.order || a.approver_role.localeCompare(b.approver_role));
    if (payload.approval_mode === WorkflowApprovalMode.ANY_ONE) {
      for (let i = 1; i < sortedSteps.length; i += 1) {
        if (sortedSteps[i].order === sortedSteps[i - 1].order) {
          throw new AppException(
            'WORKFLOW_DUPLICATE_STEP_ORDER',
            'Duplicate step order is not allowed for ANY_ONE workflows',
            {},
            422
          );
        }
      }
    }

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const definition = await queryRunner.manager.save(
        WorkflowDefinitionEntity,
        this.definitionRepository.create({
          name: payload.name,
          approvalMode: payload.approval_mode,
          slaHours: payload.sla_hours ?? 48,
          active: true,
          createdBy: userId
        })
      );

      const steps = sortedSteps.map((step) =>
        this.stepRepository.create({
          workflowDefinitionId: definition.id,
          order: step.order,
          approverRole: step.approver_role,
          conditions: step.conditions ?? {}
        })
      );
      const savedSteps = await queryRunner.manager.save(WorkflowStepEntity, steps);

      await queryRunner.commitTransaction();

      await this.auditService.appendLog(
        buildPrivilegedAuditPayload(
          {
            entityType: 'workflow_definition',
            entityId: definition.id,
            action: 'workflow.definition.create',
            actorId: userId,
            accessBasis: 'ops_admin',
            filters: {},
            outcome: 'success'
          },
          {
            approval_mode: definition.approvalMode,
            sla_hours: definition.slaHours,
            steps: savedSteps.length
          }
        )
      );

      return {
        workflow_definition_id: definition.id,
        name: definition.name,
        approval_mode: definition.approvalMode,
        sla_hours: definition.slaHours,
        steps: savedSteps
          .sort((a, b) => a.order - b.order)
          .map((step) => ({
            step_id: step.id,
            order: step.order,
            approver_role: step.approverRole,
            conditions: step.conditions
          })),
        version: definition.version
      };
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  async submitRequest(userId: string, payload: CreateWorkflowRequestDto): Promise<Record<string, unknown>> {
    const roles = await this.accessControlService.getUserRoleNames(userId);
    if (!roles.some((role) => ['staff', 'provider', 'ops_admin'].includes(role))) {
      throw new AppException('FORBIDDEN', 'Insufficient permissions', {}, 403);
    }

    const definition = await this.definitionRepository.findOne({
      where: { id: payload.workflow_definition_id, active: true, deletedAt: IsNull() }
    });
    if (!definition) {
      throw new AppException('WORKFLOW_DEFINITION_NOT_FOUND', 'Workflow definition not found', {}, 404);
    }

    const steps = await this.stepRepository.find({
      where: { workflowDefinitionId: definition.id, deletedAt: IsNull() },
      order: { order: 'ASC' }
    });
    if (steps.length === 0) {
      throw new AppException('WORKFLOW_NO_STEPS', 'Workflow definition has no steps', {}, 422);
    }

    const matchingSteps = steps.filter((step) => this.matchesConditions(step.conditions, payload.payload));
    if (matchingSteps.length === 0) {
      throw new AppException('WORKFLOW_NO_MATCHING_STEP', 'No workflow step matches provided payload', {}, 422);
    }

    const minOrder = Math.min(...matchingSteps.map((s) => s.order));

    const request = await this.requestRepository.save(
      this.requestRepository.create({
        workflowDefinitionId: definition.id,
        resourceType: payload.resource_type,
        resourceRef: payload.resource_ref,
        payload: payload.payload,
        status: WorkflowRequestStatus.PENDING,
        currentStepOrder: minOrder,
        requestedBy: userId,
        deadlineAt: this.workflowBusinessTimeService.calculateDeadlineAt(new Date(), definition.slaHours)
      })
    );

    const submitAccessBasis: AccessBasis = roles.includes('ops_admin')
      ? 'ops_admin'
      : roles.includes('staff')
        ? 'staff'
        : 'provider';

    await this.auditService.appendLog(
      buildPrivilegedAuditPayload(
        {
          entityType: 'workflow_request',
          entityId: request.id,
          action: 'workflow.request.create',
          actorId: userId,
          accessBasis: submitAccessBasis,
          filters: {
            workflow_definition_id: request.workflowDefinitionId,
            resource_type: request.resourceType
          },
          outcome: 'success'
        },
        {
          resource_ref: request.resourceRef,
          current_step_order: request.currentStepOrder
        }
      )
    );

    return this.mapRequest(request, definition.approvalMode);
  }

  async approveRequest(userId: string, requestId: string, payload: ApproveWorkflowRequestDto): Promise<Record<string, unknown>> {
    const request = await this.getPendingRequestOrThrow(requestId);
    const definition = await this.getDefinitionOrThrow(request.workflowDefinitionId);
    const currentSteps = await this.getStepGroupAtOrder(definition.id, request.currentStepOrder, request.payload);
    if (currentSteps.length === 0) {
      throw new AppException('WORKFLOW_STEP_NOT_FOUND', 'Current workflow step group not found', {}, 422);
    }

    const roles = (await this.accessControlService.getUserRoleNames(userId)).map((r) => r.toLowerCase());
    const canApprove = roles.includes('ops_admin') || currentSteps.some((s) => roles.includes(s.approverRole));
    if (!canApprove) {
      throw new AppException('FORBIDDEN', 'Current approver role is required', {}, 403);
    }

    const alreadyApproved = await this.approvalRepository.findOne({
      where: {
        workflowRequestId: request.id,
        stepOrder: request.currentStepOrder,
        approverUserId: userId,
        action: 'APPROVE',
        deletedAt: IsNull()
      }
    });
    if (alreadyApproved) {
      const reloaded = await this.requestRepository.findOne({ where: { id: request.id, deletedAt: IsNull() } });
      return this.mapRequest(reloaded ?? request, definition.approvalMode);
    }

    const qr = this.dataSource.createQueryRunner();
    await qr.connect();
    await qr.startTransaction();
    try {
      const locked = await qr.manager.findOne(WorkflowRequestEntity, {
        where: { id: requestId, deletedAt: IsNull() },
        lock: { mode: 'pessimistic_write' }
      });
      if (!locked || locked.status !== WorkflowRequestStatus.PENDING) {
        await qr.commitTransaction();
        return this.mapRequest(request, definition.approvalMode);
      }

      await qr.manager.save(WorkflowApprovalEntity, this.approvalRepository.create({
        workflowRequestId: locked.id,
        stepOrder: locked.currentStepOrder,
        approverUserId: userId,
        action: 'APPROVE',
        comment: payload.comment ?? null
      }));

      const stepApproved = await this.evaluateStepGroupComplete(
        locked.id,
        locked.currentStepOrder,
        currentSteps,
        definition.approvalMode,
        qr.manager
      );
      if (stepApproved) {
        const nextOrder = await this.getNextDistinctStepOrder(definition.id, locked.currentStepOrder, locked.payload);
        if (nextOrder !== null) {
          locked.currentStepOrder = nextOrder;
        } else {
          locked.status = WorkflowRequestStatus.APPROVED;
        }
        locked.version += 1;
        await qr.manager.save(WorkflowRequestEntity, locked);
      }

      await qr.commitTransaction();
      Object.assign(request, locked);
    } catch (err) {
      await qr.rollbackTransaction();
      throw err;
    } finally {
      await qr.release();
    }

    const approveAccessBasis = this.workflowActionAccessBasis(roles);

    await this.auditService.appendLog(
      buildPrivilegedAuditPayload(
        {
          entityType: 'workflow_request',
          entityId: request.id,
          action: 'workflow.request.approve',
          actorId: userId,
          accessBasis: approveAccessBasis,
          filters: {
            request_id: request.id,
            workflow_definition_id: request.workflowDefinitionId,
            current_step_order: request.currentStepOrder,
            request_status: request.status
          },
          outcome: 'success'
        },
        {
          step_order: request.currentStepOrder,
          status: request.status
        }
      )
    );

    return this.mapRequest(request, definition.approvalMode);
  }

  async rejectRequest(userId: string, requestId: string, payload: RejectWorkflowRequestDto): Promise<Record<string, unknown>> {
    const request = await this.getPendingRequestOrThrow(requestId);
    const definition = await this.getDefinitionOrThrow(request.workflowDefinitionId);
    const currentSteps = await this.getStepGroupAtOrder(definition.id, request.currentStepOrder, request.payload);
    if (currentSteps.length === 0) {
      throw new AppException('WORKFLOW_STEP_NOT_FOUND', 'Current workflow step group not found', {}, 422);
    }

    const roles = (await this.accessControlService.getUserRoleNames(userId)).map((r) => r.toLowerCase());
    const canReject = roles.includes('ops_admin') || currentSteps.some((s) => roles.includes(s.approverRole));
    if (!canReject) {
      throw new AppException('FORBIDDEN', 'Current approver role is required', {}, 403);
    }

    const qr = this.dataSource.createQueryRunner();
    await qr.connect();
    await qr.startTransaction();
    try {
      const locked = await qr.manager.findOne(WorkflowRequestEntity, {
        where: { id: requestId, deletedAt: IsNull() },
        lock: { mode: 'pessimistic_write' }
      });
      if (!locked || locked.status !== WorkflowRequestStatus.PENDING) {
        await qr.commitTransaction();
        return this.mapRequest(request, definition.approvalMode);
      }

      await qr.manager.save(WorkflowApprovalEntity, this.approvalRepository.create({
        workflowRequestId: locked.id,
        stepOrder: locked.currentStepOrder,
        approverUserId: userId,
        action: 'REJECT',
        comment: payload.reason
      }));

      locked.status = WorkflowRequestStatus.REJECTED;
      locked.version += 1;
      await qr.manager.save(WorkflowRequestEntity, locked);

      await qr.commitTransaction();
      Object.assign(request, locked);
    } catch (err) {
      await qr.rollbackTransaction();
      throw err;
    } finally {
      await qr.release();
    }

    const rejectAccessBasis = this.workflowActionAccessBasis(roles);

    await this.auditService.appendLog(
      buildPrivilegedAuditPayload(
        {
          entityType: 'workflow_request',
          entityId: request.id,
          action: 'workflow.request.reject',
          actorId: userId,
          accessBasis: rejectAccessBasis,
          filters: {
            request_id: request.id,
            workflow_definition_id: request.workflowDefinitionId,
            current_step_order: request.currentStepOrder,
            request_status: request.status
          },
          outcome: 'success'
        },
        { reason: payload.reason }
      )
    );

    return this.mapRequest(request, definition.approvalMode);
  }

  private workflowActionAccessBasis(roles: string[]): AccessBasis {
    if (roles.includes('ops_admin')) {
      return 'ops_admin';
    }
    if (roles.includes('staff')) {
      return 'staff';
    }
    if (roles.includes('provider')) {
      return 'provider';
    }
    return 'permission_based';
  }

  private async requireOpsAdmin(userId: string): Promise<void> {
    const roles = await this.accessControlService.getUserRoleNames(userId);
    if (!roles.includes('ops_admin')) {
      throw new AppException('FORBIDDEN', 'Insufficient permissions', {}, 403);
    }
  }

  private matchesConditions(conditions: Record<string, unknown>, payload: Record<string, unknown>): boolean {
    const keys = Object.keys(conditions ?? {});
    if (keys.length === 0) {
      return true;
    }

    return keys.every((key) => payload[key] === conditions[key]);
  }

  private async getDefinitionOrThrow(definitionId: string): Promise<WorkflowDefinitionEntity> {
    const definition = await this.definitionRepository.findOne({ where: { id: definitionId, deletedAt: IsNull() } });
    if (!definition) {
      throw new AppException('WORKFLOW_DEFINITION_NOT_FOUND', 'Workflow definition not found', {}, 404);
    }
    return definition;
  }

  private async getPendingRequestOrThrow(requestId: string): Promise<WorkflowRequestEntity> {
    const request = await this.requestRepository.findOne({ where: { id: requestId, deletedAt: IsNull() } });
    if (!request) {
      throw new AppException('WORKFLOW_REQUEST_NOT_FOUND', 'Workflow request not found', {}, 404);
    }

    if (request.status !== WorkflowRequestStatus.PENDING) {
      throw new AppException('WORKFLOW_REQUEST_NOT_PENDING', 'Workflow request is not pending', {}, 422);
    }

    if (isWorkflowDeadlinePassed(request.deadlineAt)) {
      request.status = WorkflowRequestStatus.EXPIRED;
      request.version += 1;
      await this.requestRepository.save(request);
      throw new AppException('WORKFLOW_SLA_EXPIRED', 'Workflow request SLA has expired', {}, 422);
    }

    return request;
  }

  private async getStepGroupAtOrder(
    definitionId: string,
    stepOrder: number,
    payload: Record<string, unknown>
  ): Promise<WorkflowStepEntity[]> {
    const steps = await this.stepRepository.find({
      where: { workflowDefinitionId: definitionId, deletedAt: IsNull() },
      order: { order: 'ASC', id: 'ASC' }
    });

    return steps.filter((candidate) => candidate.order === stepOrder && this.matchesConditions(candidate.conditions, payload));
  }

  private async getNextDistinctStepOrder(
    definitionId: string,
    currentStepOrder: number,
    payload: Record<string, unknown>
  ): Promise<number | null> {
    const steps = await this.stepRepository.find({
      where: { workflowDefinitionId: definitionId, deletedAt: IsNull() },
      order: { order: 'ASC', id: 'ASC' }
    });

    const matching = steps.filter((step) => this.matchesConditions(step.conditions, payload));
    const distinctOrders = [...new Set(matching.map((s) => s.order))].sort((a, b) => a - b);
    const idx = distinctOrders.indexOf(currentStepOrder);
    if (idx === -1 || idx >= distinctOrders.length - 1) {
      return null;
    }
    return distinctOrders[idx + 1] ?? null;
  }

  private async evaluateStepGroupComplete(
    requestId: string,
    stepOrder: number,
    slots: WorkflowStepEntity[],
    mode: WorkflowApprovalMode,
    manager?: EntityManager
  ): Promise<boolean> {
    const repo = manager ? manager.getRepository(WorkflowApprovalEntity) : this.approvalRepository;
    const approvals = await repo.find({
      where: {
        workflowRequestId: requestId,
        stepOrder,
        action: 'APPROVE',
        deletedAt: IsNull()
      }
    });

    const rows = approvals.map((a) => ({ approverUserId: a.approverUserId }));
    const userIds = [...new Set(rows.map((r) => r.approverUserId))];
    const rolesByUserId: Record<string, string[]> = {};
    for (const uid of userIds) {
      rolesByUserId[uid] = (await this.accessControlService.getUserRoleNames(uid)).map((r) => r.toLowerCase());
    }

    const slotPayload = slots.map((s) => ({ id: s.id, approverRole: s.approverRole }));

    if (mode === WorkflowApprovalMode.ANY_ONE) {
      return isAnyOneStepSatisfied(slotPayload, rows, rolesByUserId);
    }

    return isAllRequiredStepSatisfied(slotPayload, rows, rolesByUserId);
  }

  private mapRequest(request: WorkflowRequestEntity, approvalMode: WorkflowApprovalMode): Record<string, unknown> {
    return {
      request_id: request.id,
      workflow_definition_id: request.workflowDefinitionId,
      resource_type: request.resourceType,
      resource_ref: request.resourceRef,
      payload: request.payload,
      status: request.status,
      approval_mode: approvalMode,
      current_step_order: request.currentStepOrder,
      deadline_at: request.deadlineAt.toISOString(),
      version: request.version,
      updated_at: request.updatedAt.toISOString()
    };
  }
}
