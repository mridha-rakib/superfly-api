// file: src/services/email.service.ts

import { EMAIL_CONFIG, EMAIL_ENABLED } from "@/config/email.config";
import { APP } from "@/constants/app.constants";
import { env } from "@/env";
import { logger } from "@/middlewares/pino-logger";
import * as postmark from "postmark";
import nodemailer, { type Transporter } from "nodemailer";

type BasicEmailPayload = {
  to: string;
  subject: string;
  html: string;
  text?: string;
};

type VerificationEmailPayload = {
  to: string;
  userName: string;
  userType: string;
  verificationCode: string;
  expiresIn: string;
};

type WelcomeEmailPayload = {
  to: string;
  userName: string;
  userType: string;
  loginLink: string;
};

type PasswordChangePayload = {
  to: string;
  userName: string;
  changedAt: Date;
};

type AccountCredentialsPayload = {
  to: string;
  userName: string;
  userType: string;
  password: string;
  loginLink?: string;
};

export class EmailService {
  private provider: "postmark" | "smtp" | "disabled";
  private transporter?: Transporter;
  private postmarkClient?: postmark.ServerClient;
  private readonly fromName: string;
  private readonly fromAddress: string;
  private readonly replyTo?: string;
  private readonly logoUrl?: string;
  private readonly brandColor?: string;
  private readonly maxRetries: number;
  private readonly retryDelayMs: number;
  private readonly messageStream: string;
  private readonly sandboxMode: boolean;
  private readonly enabled: boolean;

  constructor(transporter?: Transporter) {
    this.enabled = EMAIL_ENABLED && env.NODE_ENV !== "test";
    this.provider = EMAIL_CONFIG.provider;
    this.fromName = EMAIL_CONFIG.from.name;
    this.fromAddress = EMAIL_CONFIG.from.address;
    this.replyTo = EMAIL_CONFIG.replyTo || undefined;
    this.logoUrl = EMAIL_CONFIG.branding.logoUrl || undefined;
    this.brandColor = EMAIL_CONFIG.branding.brandColor || undefined;
    this.maxRetries = EMAIL_CONFIG.retry.maxRetries;
    this.retryDelayMs = EMAIL_CONFIG.retry.delayMs;
    this.messageStream = EMAIL_CONFIG.postmark.messageStream;
    this.sandboxMode = EMAIL_CONFIG.postmark.sandboxMode;

    if (transporter) {
      this.transporter = transporter;
      this.provider = "smtp";
      return;
    }

    if (this.enabled) {
      if (this.provider === "postmark") {
        this.postmarkClient = new postmark.ServerClient(
          EMAIL_CONFIG.postmark.apiToken
        );
      } else if (this.provider === "smtp") {
        this.transporter = nodemailer.createTransport({
          host: EMAIL_CONFIG.smtp.host,
          port: EMAIL_CONFIG.smtp.port,
          secure: EMAIL_CONFIG.smtp.secure,
          auth: EMAIL_CONFIG.smtp.auth,
        });
      }
    }
  }

  async sendEmailVerification(payload: VerificationEmailPayload): Promise<void> {
    const subject = `${APP.NAME} email verification`;
    const html = this.buildVerificationTemplate(
      payload.userName,
      payload.userType,
      payload.verificationCode,
      payload.expiresIn
    );

    await this.send({
      to: payload.to,
      subject,
      html,
      text: this.stripHtml(html),
    });
  }

  async resendEmailVerification(payload: VerificationEmailPayload): Promise<void> {
    const subject = `${APP.NAME} verification code`;
    const html = this.buildVerificationTemplate(
      payload.userName,
      payload.userType,
      payload.verificationCode,
      payload.expiresIn
    );

    await this.send({
      to: payload.to,
      subject,
      html,
      text: this.stripHtml(html),
    });
  }

  async sendWelcomeEmail(payload: WelcomeEmailPayload): Promise<void> {
    const subject = `Welcome to ${APP.NAME}`;
    const html = this.wrapTemplate(`
      <p>Hi ${this.safeText(payload.userName)},</p>
      <p>Your ${this.safeText(payload.userType)} account is ready.</p>
      <p>You can log in here: <a href="${payload.loginLink}">${payload.loginLink}</a></p>
      <p>If you did not create this account, please contact support.</p>
    `);

    await this.send({
      to: payload.to,
      subject,
      html,
      text: this.stripHtml(html),
    });
  }

  async sendPasswordResetOTP(
    userName: string | undefined,
    to: string,
    otp: string,
    expiresInMinutes: number
  ): Promise<void> {
    const subject = `${APP.NAME} password reset code`;
    const html = this.wrapTemplate(`
      <p>Hi ${this.safeText(userName || "there")},</p>
      <p>Your password reset code is: <strong>${otp}</strong></p>
      <p>This code expires in ${expiresInMinutes} minutes.</p>
      <p>If you did not request this, you can ignore this email.</p>
    `);

    await this.send({
      to,
      subject,
      html,
      text: this.stripHtml(html),
    });
  }

  async sendPasswordResetConfirmation(
    userName: string,
    to: string
  ): Promise<void> {
    const subject = `${APP.NAME} password reset confirmation`;
    const html = this.wrapTemplate(`
      <p>Hi ${this.safeText(userName)},</p>
      <p>Your password has been reset successfully.</p>
      <p>If you did not perform this action, please contact support immediately.</p>
    `);

    await this.send({
      to,
      subject,
      html,
      text: this.stripHtml(html),
    });
  }

