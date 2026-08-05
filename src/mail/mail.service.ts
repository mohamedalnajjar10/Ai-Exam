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
      this.logger.log('Using mock mailer (test environment)');
      return;
    }

    if (!smtpHost || !smtpUser || !smtpPass) {
      this.useMock = true;
      if (nodeEnv === 'production') {
        this.logger.error(
          'EMAIL_HOST/EMAIL_USER/EMAIL_PASSWORD are not configured. ' +
            'Emails will NOT be delivered in production!',
        );
      } else {
        this.logger.warn(
          'SMTP is not fully configured - emails will only be logged to the console',
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
      `SMTP transporter ready (${smtpHost}:${smtpPort}) - emails will be delivered`,
    );
  }

  async sendVerificationEmail(to: string, verifyLink: string): Promise<void> {
    await this.send({
      to,
      subject: 'AI Exam - Verify your email address',
      html: `
        <h2>Verify your email address</h2>
        <p>Welcome to AI Exam! Please confirm your email address to activate your account.</p>
        <p>This link is valid for 24 hours.</p>
        <p><a href="${verifyLink}">Verify my email</a></p>
        <p>If you did not create this account, you can safely ignore this email.</p>
      `,
    });
  }

  async sendPasswordResetEmail(to: string, resetLink: string): Promise<void> {
    await this.send({
      to,
      subject: 'AI Exam - Password Reset',
      html: `
        <h2>Reset your password</h2>
        <p>You requested to reset your password. This link is valid for 15 minutes.</p>
        <p><a href="${resetLink}">Reset my password</a></p>
        <p>If you did not request this, you can safely ignore this email.</p>
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
      this.logger.log(`Email sent to ${message.to} (${message.subject})`);
    } catch (error: any) {
      this.logger.error(
        `Failed to send email to ${message.to} (${message.subject}): ${
          error?.message ?? error
        }`,
      );
    }
  }
}
