import { Controller, Get, HttpStatus, UseGuards } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags, ApiUnprocessableEntityResponse, ApiBearerAuth, ApiForbiddenResponse } from '@nestjs/swagger';
import { AppException } from '../../common/exceptions/app.exception';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { HealthService } from './health.service';

@Controller('health')
@ApiTags('Health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get()
  @ApiOperation({ summary: 'Health check endpoint' })
  @ApiOkResponse({ description: 'Service health status' })
  getHealth(): { status: string; timestamp: string } {
    return this.healthService.getHealth();
  }

  @Get('error-sample')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('debug.health.view')
  @ApiOperation({
    summary: 'Error shape sample endpoint (admin/debug only)',
    description: 'Returns sample error structure for debugging. Requires admin/debug permission.'
  })
  @ApiBearerAuth()
  @ApiUnprocessableEntityResponse({ description: 'Sample AppException payload' })
  @ApiForbiddenResponse({ description: 'Insufficient permissions (requires debug.health.view)' })
  getErrorSample(): never {
    throw new AppException('SAMPLE_ERROR', 'Sample error for testing', { sample: true }, HttpStatus.UNPROCESSABLE_ENTITY);
  }
}
