import {
  BadRequestException,
  HttpStatus,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common';
import type { Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import { AllExceptionsFilter } from './http-exception.filter';

const createMockHttp = (): {
  filter: ExceptionFilter;
  response: { status: jest.Mock; json: jest.Mock };
  host: ArgumentsHost;
} => {
  const response = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn(),
  } as unknown as Response;
  const request = { method: 'GET', url: '/test' } as unknown as Request;
  const host = {
    switchToHttp: () => ({
      getResponse: () => response,
      getRequest: () => request,
    }),
  } as unknown as ArgumentsHost;
  return { filter: new AllExceptionsFilter(), response, host };
};

const getJsonBody = (response: {
  status: jest.Mock;
  json: jest.Mock;
}): {
  statusCode: number;
  message: unknown;
  timestamp: string;
  path: string;
} => {
  const calls = response.json.mock.calls as unknown as [
    { statusCode: number; message: unknown; timestamp: string; path: string },
  ][];
  return calls[0][0];
};

const prismaError = (code: string) =>
  new Prisma.PrismaClientKnownRequestError('Prisma error', {
    code,
    clientVersion: '1.0.0',
  });

describe('AllExceptionsFilter', () => {
  let filter: ExceptionFilter;
  let response: { status: jest.Mock; json: jest.Mock };
  let host: ArgumentsHost;
  let errorSpy: jest.SpyInstance;
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    errorSpy = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    warnSpy = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    const mock = createMockHttp();
    filter = mock.filter;
    response = mock.response;
    host = mock.host;
  });

  it('should respond with a consistent error body shape', () => {
    filter.catch(new BadRequestException('bad input'), host);

    expect(response.status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
    const body = getJsonBody(response);
    expect(body.statusCode).toBe(HttpStatus.BAD_REQUEST);
    expect(body.message).toBe('bad input');
    expect(() => new Date(body.timestamp).toISOString()).not.toThrow();
    expect(body.path).toBe('/test');
  });

  describe('HttpException', () => {
    it('should use the status and string message', () => {
      filter.catch(new BadRequestException('bad input'), host);

      expect(response.status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
      expect(getJsonBody(response).message).toBe('bad input');
    });

    it('should forward validation message arrays', () => {
      const errors = ['name must be a string', 'email must be an email'];
      filter.catch(new BadRequestException(errors), host);

      expect(response.status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
      expect(getJsonBody(response).message).toEqual(errors);
    });
  });

  describe('logging', () => {
    it('should log client errors (4xx) as warnings without a stack', () => {
      filter.catch(new BadRequestException('bad input'), host);

      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('400'));
      expect(errorSpy).not.toHaveBeenCalled();
    });

    it('should log server errors (5xx) as errors with a stack', () => {
      filter.catch(new Error('boom'), host);

      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('500'),
        expect.stringContaining('Error: boom'),
      );
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it('should log internal server errors thrown as HttpExceptions as errors', () => {
      filter.catch(new InternalServerErrorException('boom'), host);

      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('500'),
        expect.any(String),
      );
      expect(warnSpy).not.toHaveBeenCalled();
    });
  });

  describe('Prisma known request errors', () => {
    it.each([
      ['P2000', HttpStatus.BAD_REQUEST, 'القيمة طويلة جداً لهذا الحقل'],
      ['P2001', HttpStatus.NOT_FOUND, 'السجل غير موجود'],
      ['P2002', HttpStatus.CONFLICT, 'يوجد سجل بهذه القيمة بالفعل'],
      ['P2003', HttpStatus.BAD_REQUEST, 'السجل المرتبط غير موجود'],
      ['P2004', HttpStatus.BAD_REQUEST, 'فشل التحقق من القيود'],
      [
        'P2005',
        HttpStatus.BAD_REQUEST,
        'قيمة غير صالحة مخزنة في قاعدة البيانات',
      ],
      ['P2006', HttpStatus.BAD_REQUEST, 'قيمة غير صالحة للحقل'],
      ['P2007', HttpStatus.BAD_REQUEST, 'خطأ في التحقق من البيانات'],
      ['P2008', HttpStatus.BAD_REQUEST, 'فشل في تحليل الاستعلام'],
      ['P2009', HttpStatus.BAD_REQUEST, 'فشل في التحقق من الاستعلام'],
      ['P2011', HttpStatus.BAD_REQUEST, 'حقل مطلوب مفقود'],
      ['P2012', HttpStatus.BAD_REQUEST, 'قيمة مطلوبة مفقودة'],
      ['P2013', HttpStatus.BAD_REQUEST, 'وسيط مطلوب مفقود'],
      ['P2014', HttpStatus.BAD_REQUEST, 'انتهاك في العلاقة'],
      ['P2015', HttpStatus.NOT_FOUND, 'السجل المرتبط غير موجود'],
      ['P2016', HttpStatus.BAD_REQUEST, 'تعذر تفسير الاستعلام'],
      ['P2017', HttpStatus.BAD_REQUEST, 'السجلات المرتبطة غير متصلة'],
      [
        'P2018',
        HttpStatus.NOT_FOUND,
        'لم يتم العثور على السجلات المرتبطة المطلوبة',
      ],
      ['P2020', HttpStatus.BAD_REQUEST, 'القيمة خارج النطاق المسموح للحقل'],
      ['P2025', HttpStatus.NOT_FOUND, 'السجل غير موجود'],
      ['P2034', HttpStatus.CONFLICT, 'تعارض في المعاملة، يرجى إعادة المحاولة'],
      ['P2010', HttpStatus.INTERNAL_SERVER_ERROR, 'فشل استعلام قاعدة البيانات'],
      [
        'P2021',
        HttpStatus.INTERNAL_SERVER_ERROR,
        'جدول قاعدة البيانات غير موجود',
      ],
      [
        'P2022',
        HttpStatus.INTERNAL_SERVER_ERROR,
        'عمود قاعدة البيانات غير موجود',
      ],
      [
        'P2023',
        HttpStatus.INTERNAL_SERVER_ERROR,
        'فهرس قاعدة البيانات غير موجود',
      ],
      [
        'P2024',
        HttpStatus.INTERNAL_SERVER_ERROR,
        'قيد قاعدة البيانات غير موجود',
      ],
      [
        'P2026',
        HttpStatus.INTERNAL_SERVER_ERROR,
        'محرك قاعدة البيانات غير مدعوم',
      ],
      [
        'P2027',
        HttpStatus.INTERNAL_SERVER_ERROR,
        'حدثت أخطاء متعددة في قاعدة البيانات',
      ],
      [
        'P2028',
        HttpStatus.INTERNAL_SERVER_ERROR,
        'خطأ في معاملة قاعدة البيانات',
      ],
      [
        'P2030',
        HttpStatus.INTERNAL_SERVER_ERROR,
        'البحث النصي الكامل غير متاح',
      ],
      [
        'P2033',
        HttpStatus.INTERNAL_SERVER_ERROR,
        'تجاوز في الأرقام بقاعدة البيانات',
      ],
    ])(
      'should map Prisma code %s to %i with message %s',
      (code, status, message) => {
        filter.catch(prismaError(code), host);

        expect(response.status).toHaveBeenCalledWith(status);
        expect(getJsonBody(response).message).toBe(message);
      },
    );

    it('should fall back to a generic database error for unknown codes', () => {
      filter.catch(prismaError('P9999'), host);

      expect(response.status).toHaveBeenCalledWith(
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
      expect(getJsonBody(response).message).toBe('خطأ في قاعدة البيانات');
    });
  });

  describe('Other Prisma client errors', () => {
    it('should return 503 when the database cannot be reached', () => {
      filter.catch(
        new Prisma.PrismaClientInitializationError(
          'Connection refused',
          '1.0.0',
        ),
        host,
      );

      expect(response.status).toHaveBeenCalledWith(
        HttpStatus.SERVICE_UNAVAILABLE,
      );
      expect(getJsonBody(response).message).toBe('قاعدة البيانات غير متاحة');
    });

    it('should return 500 for query validation errors', () => {
      filter.catch(
        new Prisma.PrismaClientValidationError('Invalid query', {
          clientVersion: '1.0.0',
        }),
        host,
      );

      expect(response.status).toHaveBeenCalledWith(
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
      expect(getJsonBody(response).message).toBe(
        'استعلام قاعدة بيانات غير صالح',
      );
    });

    it('should return 500 for engine panics', () => {
      filter.catch(
        new Prisma.PrismaClientRustPanicError('Panic', '1.0.0'),
        host,
      );

      expect(response.status).toHaveBeenCalledWith(
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
      expect(getJsonBody(response).message).toBe('خطأ في قاعدة البيانات');
    });

    it('should return 500 for unknown request errors', () => {
      filter.catch(
        new Prisma.PrismaClientUnknownRequestError('Unknown', {
          clientVersion: '1.0.0',
        }),
        host,
      );

      expect(response.status).toHaveBeenCalledWith(
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
      expect(getJsonBody(response).message).toBe('خطأ في قاعدة البيانات');
    });
  });

  describe('Unexpected errors', () => {
    it('should return a generic 500 for any uncaught error', () => {
      filter.catch(new Error('something went wrong'), host);

      expect(response.status).toHaveBeenCalledWith(
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
      expect(getJsonBody(response).message).toBe('خطأ في الخادم الداخلي');
    });

    it('should return a generic 500 for non-error values', () => {
      filter.catch('string error', host);

      expect(response.status).toHaveBeenCalledWith(
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
      expect(getJsonBody(response).message).toBe('خطأ في الخادم الداخلي');
    });
  });
});
