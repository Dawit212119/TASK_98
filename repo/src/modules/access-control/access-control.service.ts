import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcryptjs';
import { DataSource, EntityManager, In, IsNull, Repository } from 'typeorm';
import { AppException } from '../../common/exceptions/app.exception';
import { SecurityAnswerEntity } from '../auth/entities/security-answer.entity';
import { SecurityQuestionEntity } from '../auth/entities/security-question.entity';
import { UserEntity } from '../auth/entities/user.entity';
import { AuditService } from '../audit/audit.service';
import { AuditIntegrityQueryDto, AuditLogQueryDto } from '../audit/dto/audit-log-query.dto';
import { ProvisionUserDto } from './dto/provision-user.dto';
import { RolePermissionEntity } from './entities/role-permission.entity';
import { UserDataScopeEntity } from './entities/user-data-scope.entity';
import { RoleEntity } from './entities/role.entity';
import { UserRoleEntity } from './entities/user-role.entity';
import { PermissionEntity } from './entities/permission.entity';

@Injectable()
export class AccessControlService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly auditService: AuditService,
    @InjectRepository(RoleEntity)
    private readonly roleRepository: Repository<RoleEntity>,
    @InjectRepository(PermissionEntity)
    private readonly permissionRepository: Repository<PermissionEntity>,
    @InjectRepository(RolePermissionEntity)
    private readonly rolePermissionRepository: Repository<RolePermissionEntity>,
    @InjectRepository(UserRoleEntity)
    private readonly userRoleRepository: Repository<UserRoleEntity>,
    @InjectRepository(UserEntity)
    private readonly userRepository: Repository<UserEntity>,
    @InjectRepository(SecurityQuestionEntity)
    private readonly securityQuestionRepository: Repository<SecurityQuestionEntity>,
    @InjectRepository(SecurityAnswerEntity)
    private readonly securityAnswerRepository: Repository<SecurityAnswerEntity>,
    @InjectRepository(UserDataScopeEntity)
    private readonly userDataScopeRepository: Repository<UserDataScopeEntity>
  ) {}

  findRoleByName(name: string): Promise<RoleEntity | null> {
    return this.roleRepository.findOne({ where: { name } });
  }

  async getRoles(actorId: string): Promise<{ items: Array<{ id: string; name: string; description: string | null }> }> {
    const roles = await this.roleRepository.find({
      where: { deletedAt: IsNull() },
      order: { name: 'ASC' }
    });

    const result = {
      items: roles.map((role) => ({
        id: role.id,
        name: role.name,
        description: role.description
      }))
    };

    await this.auditService.appendLog({
      entityType: 'access_control',
      entityId: null,
      action: 'access.roles.read',
      actorId,
      payload: {
        outcome: 'success',
        role_count: result.items.length
      }
    });

    return result;
  }

  async createRole(
    actorId: string,
    payload: { name: string; description?: string; permission_ids: string[] }
  ): Promise<{
    id: string;
    name: string;
    description: string | null;
    permission_ids: string[];
  }> {
    const existing = await this.roleRepository.findOne({ where: { name: payload.name } });
    if (existing) {
      throw new AppException('ACCESS_ROLE_EXISTS', 'Role already exists', {}, 409);
    }

    const permissions = await this.permissionRepository.find({
      where: { id: In(payload.permission_ids), deletedAt: IsNull() }
    });
    if (permissions.length !== payload.permission_ids.length) {
      throw new AppException('ACCESS_PERMISSION_NOT_FOUND', 'One or more permissions do not exist', {}, 422);
    }

    const role = await this.roleRepository.save(
      this.roleRepository.create({
        name: payload.name,
        description: payload.description ?? null
      })
    );

    await this.rolePermissionRepository.save(
      permissions.map((permission) =>
        this.rolePermissionRepository.create({
          roleId: role.id,
          permissionId: permission.id
        })
      )
    );

    await this.auditService.appendLog({
      actorId,
      action: 'access.role.create',
      entityType: 'role',
      entityId: role.id,
      payload: {
        role_name: role.name,
        permission_ids: payload.permission_ids
      }
    });

    return {
      id: role.id,
      name: role.name,
      description: role.description,
      permission_ids: payload.permission_ids
    };
  }

  async replaceUserRoles(
    actorId: string,
    userId: string,
    roleIds: string[]
  ): Promise<{ user_id: string; role_ids: string[] }> {
    const roles = await this.roleRepository.find({ where: { id: In(roleIds), deletedAt: IsNull() } });
    if (roles.length !== roleIds.length) {
      throw new AppException('ACCESS_ROLE_NOT_FOUND', 'One or more roles do not exist', {}, 422);
    }

    await this.userRoleRepository.delete({ userId });
    await this.assignRoleIdsToUser(userId, roleIds);

    await this.auditService.appendLog({
      actorId,
      action: 'access.user_roles.replace',
      entityType: 'user',
      entityId: userId,
      payload: {
        role_ids: roleIds
      }
    });

    return {
      user_id: userId,
      role_ids: roleIds
    };
  }

  async provisionUser(actorId: string, payload: ProvisionUserDto): Promise<{ user_id: string; username: string; role: string }> {
    const actorRoles = await this.getUserRoleNames(actorId);
    if (!actorRoles.includes('ops_admin')) {
      throw new AppException('FORBIDDEN', 'Only ops_admin can provision users', {}, 403);
    }

    const existing = await this.userRepository.findOne({ where: { username: payload.username } });
    if (existing) {
      throw new AppException('AUTH_USERNAME_TAKEN', 'Username is already registered', {}, 409);
    }

    const question = await this.securityQuestionRepository.findOne({
      where: { id: payload.security_question_id, active: true, deletedAt: IsNull() }
    });
    if (!question) {
      throw new AppException('AUTH_SECURITY_QUESTION_NOT_FOUND', 'Security question not found', {}, 404);
    }

    const allowedRoles = ['staff', 'provider', 'merchant', 'ops_admin', 'analytics_viewer'];
    if (!allowedRoles.includes(payload.role)) {
      throw new AppException('ACCESS_PROVISION_ROLE_NOT_ALLOWED', 'Requested role cannot be provisioned via this endpoint', {}, 422);
    }

    const role = await this.roleRepository.findOne({ where: { name: payload.role, deletedAt: IsNull() } });
    if (!role) {
      throw new AppException('AUTH_ROLE_NOT_FOUND', 'Requested role is not available', {}, 422);
    }

    const passwordHash = await bcrypt.hash(payload.password, 10);
    const answerHash = await bcrypt.hash(payload.security_answer.toLowerCase().trim(), 10);

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const user = await queryRunner.manager.save(
        UserEntity,
        this.userRepository.create({
          username: payload.username,
          passwordHash,
          status: 'ACTIVE'
        })
      );

      await queryRunner.manager.save(
        SecurityAnswerEntity,
        this.securityAnswerRepository.create({
          userId: user.id,
          questionId: payload.security_question_id,
          answerHash
        })
      );

      await this.assignRoleIdsToUser(user.id, [role.id], queryRunner.manager);

      if (['staff', 'provider', 'merchant'].includes(role.name)) {
        const actorScopeRows = await this.userDataScopeRepository.find({
          where: { userId: actorId, deletedAt: IsNull() },
          select: { scopeId: true }
        });
        const scopeIds = [...new Set(actorScopeRows.map((row) => row.scopeId))];

        if (scopeIds.length === 0) {
          throw new AppException('ACCESS_PROVISION_SCOPE_REQUIRED', 'Provisioner must have at least one data scope', {}, 422);
        }

        await queryRunner.manager.save(
          UserDataScopeEntity,
          scopeIds.map((scopeId) =>
            this.userDataScopeRepository.create({
              userId: user.id,
              scopeId
            })
          )
        );
      }

      await queryRunner.commitTransaction();

      await this.auditService.appendLog({
        actorId,
        action: 'access.user.provision',
        entityType: 'user',
        entityId: user.id,
        payload: {
          username: user.username,
          role: role.name
        }
      });

      return {
        user_id: user.id,
        username: user.username,
        role: role.name
      };
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  async assignRoleIdsToUser(userId: string, roleIds: string[], manager?: EntityManager): Promise<void> {
    const targetRepo = manager ? manager.getRepository(UserRoleEntity) : this.userRoleRepository;
    const rows = roleIds.map((roleId) =>
      targetRepo.create({
        userId,
        roleId
      })
    );

    await targetRepo.save(rows);
  }

  async getUserRoleNames(userId: string): Promise<string[]> {
    const rows = await this.userRoleRepository.find({
      where: { userId, deletedAt: IsNull() },
      relations: { role: true }
    });

    return rows
      .filter((ur) => ur.role && ur.role.deletedAt == null)
      .map((ur) => ur.role!.name);
  }

  async getUserPermissions(userId: string): Promise<string[]> {
    const rows = await this.userRoleRepository
      .createQueryBuilder('ur')
      .innerJoin(RolePermissionEntity, 'rp', 'rp.role_id = ur.role_id AND rp.deleted_at IS NULL')
      .innerJoin(PermissionEntity, 'p', 'p.id = rp.permission_id AND p.deleted_at IS NULL')
      .where('ur.user_id = :userId', { userId })
      .andWhere('ur.deleted_at IS NULL')
      .select(['p.code AS permission_code'])
      .distinct(true)
      .getRawMany<{ permission_code: string }>();

    return rows.map((row) => row.permission_code);
  }

  async getUsersByRole(roleName: string): Promise<string[]> {
    const rows = await this.userRoleRepository
      .createQueryBuilder('ur')
      .innerJoin(RoleEntity, 'r', 'r.id = ur.role_id')
      .where('r.name = :roleName', { roleName })
      .andWhere('ur.deleted_at IS NULL')
      .andWhere('r.deleted_at IS NULL')
      .select(['ur.user_id AS user_id'])
      .getRawMany<{ user_id: string }>();

    return rows.map((row) => row.user_id);
  }

  async getUserDataScopeIds(userId: string): Promise<string[]> {
    const rows = await this.userDataScopeRepository.find({ where: { userId, deletedAt: IsNull() }, select: { scopeId: true } });
    return [...new Set(rows.map((row) => row.scopeId))];
  }

  async getAuditLogs(
    actorId: string,
    query: AuditLogQueryDto
  ): Promise<{
    items: unknown[];
    page: number;
    page_size: number;
    total: number;
  }> {
    const result = await this.auditService.getLogs(query);

    await this.auditService.appendLog({
      entityType: 'access_control',
      entityId: null,
      action: 'access.audit_logs.read',
      actorId,
      payload: {
        outcome: 'success',
        page: query.page,
        page_size: query.page_size,
        filter_entity_type: query.entity_type ?? null,
        filter_actor_id: query.actor_id ?? null,
        filter_from: query.from ?? null,
        filter_to: query.to ?? null,
        result_total: result.total
      }
    });

    return result;
  }

  async verifyAuditIntegrity(
    actorId: string,
    query: AuditIntegrityQueryDto
  ): Promise<{
    valid: boolean;
    first_invalid_record_id: string | null;
    checked_count: number;
    from: string | null;
    to: string | null;
  }> {
    const result = await this.auditService.verifyIntegrity(query);

    await this.auditService.appendLog({
      entityType: 'access_control',
      entityId: null,
      action: 'access.audit_integrity.verify',
      actorId,
      payload: {
        outcome: result.valid ? 'valid' : 'invalid',
        checked_count: result.checked_count,
        first_invalid_record_id: result.first_invalid_record_id,
        filter_from: query.from ?? null,
        filter_to: query.to ?? null,
        filter_limit: query.limit ?? null
      }
    });

    return result;
  }
}
