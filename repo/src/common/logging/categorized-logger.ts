import { Logger } from '@nestjs/common';
import { LogCategoryValue } from './log-redact.util';

/**
 * Nest Logger with a stable category prefix for filtering (e.g. `[http]`, `[security]`).
 */
export class CategorizedLogger {
  private readonly logger: Logger;

  constructor(
    private readonly category: LogCategoryValue,
    context: string
  ) {
    this.logger = new Logger(`[${category}] ${context}`);
  }

  log(message: string, meta?: string): void {
    this.logger.log(meta ? `${message} ${meta}` : message);
  }

  warn(message: string, meta?: string): void {
    this.logger.warn(meta ? `${message} ${meta}` : message);
  }

  error(message: string, trace?: string): void {
    this.logger.error(message, trace);
  }

  debug(message: string): void {
    this.logger.debug(message);
  }
}
