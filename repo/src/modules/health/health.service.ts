import { Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { buildPrivilegedAuditPayload } from '../audit/privileged-audit.builder';

@Injectable()
export class HealthService {
  constructor(private readonly auditService: AuditService) {}

  getHealth(): { status: string; timestamp: string } {
    return {
      status: 'ok',
      timestamp: new Date().toISOString()
    };
  }

  async auditDebugAccess(actorId: string): Promise<void> {
    await this.auditService.appendLog(
      buildPrivilegedAuditPayload({
        action: 'debug.health.error_sample',
        actorId,
        entityType: 'debug_health',
        entityId: null,
        accessBasis: 'permission_based',
        filters: {},
        outcome: 'success'
      })
    );
  }
}
