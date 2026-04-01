import { buildSchedules } from '../src/modules/follow-up/follow-up-frequency.util';

describe('buildSchedules', () => {
  it('builds day-based schedules with expected sequence and nextDueAt', () => {
    const start = new Date('2026-01-01T00:00:00.000Z');

    const schedules = buildSchedules(start, {
      task_name: 'hydration_check',
      every_n_days: 7,
      occurrences: 3
    });

    expect(schedules).toHaveLength(3);
    expect(schedules[0]).toMatchObject({
      taskName: 'hydration_check',
      ruleType: 'days',
      ruleValue: 7,
      sequenceNo: 1
    });
    expect(schedules[0].dueAt.toISOString()).toBe('2026-01-08T00:00:00.000Z');
    expect(schedules[0].nextDueAt?.toISOString()).toBe('2026-01-15T00:00:00.000Z');
    expect(schedules[2].nextDueAt).toBeNull();
  });

  it('handles month rollover at end-of-month boundaries', () => {
    const start = new Date('2026-01-31T00:00:00.000Z');

    const schedules = buildSchedules(start, {
      task_name: 'monthly_followup',
      every_n_months: 1,
      occurrences: 2
    });

    expect(schedules[0].dueAt.toISOString()).toBe('2026-02-28T00:00:00.000Z');
    expect(schedules[1].dueAt.toISOString()).toBe('2026-03-31T00:00:00.000Z');
  });

  it('throws when both frequencies are set', () => {
    const start = new Date('2026-01-01T00:00:00.000Z');

    expect(() =>
      buildSchedules(start, {
        task_name: 'invalid',
        every_n_days: 2,
        every_n_months: 1
      })
    ).toThrow('Task rule must define exactly one of every_n_days or every_n_months');
  });
});
