import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

type LocalDateParts = {
  year: number;
  month: number;
  day: number;
};

type BusinessTimeConfig = {
  timeZone: string;
  dayStartHour: number;
  dayEndHour: number;
  workDays: Set<number>;
  holidays: Set<string>;
};

@Injectable()
export class WorkflowBusinessTimeService {
  constructor(private readonly configService: ConfigService) {}

  calculateDeadlineAt(startAt: Date, businessHours: number): Date {
    if (this.shouldUseClockHourSla()) {
      return new Date(startAt.getTime() + Math.max(0, businessHours) * 60 * 60 * 1000);
    }

    const config = this.getConfig();
    let remainingMs = Math.max(0, businessHours * 60 * 60 * 1000);
    let cursor = new Date(startAt.getTime());

    while (remainingMs > 0) {
      const localParts = this.getLocalDateParts(cursor, config.timeZone);
      const workStart = this.makeDateInTimeZone(
        localParts.year,
        localParts.month,
        localParts.day,
        config.dayStartHour,
        0,
        0,
        config.timeZone
      );
      const workEnd = this.makeDateInTimeZone(
        localParts.year,
        localParts.month,
        localParts.day,
        config.dayEndHour,
        0,
        0,
        config.timeZone
      );

      if (!this.isBusinessDay(localParts, config)) {
        cursor = this.getNextBusinessDayStart(localParts, config);
        continue;
      }

      if (cursor.getTime() < workStart.getTime()) {
        cursor = workStart;
        continue;
      }

      if (cursor.getTime() >= workEnd.getTime()) {
        cursor = this.getNextBusinessDayStart(localParts, config);
        continue;
      }

      const availableMs = workEnd.getTime() - cursor.getTime();
      const consumedMs = Math.min(availableMs, remainingMs);
      cursor = new Date(cursor.getTime() + consumedMs);
      remainingMs -= consumedMs;
    }

    return cursor;
  }

  private shouldUseClockHourSla(): boolean {
    const raw = this.configService.get<string | boolean>('WORKFLOW_SLA_USE_CLOCK_HOURS');
    if (raw === true) {
      return true;
    }
    if (typeof raw === 'string') {
      return raw.trim().toLowerCase() === 'true' || raw.trim() === '1';
    }
    return false;
  }

  private getConfig(): BusinessTimeConfig {
    const rawStartHour = this.configService.get<number>('BUSINESS_DAY_START_HOUR') ?? 9;
    const rawEndHour = this.configService.get<number>('BUSINESS_DAY_END_HOUR') ?? 17;
    const startHour = Number.isInteger(rawStartHour) ? Math.min(Math.max(rawStartHour, 0), 23) : 9;
    const fallbackEnd = startHour + 1;
    const endHourCandidate = Number.isInteger(rawEndHour) ? Math.min(Math.max(rawEndHour, 1), 24) : 17;
    const endHour = endHourCandidate > startHour ? endHourCandidate : Math.min(fallbackEnd, 24);

    const rawDays = this.configService.get<string>('BUSINESS_WORK_DAYS') ?? '1,2,3,4,5';
    const parsedDays = rawDays
      .split(',')
      .map((value) => Number(value.trim()))
      .filter((value) => Number.isInteger(value) && value >= 1 && value <= 7);

    const holidayRaw = this.configService.get<string>('BUSINESS_HOLIDAYS') ?? '';
    const holidays = new Set(
      holidayRaw
        .split(',')
        .map((value) => value.trim())
        .filter((value) => /^\d{4}-\d{2}-\d{2}$/.test(value))
    );

    return {
      timeZone: this.configService.get<string>('BUSINESS_TZ') ?? 'UTC',
      dayStartHour: startHour,
      dayEndHour: endHour,
      workDays: new Set(parsedDays.length > 0 ? parsedDays : [1, 2, 3, 4, 5]),
      holidays
    };
  }

  private localDateKey(parts: LocalDateParts): string {
    return `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
  }

  private isBusinessDay(parts: LocalDateParts, config: BusinessTimeConfig): boolean {
    if (!config.workDays.has(this.getIsoWeekDay(parts))) {
      return false;
    }
    if (config.holidays.has(this.localDateKey(parts))) {
      return false;
    }
    return true;
  }

  private getNextBusinessDayStart(currentLocalDate: LocalDateParts, config: BusinessTimeConfig): Date {
    let probe = currentLocalDate;

    for (let i = 0; i < 400; i += 1) {
      probe = this.addDays(probe, 1);
      if (this.isBusinessDay(probe, config)) {
        return this.makeDateInTimeZone(
          probe.year,
          probe.month,
          probe.day,
          config.dayStartHour,
          0,
          0,
          config.timeZone
        );
      }
    }

    return this.makeDateInTimeZone(
      currentLocalDate.year,
      currentLocalDate.month,
      currentLocalDate.day,
      config.dayStartHour,
      0,
      0,
      config.timeZone
    );
  }

  private addDays(date: LocalDateParts, days: number): LocalDateParts {
    const utc = new Date(Date.UTC(date.year, date.month - 1, date.day + days));
    return {
      year: utc.getUTCFullYear(),
      month: utc.getUTCMonth() + 1,
      day: utc.getUTCDate()
    };
  }

  private getIsoWeekDay(date: LocalDateParts): number {
    const weekDay = new Date(Date.UTC(date.year, date.month - 1, date.day)).getUTCDay();
    return weekDay === 0 ? 7 : weekDay;
  }

  private getLocalDateParts(date: Date, timeZone: string): LocalDateParts {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    });

    const parts = formatter.formatToParts(date);
    const year = Number(parts.find((part) => part.type === 'year')?.value ?? '0');
    const month = Number(parts.find((part) => part.type === 'month')?.value ?? '0');
    const day = Number(parts.find((part) => part.type === 'day')?.value ?? '0');

    return { year, month, day };
  }

  private makeDateInTimeZone(
    year: number,
    month: number,
    day: number,
    hour: number,
    minute: number,
    second: number,
    timeZone: string
  ): Date {
    const localUtcMs = Date.UTC(year, month - 1, day, hour, minute, second, 0);
    let candidate = new Date(localUtcMs);

    for (let i = 0; i < 3; i += 1) {
      const offsetMinutes = this.getOffsetMinutes(candidate, timeZone);
      candidate = new Date(localUtcMs - offsetMinutes * 60 * 1000);
    }

    return candidate;
  }

  private getOffsetMinutes(date: Date, timeZone: string): number {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
      timeZoneName: 'shortOffset'
    });

    const zoneName = formatter.formatToParts(date).find((part) => part.type === 'timeZoneName')?.value ?? 'GMT';
    if (zoneName === 'GMT' || zoneName === 'UTC') {
      return 0;
    }

    const match = zoneName.match(/^GMT([+-])(\d{1,2})(?::?(\d{2}))?$/);
    if (!match) {
      return 0;
    }

    const sign = match[1] === '-' ? -1 : 1;
    const hours = Number(match[2] ?? '0');
    const minutes = Number(match[3] ?? '0');
    return sign * (hours * 60 + minutes);
  }
}
