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
    message: 'القيمة طويلة جداً لهذا الحقل',
  },
  P2001: { status: HttpStatus.NOT_FOUND, message: 'السجل غير موجود' },
  P2002: {
    status: HttpStatus.CONFLICT,
    message: 'يوجد سجل بهذه القيمة بالفعل',
  },
  P2003: {
    status: HttpStatus.BAD_REQUEST,
    message: 'السجل المرتبط غير موجود',
  },
  P2004: {
    status: HttpStatus.BAD_REQUEST,
    message: 'فشل التحقق من القيود',
  },
  P2005: {
    status: HttpStatus.BAD_REQUEST,
    message: 'قيمة غير صالحة مخزنة في قاعدة البيانات',
  },
  P2006: {
    status: HttpStatus.BAD_REQUEST,
    message: 'قيمة غير صالحة للحقل',
  },
  P2007: {
    status: HttpStatus.BAD_REQUEST,
    message: 'خطأ في التحقق من البيانات',
  },
  P2008: {
    status: HttpStatus.BAD_REQUEST,
    message: 'فشل في تحليل الاستعلام',
  },
  P2009: {
    status: HttpStatus.BAD_REQUEST,
    message: 'فشل في التحقق من الاستعلام',
  },
  P2011: {
    status: HttpStatus.BAD_REQUEST,
    message: 'حقل مطلوب مفقود',
  },
  P2012: {
    status: HttpStatus.BAD_REQUEST,
    message: 'قيمة مطلوبة مفقودة',
  },
  P2013: {
    status: HttpStatus.BAD_REQUEST,
    message: 'وسيط مطلوب مفقود',
  },
  P2014: { status: HttpStatus.BAD_REQUEST, message: 'انتهاك في العلاقة' },
  P2015: {
    status: HttpStatus.NOT_FOUND,
    message: 'السجل المرتبط غير موجود',
  },
  P2016: {
    status: HttpStatus.BAD_REQUEST,
    message: 'تعذر تفسير الاستعلام',
  },
  P2017: {
    status: HttpStatus.BAD_REQUEST,
    message: 'السجلات المرتبطة غير متصلة',
  },
  P2018: {
    status: HttpStatus.NOT_FOUND,
    message: 'لم يتم العثور على السجلات المرتبطة المطلوبة',
  },
  P2020: {
    status: HttpStatus.BAD_REQUEST,
    message: 'القيمة خارج النطاق المسموح للحقل',
  },
  P2025: { status: HttpStatus.NOT_FOUND, message: 'السجل غير موجود' },
  P2034: {
    status: HttpStatus.CONFLICT,
    message: 'تعارض في المعاملة، يرجى إعادة المحاولة',
  },
};

const PRISMA_SERVER_ERRORS: Record<
  string,
  { status: HttpStatus; message: string }
> = {
  P2010: {
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    message: 'فشل استعلام قاعدة البيانات',
  },
  P2021: {
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    message: 'جدول قاعدة البيانات غير موجود',
  },
  P2022: {
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    message: 'عمود قاعدة البيانات غير موجود',
  },
  P2023: {
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    message: 'فهرس قاعدة البيانات غير موجود',
  },
  P2024: {
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    message: 'قيد قاعدة البيانات غير موجود',
  },
  P2026: {
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    message: 'محرك قاعدة البيانات غير مدعوم',
  },
  P2027: {
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    message: 'حدثت أخطاء متعددة في قاعدة البيانات',
  },
  P2028: {
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    message: 'خطأ في معاملة قاعدة البيانات',
  },
  P2030: {
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    message: 'البحث النصي الكامل غير متاح',
  },
  P2033: {
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    message: 'تجاوز في الأرقام بقاعدة البيانات',
  },
};

const DATABASE_UNAVAILABLE = {
  status: HttpStatus.SERVICE_UNAVAILABLE,
  message: 'قاعدة البيانات غير متاحة',
};

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message: string | string[] = 'خطأ في الخادم الداخلي';
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
        message = 'خطأ في قاعدة البيانات';
      }
      details = `كود Prisma: ${exception.code}`;
    } else if (exception instanceof Prisma.PrismaClientInitializationError) {
      status = DATABASE_UNAVAILABLE.status;
      message = DATABASE_UNAVAILABLE.message;
      details = 'فشل تهيئة Prisma';
    } else if (exception instanceof Prisma.PrismaClientValidationError) {
      status = HttpStatus.INTERNAL_SERVER_ERROR;
      message = 'استعلام قاعدة بيانات غير صالح';
      details = 'خطأ في التحقق من Prisma';
    } else if (
      exception instanceof Prisma.PrismaClientRustPanicError ||
      exception instanceof Prisma.PrismaClientUnknownRequestError
    ) {
      status = HttpStatus.INTERNAL_SERVER_ERROR;
      message = 'خطأ في قاعدة البيانات';
      details = 'خطأ في عميل Prisma';
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
