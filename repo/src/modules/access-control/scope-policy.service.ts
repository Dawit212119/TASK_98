import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository, SelectQueryBuilder } from 'typeorm';
import { AppException } from '../../common/exceptions/app.exception';
import { ReservationEntity } from '../reservation/entities/reservation.entity';
import { AccessControlService } from './access-control.service';
import { DataScopeEntity } from './entities/data-scope.entity';
import { ReservationDataScopeEntity } from './entities/reservation-data-scope.entity';
import { UserDataScopeEntity } from './entities/user-data-scope.entity';

const DEFAULT_CLINIC_SCOPE_KEY = 'default_clinic';

@Injectable()
export class ScopePolicyService {
  constructor(
    private readonly accessControlService: AccessControlService,
    @InjectRepository(DataScopeEntity)
    private readonly dataScopeRepository: Repository<DataScopeEntity>,
    @InjectRepository(UserDataScopeEntity)
    private readonly userDataScopeRepository: Repository<UserDataScopeEntity>,
    @InjectRepository(ReservationDataScopeEntity)
    private readonly reservationDataScopeRepository: Repository<ReservationDataScopeEntity>
  ) {}

  async getRoles(userId: string): Promise<string[]> {
    return (await this.accessControlService.getUserRoleNames(userId)).map((role) => role.toLowerCase());
  }

  async getUserScopeIds(userId: string): Promise<string[]> {
    const rows = await this.userDataScopeRepository.find({
      where: { userId, deletedAt: IsNull() },
      select: { scopeId: true }
    });
    return [...new Set(rows.map((row) => row.scopeId))];
  }

  async assignReservationDefaultScopeFromActor(actorUserId: string, reservationId: string, roles?: string[]): Promise<void> {
    const roleSet = roles ?? (await this.getRoles(actorUserId));
    if (!roleSet.includes('staff') && !roleSet.includes('merchant')) {
      return;
    }

    const scopeIds = await this.getUserScopeIds(actorUserId);
    if (scopeIds.length === 0) {
      throw new AppException(
        'RESERVATION_SCOPE_REQUIRED',
        'Staff or merchant must be mapped to at least one data scope',
        {},
        422
      );
    }

    const existing = await this.reservationDataScopeRepository.findOne({
      where: {
        reservationId,
        scopeId: scopeIds[0],
        deletedAt: IsNull()
      }
    });
    if (!existing) {
      await this.reservationDataScopeRepository.save(
        this.reservationDataScopeRepository.create({
          reservationId,
          scopeId: scopeIds[0]
        })
      );
    }
  }

  /**
   * Tags new reservations with the default clinic data scope so staff/merchant (and migration-era behavior) stay aligned.
   * Patient-created rows previously had no reservation_data_scopes until this hook.
   */
  async ensureDefaultClinicReservationScope(reservationId: string): Promise<void> {
    const scope = await this.dataScopeRepository.findOne({
      where: { scopeKey: DEFAULT_CLINIC_SCOPE_KEY, deletedAt: IsNull() }
    });
    if (!scope) {
      return;
    }

    const existing = await this.reservationDataScopeRepository.findOne({
      where: { reservationId, scopeId: scope.id, deletedAt: IsNull() }
    });
    if (existing) {
      return;
    }

    await this.reservationDataScopeRepository.save(
      this.reservationDataScopeRepository.create({
        reservationId,
        scopeId: scope.id
      })
    );
  }

  async assertReservationInScope(userId: string, reservation: ReservationEntity, roles?: string[]): Promise<void> {
    const roleSet = roles ?? (await this.getRoles(userId));
    if (await this.canAccessReservation(userId, reservation, roleSet)) {
      return;
    }

    throw new AppException('FORBIDDEN', 'Reservation is out of scope', { reservation_id: reservation.id }, 403);
  }

  async canAccessReservation(userId: string, reservation: ReservationEntity, roles?: string[]): Promise<boolean> {
    const roleSet = roles ?? (await this.getRoles(userId));

    if (roleSet.includes('ops_admin')) {
      return true;
    }

    const isPatientOwner = roleSet.includes('patient') && reservation.patientId === userId;
    const isAssignedProvider = roleSet.includes('provider') && reservation.providerId === userId;
    if (isPatientOwner || isAssignedProvider) {
      return true;
    }

    if (roleSet.includes('staff') || roleSet.includes('merchant')) {
      return this.hasScopedClinicAccess(userId, reservation.id);
    }

    return false;
  }

  async applyReservationScopeQuery(
    qb: SelectQueryBuilder<ReservationEntity>,
    userId: string,
    roles?: string[]
  ): Promise<void> {
    const roleSet = roles ?? (await this.getRoles(userId));

    if (roleSet.includes('ops_admin')) {
      return;
    }

    const hasPatient = roleSet.includes('patient');
    const hasProvider = roleSet.includes('provider');
    const hasStaff = roleSet.includes('staff');
    const hasMerchant = roleSet.includes('merchant');

    const conditions: string[] = [];
    if (hasPatient) {
      conditions.push('r.patient_id = :scopeUserId');
    }
    if (hasProvider) {
      conditions.push('r.provider_id = :scopeUserId');
    }
    if (hasStaff || hasMerchant) {
      const scopeIds = await this.getUserScopeIds(userId);
      if (scopeIds.length > 0) {
        conditions.push(
          'EXISTS (SELECT 1 FROM reservation_data_scopes rds WHERE rds.reservation_id = r.id AND rds.deleted_at IS NULL AND rds.scope_id IN (:...scopeIds))'
        );
        qb.setParameter('scopeIds', scopeIds);
      }
    }

    if (conditions.length === 0) {
      qb.andWhere('1 = 0');
      return;
    }

    qb.andWhere(`(${conditions.join(' OR ')})`, { scopeUserId: userId });
  }

  private async hasScopedClinicAccess(userId: string, reservationId: string): Promise<boolean> {
    const scopeIds = await this.getUserScopeIds(userId);
    if (scopeIds.length === 0) {
      return false;
    }

    const count = await this.reservationDataScopeRepository
      .createQueryBuilder('rds')
      .where('rds.reservation_id = :reservationId', { reservationId })
      .andWhere('rds.deleted_at IS NULL')
      .andWhere('rds.scope_id IN (:...scopeIds)', { scopeIds })
      .getCount();

    return count > 0;
  }
}
