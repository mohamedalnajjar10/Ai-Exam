import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';

export interface SentMessage {
  to: string;
  subject: string;
  html: string;
}

// Mock mailer for tests: captures messages instead of sending
class MockMailer {
  private sent: SentMessage[] = [];

  async sendMail(message: SentMessage): Promise<void> {
    this.sent.push(message);
    console.log(
      `[mock-mail] to=${message.to} subject="${message.subject}"\n${message.html}`,
    );
  }

  getSentMessages(): SentMessage[] {
    return this.sent;
  }
}

@Injectable()
export class MailService implements OnModuleInit {
  private readonly logger = new Logger(MailService.name);
  private useMock = false;
  private mockMailer = new MockMailer();
  private transporter: nodemailer.Transporter | null = null;

  constructor(private readonly configService: ConfigService) {}

  onModuleInit() {
    const nodeEnv = this.configService.get<string>('NODE_ENV');
    const smtpHost = this.configService.get<string>('EMAIL_HOST');
    const smtpUser = this.configService.get<string>('EMAIL_USER') ?? '';
    const smtpPass = this.configService.get<string>('EMAIL_PASSWORD') ?? '';
    const smtpPort = Number(
      this.configService.get<string>('EMAIL_PORT') ?? 587,
    );

    if (nodeEnv === 'test') {
      this.useMock = true;
      this.logger.log('استخدام مرسل بريد وهمي (بيئة الاختبار)');
      return;
    }

    if (!smtpHost || !smtpUser || !smtpPass) {
      this.useMock = true;
      if (nodeEnv === 'production') {
        this.logger.error(
          'لم يتم تكوين EMAIL_HOST/EMAIL_USER/EMAIL_PASSWORD. ' +
            'لن يتم تسليم رسائل البريد الإلكتروني في بيئة الإنتاج!',
        );
      } else {
        this.logger.warn(
          'لم يتم تكوين SMTP بالكامل - سيتم تسجيل رسائل البريد الإلكتروني في وحدة التحكم فقط',
        );
      }
      return;
    }

    this.transporter = nodemailer.createTransport({
      host: smtpHost,
      port: smtpPort,
      secure: smtpPort === 465,
      auth: {
        user: smtpUser,
        pass: smtpPass,
      },
    });
    this.logger.log(
      `مُهيئ SMTP جاهز (${smtpHost}:${smtpPort}) - سيتم تسليم رسائل البريد الإلكتروني`,
    );
  }

  async sendVerificationEmail(to: string, code: string): Promise<void> {
    await this.send({
      to,
      subject: 'AI Exam - رمز التحقق من بريدك الإلكتروني',
      html: `
        <h2>تحقق من بريدك الإلكتروني</h2>
        <p>مرحباً بك في AI Exam! استخدم رمز التحقق التالي لتفعيل حسابك:</p>
        <p style="font-size:28px;font-weight:bold;letter-spacing:6px">${code}</p>
        <p>هذا الرمز صالح لمدة 15 دقيقة.</p>
        <p>إذا لم تكن أنشأت هذا الحساب، يمكنك تجاهل هذا البريد الإلكتروني بأمان.</p>
      `,
    });
  }

  async sendPasswordResetEmail(to: string, resetLink: string): Promise<void> {
    await this.send({
      to,
      subject: 'AI Exam - إعادة تعيين كلمة المرور',
      html: `
        <h2>إعادة تعيين كلمة المرور</h2>
        <p>لقد طلبت إعادة تعيين كلمة المرور الخاصة بك. هذا الرابط صالح لمدة 15 دقيقة.</p>
        <p><a href="${resetLink}">إعادة تعيين كلمة المرور</a></p>
        <p>إذا لم تكن طلبت ذلك، يمكنك تجاهل هذا البريد الإلكتروني بأمان.</p>
      `,
    });
  }

  getSentMessages(): SentMessage[] {
    return this.mockMailer.getSentMessages();
  }

  /**
   * Sends an email. Delivery failures are logged but never thrown so that
   * authentication flows (e.g. forgot-password) keep working even when the
   * SMTP provider is temporarily unavailable.
   */
  private async send(message: SentMessage): Promise<void> {
    if (this.useMock || !this.transporter) {
      await this.mockMailer.sendMail(message);
      return;
    }
    const from =
      this.configService.get<string>('MAIL_FROM') ??
      this.configService.get<string>('EMAIL_USER') ??
      'noreply@aiexam.app';
    try {
      await this.transporter.sendMail({ ...message, from });
      this.logger.log(
        `تم إرسال البريد الإلكتروني إلى ${message.to} (${message.subject})`,
      );
    } catch (error: any) {
      this.logger.error(
        `فشل إرسال البريد الإلكتروني إلى ${message.to} (${message.subject}): ${
          error?.message ?? error
        }`,
      );
    }
  }
}
