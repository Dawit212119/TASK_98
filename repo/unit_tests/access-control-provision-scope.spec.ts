/**
 * Ops_admin provisioning must assign clinic scopes to staff/provider/merchant even when
 * the provisioner has no user_data_scopes rows (default_clinic fallback).
 */
import { DataSource } from 'typeorm';
import { AccessControlService } from '../src/modules/access-control/access-control.service';
import { DataScopeEntity } from '../src/modules/access-control/entities/data-scope.entity';
import { UserRoleEntity } from '../src/modules/access-control/entities/user-role.entity';

jest.mock('bcryptjs', () => ({
  hash: jest.fn(() => Promise.resolve('bcrypt-mock-hash'))
}));

describe('AccessControlService.provisionUser — ops_admin scope bypass', () => {
  const actorId = 'ops-actor-id';
  const payload = {
    username: 'new_staff_user',
    password: 'Password123!',
    role: 'staff' as const,
    security_question_id: 'q1',
    security_answer: 'blue'
  };

  function buildService(overrides?: {
    userDataScopeFindResult?: Array<{ scopeId: string }>;
    defaultScopeRow?: DataScopeEntity | null;
  }) {
    const userDataScopeFindResult = overrides?.userDataScopeFindResult ?? [];
    const defaultScopeRow =
      overrides && 'defaultScopeRow' in overrides
        ? overrides.defaultScopeRow
        : ({
            id: 'default-clinic-scope-id',
            scopeKey: 'default_clinic',
            scopeType: 'clinic',
            description: null,
            deletedAt: null
          } as DataScopeEntity);

    const userRepository = {
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn((x: object) => x)
    };

    const securityQuestionRepository = {
      findOne: jest.fn().mockResolvedValue({ id: 'q1', active: true, deletedAt: null })
    };

    const roleRepository = {
      findOne: jest.fn().mockResolvedValue({ id: 'role-staff-id', name: 'staff', deletedAt: null })
    };

    const userRoleRepository = {
      find: jest.fn().mockResolvedValue([{ role: { name: 'ops_admin', deletedAt: null } }]),
      create: jest.fn((x: object) => x),
      save: jest.fn(async (rows: unknown) => rows)
    };

    const userDataScopeRepository = {
      find: jest.fn().mockResolvedValue(userDataScopeFindResult),
      create: jest.fn((x: object) => x),
      delete: jest.fn(),
      save: jest.fn()
    };

    const securityAnswerRepository = {
      create: jest.fn((x: object) => x)
    };

    const userRoleRepoForManager = {
      create: jest.fn((x: object) => x),
      save: jest.fn(async (rows: unknown) => rows)
    };

    const dataScopeRepoForManager = {
      findOne: jest.fn().mockResolvedValue(defaultScopeRow)
    };

    const queryRunner = {
      connect: jest.fn(),
      startTransaction: jest.fn(),
      commitTransaction: jest.fn(),
      rollbackTransaction: jest.fn(),
      release: jest.fn(),
      manager: {
        save: jest
          .fn()
          .mockImplementationOnce(async (_E: unknown, row: { username: string }) => ({
            ...row,
            id: 'new-user-id'
          }))
          .mockImplementationOnce(async () => undefined)
          .mockImplementation(async (_E: unknown, rows: unknown) => rows),
        getRepository: jest.fn((Entity: unknown) => {
          if (Entity === UserRoleEntity) {
            return userRoleRepoForManager;
          }
          if (Entity === DataScopeEntity) {
            return dataScopeRepoForManager;
          }
          return {};
        })
      }
    };

    const dataSource = {
      createQueryRunner: jest.fn(() => queryRunner)
    } as unknown as DataSource;

    const auditService = { appendLog: jest.fn().mockResolvedValue({}) };

    const service = new AccessControlService(
      dataSource,
      auditService as any,
      roleRepository as any,
      { find: jest.fn() } as any,
      { save: jest.fn() } as any,
      userRoleRepository as any,
      userRepository as any,
      securityQuestionRepository as any,
      securityAnswerRepository as any,
      userDataScopeRepository as any,
      { find: jest.fn() } as any
    );

    return {
      service,
      auditService,
      userDataScopeRepository,
      dataScopeRepoForManager,
      queryRunner
    };
  }

  it('uses default_clinic scope when ops_admin has no assigned data scopes', async () => {
    const { service, userDataScopeRepository, dataScopeRepoForManager } = buildService({
      userDataScopeFindResult: []
    });

    const out = await service.provisionUser(actorId, payload as any);

    expect(out).toEqual({
      user_id: 'new-user-id',
      username: payload.username,
      role: 'staff'
    });
    expect(userDataScopeRepository.find).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ userId: actorId }) })
    );
    expect(dataScopeRepoForManager.findOne).toHaveBeenCalledWith({
      where: expect.objectContaining({ scopeKey: 'default_clinic' })
    });
  });

  it('throws ACCESS_DEFAULT_SCOPE_MISSING when default_clinic row is absent', async () => {
    const { service } = buildService({
      userDataScopeFindResult: [],
      defaultScopeRow: null
    });

    await expect(service.provisionUser(actorId, payload as any)).rejects.toMatchObject({
      code: 'ACCESS_DEFAULT_SCOPE_MISSING'
    });
  });

  it('does not load default_clinic when provisioner already has scopes to copy', async () => {
    const { service, dataScopeRepoForManager } = buildService({
      userDataScopeFindResult: [{ scopeId: 'scope-from-ops' }]
    });

    await service.provisionUser(actorId, payload as any);

    expect(dataScopeRepoForManager.findOne).not.toHaveBeenCalled();
  });
});
