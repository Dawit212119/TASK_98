import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { SecurityAnswerEntity } from '../auth/entities/security-answer.entity';
import { SecurityQuestionEntity } from '../auth/entities/security-question.entity';
import { UserEntity } from '../auth/entities/user.entity';
import { AuditModule } from '../audit/audit.module';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { AccessControlController } from './access-control.controller';
import { AccessControlService } from './access-control.service';
import { ScopePolicyService } from './scope-policy.service';
import { DataScopeEntity } from './entities/data-scope.entity';
import { PermissionEntity } from './entities/permission.entity';
import { ReservationDataScopeEntity } from './entities/reservation-data-scope.entity';
import { RolePermissionEntity } from './entities/role-permission.entity';
import { RoleEntity } from './entities/role.entity';
import { UserDataScopeEntity } from './entities/user-data-scope.entity';
import { UserRoleEntity } from './entities/user-role.entity';
@Module({
  imports: [
    TypeOrmModule.forFeature([
      RoleEntity,
      PermissionEntity,
      RolePermissionEntity,
      UserRoleEntity,
      UserEntity,
      SecurityQuestionEntity,
      SecurityAnswerEntity,
      DataScopeEntity,
      UserDataScopeEntity,
      ReservationDataScopeEntity
    ]),
    AuditModule,
    forwardRef(() => AuthModule)
  ],
  controllers: [AccessControlController],
  providers: [AccessControlService, ScopePolicyService, PermissionsGuard],
  exports: [AccessControlService, ScopePolicyService, PermissionsGuard]
})
export class AccessControlModule {}
