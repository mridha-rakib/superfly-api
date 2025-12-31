// file: src/services/email.service.ts

import { EMAIL_CONFIG, EMAIL_ENABLED } from "@/config/email.config";
import { APP } from "@/constants/app.constants";
import { env } from "@/env";
import { logger } from "@/middlewares/pino-logger";
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

export class EmailService {
  private transporter?: Transporter;
  private readonly fromAddress: string;
  private readonly enabled: boolean;

  constructor(transporter?: Transporter) {
    this.enabled = EMAIL_ENABLED && env.NODE_ENV !== "test";
    this.fromAddress = EMAIL_CONFIG.from;

    if (transporter) {
      this.transporter = transporter;
      return;
    }

    if (this.enabled) {
      this.transporter = nodemailer.createTransport({
        host: EMAIL_CONFIG.host,
        port: EMAIL_CONFIG.port,
        secure: EMAIL_CONFIG.secure,
        auth: EMAIL_CONFIG.auth,
      });
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

  private async send(payload: BasicEmailPayload): Promise<void> {
    if (!this.enabled || !this.transporter) {
      logger.warn(
        { to: payload.to, subject: payload.subject },
        "Email delivery skipped (not configured)"
      );
      return;
    }

    await this.transporter.sendMail({
      from: this.fromAddress,
      to: payload.to,
      subject: payload.subject,
      html: payload.html,
      text: payload.text,
    });
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
    return `
      <div style="font-family: Arial, sans-serif; color: #111;">
        <h2>${APP.NAME}</h2>
        ${content}
        <p>Thanks,</p>
        <p>The ${APP.NAME} team</p>
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
}
