import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Request, Response } from 'express';
import { CategorizedLogger } from '../logging/categorized-logger';
import { LogCategory, redactForLog } from '../logging/log-redact.util';
import { AppException } from '../exceptions/app.exception';

type ErrorResponse = {
  error: {
    code: string;
    message: string;
    details: Record<string, unknown>;
    request_id: string;
  };
};

@Catch()
@Injectable()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly log = new CategorizedLogger(LogCategory.HTTP, 'GlobalExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request & { requestId?: string }>();

    const requestId = request.requestId ?? randomUUID();
    const normalized = this.normalizeException(exception);

    if (normalized.status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      let safeDetail: string;
      if (exception instanceof Error) {
        safeDetail = exception.stack ?? exception.message;
      } else if (typeof exception === 'object' && exception !== null) {
        try {
          safeDetail = JSON.stringify(redactForLog(exception as Record<string, unknown>));
        } catch {
          safeDetail = '[unserializable-exception]';
        }
      } else {
        safeDetail = String(exception);
      }
      this.log.error(
        `request_id=${requestId} method=${request.method} path=${request.url} status=${normalized.status} code=${normalized.code}`,
        safeDetail
      );
    }

    const payload: ErrorResponse = {
      error: {
        code: normalized.code,
        message: normalized.message,
        details: normalized.details,
        request_id: requestId
      }
    };

    response.status(normalized.status).json(payload);
  }

  private normalizeException(exception: unknown): {
    status: number;
    code: string;
    message: string;
    details: Record<string, unknown>;
  } {
    if (exception instanceof AppException) {
      return {
        status: exception.getStatus(),
        code: exception.code,
        message: this.extractMessage(exception),
        details: exception.details ?? {}
      };
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const response = exception.getResponse();
      const details = typeof response === 'object' && response !== null ? (response as Record<string, unknown>) : {};
      const message = this.extractMessage(exception);

      return {
        status,
        code: status === HttpStatus.BAD_REQUEST ? 'VALIDATION_ERROR' : this.mapHttpStatusToCode(status),
        message,
        details
      };
    }

    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Internal server error',
      details: {}
    };
  }

  private extractMessage(exception: HttpException): string {
    const response = exception.getResponse();

    if (typeof response === 'string') {
      return response;
    }

    if (typeof response === 'object' && response !== null) {
      const message = (response as { message?: string | string[] }).message;
      if (Array.isArray(message)) {
        return message.join(', ');
      }
      if (typeof message === 'string') {
        return message;
      }
    }

    return exception.message;
  }

  private mapHttpStatusToCode(status: number): string {
    switch (status) {
      case HttpStatus.UNAUTHORIZED:
        return 'UNAUTHORIZED';
      case HttpStatus.FORBIDDEN:
        return 'FORBIDDEN';
      case HttpStatus.NOT_FOUND:
        return 'NOT_FOUND';
      case HttpStatus.CONFLICT:
        return 'CONFLICT';
      case HttpStatus.UNPROCESSABLE_ENTITY:
        return 'UNPROCESSABLE_ENTITY';
      case HttpStatus.TOO_MANY_REQUESTS:
        return 'TOO_MANY_REQUESTS';
      default:
        return 'HTTP_ERROR';
    }
  }
}