  async sendPasswordChangeNotification(
    payload: PasswordChangePayload
  ): Promise<void> {
    const subject = `${APP.NAME} password changed`;
    const html = this.wrapTemplate(`
      <p>Hi ${this.safeText(payload.userName)},</p>
      <p>Your password was changed on ${payload.changedAt.toISOString()}.</p>
      <p>If you did not perform this action, please contact support immediately.</p>
    `);

    await this.send({
      to: payload.to,
      subject,
      html,
      text: this.stripHtml(html),
    });
  }

  async sendAccountCredentials(
    payload: AccountCredentialsPayload
  ): Promise<void> {
    const loginLink = payload.loginLink || `${env.CLIENT_URL}/login`;
    const subject = `${APP.NAME} account credentials`;
    const html = this.wrapTemplate(`
      <p>Hi ${this.safeText(payload.userName)},</p>
      <p>Your ${this.safeText(payload.userType)} account has been created.</p>
      <p>Temporary password: <strong>${this.safeText(
        payload.password
      )}</strong></p>
      <p>Please log in and change your password right away:</p>
      <p><a href="${loginLink}">${loginLink}</a></p>
    `);

    await this.send({
      to: payload.to,
      subject,
      html,
      text: this.stripHtml(html),
    });
  }

  private async send(payload: BasicEmailPayload): Promise<void> {
    if (!this.enabled || !this.transporter) {
      if (this.provider === "postmark" && this.postmarkClient) {
        return this.sendWithRetry(() => this.sendPostmark(payload), payload);
      }

      logger.warn(
        { to: payload.to, subject: payload.subject },
        "Email delivery skipped (not configured)"
      );
      return;
    }

    return this.sendWithRetry(() => this.sendSmtp(payload), payload);
  }

  private buildVerificationTemplate(
    userName: string,
    userType: string,
    code: string,
    expiresIn: string
  ): string {
    return this.wrapTemplate(`
      <p>Hi ${this.safeText(userName)},</p>
      <p>Use the code below to verify your ${this.safeText(
        userType
      )} account:</p>
      <p><strong>${code}</strong></p>
      <p>This code expires in ${expiresIn} minutes.</p>
    `);
  }

  private wrapTemplate(content: string): string {
    const logoMarkup = this.logoUrl
      ? `<img src="${this.logoUrl}" alt="${this.safeText(
          APP.NAME
        )}" style="max-width: 160px; height: auto; margin-bottom: 16px;" />`
      : `<h2 style="margin: 0 0 16px;">${this.safeText(APP.NAME)}</h2>`;

    const brandColor = this.brandColor || "#111111";

    return `
      <div style="font-family: Arial, sans-serif; color: #111; background-color: #f6f7f9; padding: 24px;">
        <div style="max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 12px; padding: 24px; border-top: 4px solid ${brandColor};">
        ${logoMarkup}
        ${content}
        <p>Thanks,</p>
        <p>The ${APP.NAME} team</p>
        </div>
      </div>
    `;
  }

  private safeText(value: string): string {
    return value.replace(/[&<>"']/g, (char) => {
      const escapeMap: Record<string, string> = {
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      };
      return escapeMap[char] || char;
    });
  }

  private stripHtml(html: string): string {
    return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  }

  private async sendPostmark(payload: BasicEmailPayload): Promise<void> {
    if (!this.postmarkClient) {
      throw new Error("Postmark client not configured");
    }

    const from = this.formatFromAddress();
    if (!from) {
      throw new Error("Email from address is not configured");
    }

    const message: postmark.Models.Message = {
      From: from,
      To: payload.to,
      Subject: payload.subject,
      HtmlBody: payload.html,
      TextBody: payload.text,
      MessageStream: this.messageStream,
    };

    if (this.replyTo) {
      message.ReplyTo = this.replyTo;
    }

    if (this.sandboxMode) {
      message.Tag = "sandbox";
    }

    await this.postmarkClient.sendEmail(message);
  }

  private async sendSmtp(payload: BasicEmailPayload): Promise<void> {
    if (!this.transporter) {
      throw new Error("SMTP transporter not configured");
    }

    const from = this.formatFromAddress();
    if (!from) {
      throw new Error("Email from address is not configured");
    }

    await this.transporter.sendMail({
      from,
      to: payload.to,
      replyTo: this.replyTo,
      subject: payload.subject,
      html: payload.html,
      text: payload.text,
    });
  }

  private formatFromAddress(): string {
    const address = this.fromAddress?.trim();
    if (!address) {
      return "";
    }

    const name = this.fromName?.trim();
    if (!name) {
      return address;
    }

    return `${name} <${address}>`;
  }

  private async sendWithRetry(
    operation: () => Promise<void>,
    payload: BasicEmailPayload
  ): Promise<void> {
    const attempts = Math.max(0, this.maxRetries) + 1;

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        await operation();
        return;
      } catch (error) {
        if (attempt >= attempts) {
          throw error;
        }

        logger.warn(
          { error, to: payload.to, subject: payload.subject, attempt },
          "Email send attempt failed"
        );

        if (this.retryDelayMs > 0) {
          await this.delay(this.retryDelayMs);
        }
      }
    }
  }

  private async delay(ms: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }
}
