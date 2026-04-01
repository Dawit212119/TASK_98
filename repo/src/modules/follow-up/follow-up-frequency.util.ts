export type TaskRuleInput = {
  task_name: string;
  every_n_days?: number;
  every_n_months?: number;
  occurrences?: number;
};

export type FrequencyScheduleResult = {
  taskName: string;
  ruleType: 'days' | 'months';
  ruleValue: number;
  sequenceNo: number;
  dueAt: Date;
  nextDueAt: Date | null;
};

export const buildSchedules = (startDate: Date, rule: TaskRuleInput): FrequencyScheduleResult[] => {
  const occurrences = rule.occurrences ?? 3;
  const hasDays = typeof rule.every_n_days === 'number';
  const hasMonths = typeof rule.every_n_months === 'number';

  if (hasDays === hasMonths) {
    throw new Error('Task rule must define exactly one of every_n_days or every_n_months');
  }

  const schedules: FrequencyScheduleResult[] = [];
  const ruleType = hasDays ? 'days' : 'months';
  const ruleValue = hasDays ? (rule.every_n_days as number) : (rule.every_n_months as number);

  for (let i = 1; i <= occurrences; i += 1) {
    const dueAt = addInterval(startDate, ruleType, ruleValue, i);
    const nextDueAt = i < occurrences ? addInterval(startDate, ruleType, ruleValue, i + 1) : null;
    schedules.push({
      taskName: rule.task_name,
      ruleType,
      ruleValue,
      sequenceNo: i,
      dueAt,
      nextDueAt
    });
  }

  return schedules;
};

const addInterval = (base: Date, type: 'days' | 'months', value: number, multiplier: number): Date => {
  const next = new Date(base);
  if (type === 'days') {
    next.setUTCDate(next.getUTCDate() + value * multiplier);
    return next;
  }

  const dayOfMonth = next.getUTCDate();
  next.setUTCDate(1);
  next.setUTCMonth(next.getUTCMonth() + value * multiplier);
  const lastDay = new Date(Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 0)).getUTCDate();
  next.setUTCDate(Math.min(dayOfMonth, lastDay));
  return next;
};
