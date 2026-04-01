/**
 * Acceptance: workflow SLA business hours, weekends, holidays, clock-hour fallback.
 */
import { ConfigService } from '@nestjs/config';
import { WorkflowBusinessTimeService } from '../src/modules/workflow/workflow-business-time.service';

describe('WorkflowBusinessTimeService', () => {
  const createService = (overrides?: Record<string, string | number>) => {
    const config: Record<string, string | number> = {
      BUSINESS_TZ: 'UTC',
      BUSINESS_DAY_START_HOUR: 9,
      BUSINESS_DAY_END_HOUR: 17,
      BUSINESS_WORK_DAYS: '1,2,3,4,5',
      ...(overrides ?? {})
    };

    const configService = {
      get: jest.fn((key: string) => config[key])
    } as unknown as ConfigService;

    return new WorkflowBusinessTimeService(configService);
  };

  it('adds SLA within current workday when start is during work hours', () => {
    const service = createService();
    const start = new Date('2026-04-07T10:00:00.000Z');

    const deadline = service.calculateDeadlineAt(start, 2);

    expect(deadline.toISOString()).toBe('2026-04-07T12:00:00.000Z');
  });

  it('moves to next business day when start is after work hours', () => {
    const service = createService();
    const start = new Date('2026-04-07T18:30:00.000Z');

    const deadline = service.calculateDeadlineAt(start, 2);

    expect(deadline.toISOString()).toBe('2026-04-08T11:00:00.000Z');
  });

  it('skips weekend while accumulating business hours', () => {
    const service = createService();
    const start = new Date('2026-04-10T16:00:00.000Z');

    const deadline = service.calculateDeadlineAt(start, 4);

    expect(deadline.toISOString()).toBe('2026-04-13T12:00:00.000Z');
  });

  it('treats start at end hour boundary as next business slot', () => {
    const service = createService();
    const start = new Date('2026-04-07T17:00:00.000Z');

    const deadline = service.calculateDeadlineAt(start, 1);

    expect(deadline.toISOString()).toBe('2026-04-08T10:00:00.000Z');
  });

  it('uses wall-clock hours when WORKFLOW_SLA_USE_CLOCK_HOURS is true', () => {
    const service = createService({ WORKFLOW_SLA_USE_CLOCK_HOURS: 'true' });
    const start = new Date('2026-04-07T10:00:00.000Z');

    const deadline = service.calculateDeadlineAt(start, 48);

    expect(deadline.toISOString()).toBe('2026-04-09T10:00:00.000Z');
  });

  it('skips configured BUSINESS_HOLIDAYS on otherwise working weekdays', () => {
    const service = createService({ BUSINESS_HOLIDAYS: '2026-04-07' });
    const start = new Date('2026-04-07T10:00:00.000Z');

    const deadline = service.calculateDeadlineAt(start, 2);

    expect(deadline.toISOString()).toBe('2026-04-08T11:00:00.000Z');
  });
});
