import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Query,
  UseGuards
} from '@nestjs/common';
import { ApiBearerAuth, ApiForbiddenResponse, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Idempotent } from '../../common/decorators/idempotent.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { AuthenticatedUser } from '../../common/types/request-with-context';
import { AuditIntegrityQueryDto, AuditLogQueryDto } from '../audit/dto/audit-log-query.dto';
import { AccessControlService } from './access-control.service';
import { CreateRoleDto } from './dto/create-role.dto';
import { ProvisionUserDto } from './dto/provision-user.dto';
import { ReplaceUserRolesDto } from './dto/replace-user-roles.dto';
import { ReplaceUserScopesDto } from './dto/replace-user-scopes.dto';

@Controller('access')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@ApiTags('Access Control')
@ApiBearerAuth('bearer')
@ApiUnauthorizedResponse({ description: 'Missing or invalid JWT token' })
@ApiForbiddenResponse({ description: 'Insufficient permissions' })
export class AccessControlController {
  constructor(private readonly accessControlService: AccessControlService) {}

  @Get('roles')
  @RequirePermissions('access.roles.read')
  @HttpCode(HttpStatus.OK)
  getRoles(
    @CurrentUser() user: AuthenticatedUser
  ): Promise<{ items: Array<{ id: string; name: string; description: string | null }> }> {
    return this.accessControlService.getRoles(user.userId);
  }

  @Post('roles')
  @RequirePermissions('access.roles.write')
  @Idempotent()
  @HttpCode(HttpStatus.CREATED)
  createRole(
    @CurrentUser() user: AuthenticatedUser,
    @Body() payload: CreateRoleDto
  ): Promise<{ id: string; name: string; description: string | null; permission_ids: string[] }> {
    return this.accessControlService.createRole(user.userId, payload);
  }

  @Post('provision-user')
  @RequirePermissions('access.user_roles.write')
  @Idempotent()
  @HttpCode(HttpStatus.CREATED)
  provisionUser(
    @CurrentUser() user: AuthenticatedUser,
    @Body() payload: ProvisionUserDto
  ): Promise<{ user_id: string; username: string; role: string }> {
    return this.accessControlService.provisionUser(user.userId, payload);
  }

  @Put('users/:user_id/roles')
  @RequirePermissions('access.user_roles.write')
  @Idempotent()
  @HttpCode(HttpStatus.OK)
  replaceUserRoles(
    @CurrentUser() user: AuthenticatedUser,
    @Param('user_id') userId: string,
    @Body() payload: ReplaceUserRolesDto
  ): Promise<{ user_id: string; role_ids: string[] }> {
    return this.accessControlService.replaceUserRoles(user.userId, userId, payload.role_ids);
  }

  @Get('scopes')
  @RequirePermissions('access.scopes.read')
  @HttpCode(HttpStatus.OK)
  listDataScopes(
    @CurrentUser() user: AuthenticatedUser
  ): Promise<{ items: Array<{ id: string; scope_type: string; scope_key: string; description: string | null }> }> {
    return this.accessControlService.listDataScopes(user.userId);
  }

  @Get('users/:user_id/scopes')
  @RequirePermissions('access.scopes.read')
  @HttpCode(HttpStatus.OK)
  getUserDataScopes(
    @CurrentUser() user: AuthenticatedUser,
    @Param('user_id') userId: string
  ): Promise<{ user_id: string; items: Array<{ id: string; scope_type: string; scope_key: string; description: string | null }> }> {
    return this.accessControlService.getUserDataScopes(user.userId, userId);
  }

  @Put('users/:user_id/scopes')
  @RequirePermissions('access.scopes.write')
  @Idempotent()
  @HttpCode(HttpStatus.OK)
  replaceUserDataScopes(
    @CurrentUser() user: AuthenticatedUser,
    @Param('user_id') userId: string,
    @Body() payload: ReplaceUserScopesDto
  ): Promise<{ user_id: string; scope_ids: string[] }> {
    return this.accessControlService.replaceUserDataScopes(user.userId, userId, payload.scope_ids);
  }

  /** Register before `audit-logs` so nested static path is not shadowed by routing order. */
  @Get('audit-logs/verify-integrity')
  @RequirePermissions('access.audit.read')
  @HttpCode(HttpStatus.OK)
  verifyAuditIntegrity(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: AuditIntegrityQueryDto
  ): Promise<{
    valid: boolean;
    first_invalid_record_id: string | null;
    checked_count: number;
    from: string | null;
    to: string | null;
  }> {
    return this.accessControlService.verifyAuditIntegrity(user.userId, query);
  }

  @Get('audit-logs')
  @RequirePermissions('access.audit.read')
  @HttpCode(HttpStatus.OK)
  getAuditLogs(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: AuditLogQueryDto
  ): Promise<{ items: unknown[]; page: number; page_size: number; total: number }> {
    return this.accessControlService.getAuditLogs(user.userId, query);
  }
}
