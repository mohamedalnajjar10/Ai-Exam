import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { Prisma } from '@prisma/client';

const PRISMA_CLIENT_ERRORS: Record<
  string,
  { status: HttpStatus; message: string }
> = {
  P2000: {
    status: HttpStatus.BAD_REQUEST,
    message: 'Value is too long for the field',
  },
  P2001: { status: HttpStatus.NOT_FOUND, message: 'Record does not exist' },
  P2002: {
    status: HttpStatus.CONFLICT,
    message: 'A record with this value already exists',
  },
  P2003: {
    status: HttpStatus.BAD_REQUEST,
    message: 'Referenced record does not exist',
  },
  P2004: {
    status: HttpStatus.BAD_REQUEST,
    message: 'Constraint validation failed',
  },
  P2005: {
    status: HttpStatus.BAD_REQUEST,
    message: 'Invalid value stored in the database',
  },
  P2006: {
    status: HttpStatus.BAD_REQUEST,
    message: 'Invalid value for the field',
  },
  P2007: { status: HttpStatus.BAD_REQUEST, message: 'Data validation error' },
  P2008: {
    status: HttpStatus.BAD_REQUEST,
    message: 'Failed to parse the query',
  },
  P2009: {
    status: HttpStatus.BAD_REQUEST,
    message: 'Failed to validate the query',
  },
  P2011: {
    status: HttpStatus.BAD_REQUEST,
    message: 'A required field is missing',
  },
  P2012: {
    status: HttpStatus.BAD_REQUEST,
    message: 'A required value is missing',
  },
  P2013: {
    status: HttpStatus.BAD_REQUEST,
    message: 'A required argument is missing',
  },
  P2014: { status: HttpStatus.BAD_REQUEST, message: 'Relation violation' },
  P2015: {
    status: HttpStatus.NOT_FOUND,
    message: 'Referenced record does not exist',
  },
  P2016: {
    status: HttpStatus.BAD_REQUEST,
    message: 'Unable to interpret the query',
  },
  P2017: {
    status: HttpStatus.BAD_REQUEST,
    message: 'Related records are not connected',
  },
  P2018: {
    status: HttpStatus.NOT_FOUND,
    message: 'Required connected records were not found',
  },
  P2020: {
    status: HttpStatus.BAD_REQUEST,
    message: 'Value out of range for the field',
  },
  P2025: { status: HttpStatus.NOT_FOUND, message: 'Record not found' },
  P2034: {
    status: HttpStatus.CONFLICT,
    message: 'Transaction conflict, please retry',
  },
};

const PRISMA_SERVER_ERRORS: Record<
  string,
  { status: HttpStatus; message: string }
> = {
  P2010: {
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    message: 'Database query failed',
  },
  P2021: {
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    message: 'Database table does not exist',
  },
  P2022: {
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    message: 'Database column does not exist',
  },
  P2023: {
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    message: 'Database index does not exist',
  },
  P2024: {
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    message: 'Database constraint does not exist',
  },
  P2026: {
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    message: 'Database engine is not supported',
  },
  P2027: {
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    message: 'Multiple database errors occurred',
  },
  P2028: {
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    message: 'Database transaction error',
  },
  P2030: {
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    message: 'Full-text search is not available',
  },
  P2033: {
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    message: 'Database number overflow',
  },
};

const DATABASE_UNAVAILABLE = {
  status: HttpStatus.SERVICE_UNAVAILABLE,
  message: 'Database is unavailable',
};

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message: string | string[] = 'Internal server error';
    let details: string | undefined;

    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      const mapped =
        PRISMA_CLIENT_ERRORS[exception.code] ??
        PRISMA_SERVER_ERRORS[exception.code];
      if (mapped) {
        status = mapped.status;
        message = mapped.message;
      } else {
        status = HttpStatus.INTERNAL_SERVER_ERROR;
        message = 'Database error';
      }
      details = `Prisma code: ${exception.code}`;
    } else if (exception instanceof Prisma.PrismaClientInitializationError) {
      status = DATABASE_UNAVAILABLE.status;
      message = DATABASE_UNAVAILABLE.message;
      details = 'Prisma initialization failed';
    } else if (exception instanceof Prisma.PrismaClientValidationError) {
      status = HttpStatus.INTERNAL_SERVER_ERROR;
      message = 'Invalid database query';
      details = 'Prisma validation error';
    } else if (
      exception instanceof Prisma.PrismaClientRustPanicError ||
      exception instanceof Prisma.PrismaClientUnknownRequestError
    ) {
      status = HttpStatus.INTERNAL_SERVER_ERROR;
      message = 'Database error';
      details = 'Prisma client error';
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      const res = exception.getResponse();
      if (typeof res === 'string') {
        message = res;
      } else if (typeof res === 'object' && res !== null) {
        const body = res as Record<string, unknown>;
        message = (body.message as string | string[]) ?? message;
      }
      details = JSON.stringify(message);
    }

    const logMessage = `${request.method} ${request.url} ${status}${
      details ? ` - ${details}` : ''
    }`;

    // Client errors (4xx) are expected outcomes and are logged as warnings.
    // Only genuine server failures (5xx) deserve error-level logs with stacks.
    if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error(
        logMessage,
        exception instanceof Error ? exception.stack : undefined,
      );
    } else {
      this.logger.warn(logMessage);
    }

    response.status(status).json({
      statusCode: status,
      message,
      timestamp: new Date().toISOString(),
      path: request.url,
    });
  }
}
