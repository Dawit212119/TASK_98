import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AccessControlService } from '../../modules/access-control/access-control.service';
import { PERMISSIONS_KEY } from '../decorators/permissions.decorator';
import { AppException } from '../exceptions/app.exception';
import { RequestWithContext } from '../types/request-with-context';

/**
 * Enforces `@RequirePermissions(...)` on routes that also use `JwtAuthGuard`.
 * Routes without metadata pass through; domain services should still enforce object-level rules
 * (reservation ownership, export `requested_by`, etc.).
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly accessControlService: AccessControlService
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredPermissions = this.reflector.getAllAndOverride<string[]>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass()
    ]);

    if (!requiredPermissions || requiredPermissions.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<RequestWithContext>();
    const userId = request.user?.userId;

    if (!userId) {
      throw new AppException('UNAUTHORIZED', 'Authentication required', {}, 401);
    }

    const userPermissions = await this.accessControlService.getUserPermissions(userId);
    const missingPermission = requiredPermissions.find((permission) => !userPermissions.includes(permission));

    if (missingPermission) {
      throw new AppException('FORBIDDEN', 'Insufficient permissions', { missing_permission: missingPermission }, 403);
    }

    return true;
  }
}
