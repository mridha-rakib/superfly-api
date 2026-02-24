// file: src/services/email.service.ts

import { EMAIL_CONFIG, EMAIL_ENABLED } from "@/config/email.config";
import { APP } from "@/constants/app.constants";
import { env } from "@/env";
import { logger } from "@/middlewares/pino-logger";
import nodemailer, { type Transporter } from "nodemailer";
import * as postmark from "postmark";

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

type CleanerScheduleReminderPayload = {
  to: string;
  cleanerName: string;
  serviceType: string;
  scheduledFor: string;
  companyName?: string;
  businessAddress?: string;
  cleaningFrequency?: string;
};

type ClientBookingConfirmationPayload = {
  to: string;
  clientName: string;
  bookingId: string;
  serviceType: string;
  serviceDate: string;
  preferredTime?: string;
  companyName?: string;
  businessAddress?: string;
};

type CleanerAssignmentNotificationPayload = {
  to: string;
  cleanerName: string;
  bookingId: string;
  assignmentType: "assigned" | "reassigned";
  serviceType: string;
  serviceDate: string;
  preferredTime?: string;
  companyName?: string;
  businessAddress?: string;
  clientName?: string;
};

type ClientCleanerAssignmentNotificationPayload = {
  to: string;
  clientName: string;
  bookingId: string;
  assignmentType: "assigned" | "reassigned";
  serviceType: string;
  serviceDate: string;
  preferredTime?: string;
  cleanerNames?: string[];
  companyName?: string;
  businessAddress?: string;
};

type CleanerBookingClosedNotificationPayload = {
  to: string;
  cleanerName: string;
  bookingId: string;
  serviceType: string;
  serviceDate: string;
  preferredTime?: string;
  companyName?: string;
  businessAddress?: string;
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
          EMAIL_CONFIG.postmark.apiToken,
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

  async sendEmailVerification(
    payload: VerificationEmailPayload,
  ): Promise<void> {
    const subject = `${APP.NAME} email verification`;
    const html = this.buildVerificationTemplate(
      payload.userName,
      payload.userType,
      payload.verificationCode,
      payload.expiresIn,
    );

    await this.send({
      to: payload.to,
      subject,
      html,
      text: this.stripHtml(html),
    });
  }

  async resendEmailVerification(
    payload: VerificationEmailPayload,
  ): Promise<void> {
    const subject = `${APP.NAME} verification code`;
    const html = this.buildVerificationTemplate(
      payload.userName,
      payload.userType,
      payload.verificationCode,
      payload.expiresIn,
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
    expiresInMinutes: number,
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
    to: string,
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
    payload: PasswordChangePayload,
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
    payload: AccountCredentialsPayload,
  ): Promise<void> {
    const loginLink = payload.loginLink || `${env.CLIENT_URL}/login`;
    const subject = `${APP.NAME} account credentials`;
    const html = this.wrapTemplate(`
      <p>Hi ${this.safeText(payload.userName)},</p>
      <p>Your ${this.safeText(payload.userType)} account has been created.</p>
      <p>Temporary password: <strong>${this.safeText(
        payload.password,
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

  async sendCleanerScheduleReminder(
    payload: CleanerScheduleReminderPayload,
  ): Promise<void> {
    const subject = `${APP.NAME} job reminder: ${payload.serviceType} in 24 hours`;
    const html = this.wrapTemplate(`
      <p>Hi ${this.safeText(payload.cleanerName || "there")},</p>
      <p>This is a reminder that you are assigned to an upcoming ${this.safeText(
        payload.serviceType,
      )} job in 24 hours.</p>
      <p><strong>Scheduled for:</strong> ${this.safeText(
        payload.scheduledFor,
      )}</p>
      ${
        payload.cleaningFrequency
          ? `<p><strong>Cleaning frequency:</strong> ${this.safeText(payload.cleaningFrequency)}</p>`
          : ""
      }
      ${
        payload.companyName
          ? `<p><strong>Company:</strong> ${this.safeText(payload.companyName)}</p>`
          : ""
      }
      ${
        payload.businessAddress
          ? `<p><strong>Address:</strong> ${this.safeText(payload.businessAddress)}</p>`
          : ""
      }
      <p>Please plan to arrive on time and follow any site instructions.</p>
    `);

    await this.send({
      to: payload.to,
      subject,
      html,
      text: this.stripHtml(html),
    });
  }

  async sendClientBookingConfirmation(
    payload: ClientBookingConfirmationPayload,
  ): Promise<void> {
    const subject = `${APP.NAME} booking confirmation #${this.safeText(
      payload.bookingId,
    )}`;
    const bookingLink = `${env.CLIENT_URL}/my-booking`;
    const html = this.wrapTemplate(`
      <p>Hi ${this.safeText(payload.clientName || "there")},</p>
      <p>Your ${this.safeText(payload.serviceType)} booking has been created successfully.</p>
      <p><strong>Booking ID:</strong> ${this.safeText(payload.bookingId)}</p>
      <p><strong>Preferred date:</strong> ${this.safeText(payload.serviceDate)}</p>
      ${
        payload.preferredTime
          ? `<p><strong>Preferred time:</strong> ${this.safeText(payload.preferredTime)}</p>`
          : ""
      }
      ${
        payload.companyName
          ? `<p><strong>Company:</strong> ${this.safeText(payload.companyName)}</p>`
          : ""
      }
      ${
        payload.businessAddress
          ? `<p><strong>Address:</strong> ${this.safeText(payload.businessAddress)}</p>`
          : ""
      }
      <p>You can track updates from your dashboard:</p>
      <p><a href="${bookingLink}">${bookingLink}</a></p>
    `);

    await this.send({
      to: payload.to,
      subject,
      html,
      text: this.stripHtml(html),
    });
  }

  async sendCleanerAssignmentNotification(
    payload: CleanerAssignmentNotificationPayload,
  ): Promise<void> {
    const isReassignment = payload.assignmentType === "reassigned";
    const subject = isReassignment
      ? `${APP.NAME} booking assignment updated #${this.safeText(payload.bookingId)}`
      : `${APP.NAME} new booking assigned #${this.safeText(payload.bookingId)}`;
    const jobsLink = `${env.CLIENT_URL}/my-jobs/${payload.bookingId}`;
    const html = this.wrapTemplate(`
      <p>Hi ${this.safeText(payload.cleanerName || "there")},</p>
      <p>${
        isReassignment
          ? `Your assignment has been updated for a ${this.safeText(payload.serviceType)} booking.`
          : `You have been assigned to a ${this.safeText(payload.serviceType)} booking.`
      }</p>
      <p><strong>Booking ID:</strong> ${this.safeText(payload.bookingId)}</p>
      <p><strong>Service date:</strong> ${this.safeText(payload.serviceDate)}</p>
      ${
        payload.preferredTime
          ? `<p><strong>Preferred time:</strong> ${this.safeText(payload.preferredTime)}</p>`
          : ""
      }
      ${
        payload.clientName
          ? `<p><strong>Client:</strong> ${this.safeText(payload.clientName)}</p>`
          : ""
      }
      ${
        payload.companyName
          ? `<p><strong>Company:</strong> ${this.safeText(payload.companyName)}</p>`
          : ""
      }
      ${
        payload.businessAddress
          ? `<p><strong>Address:</strong> ${this.safeText(payload.businessAddress)}</p>`
          : ""
      }
      <p>Open your jobs page for details:</p>
      <p><a href="${jobsLink}">${jobsLink}</a></p>
    `);

    await this.send({
      to: payload.to,
      subject,
      html,
      text: this.stripHtml(html),
    });
  }

  async sendClientCleanerAssignmentNotification(
    payload: ClientCleanerAssignmentNotificationPayload,
  ): Promise<void> {
    const isReassignment = payload.assignmentType === "reassigned";
    const subject = isReassignment
      ? `${APP.NAME} cleaner assignment updated #${this.safeText(payload.bookingId)}`
      : `${APP.NAME} cleaner assigned for booking #${this.safeText(payload.bookingId)}`;
    const bookingLink = `${env.CLIENT_URL}/my-booking/${payload.bookingId}`;
    const cleanerNamesText =
      payload.cleanerNames && payload.cleanerNames.length > 0
        ? payload.cleanerNames.map((name) => this.safeText(name)).join(", ")
        : "";

    const html = this.wrapTemplate(`
      <p>Hi ${this.safeText(payload.clientName || "there")},</p>
      <p>${
        isReassignment
          ? "Your booking cleaner assignment has been updated."
          : "A cleaner has been assigned to your booking."
      }</p>
      <p><strong>Booking ID:</strong> ${this.safeText(payload.bookingId)}</p>
      <p><strong>Service type:</strong> ${this.safeText(payload.serviceType)}</p>
      <p><strong>Service date:</strong> ${this.safeText(payload.serviceDate)}</p>
      ${
        payload.preferredTime
          ? `<p><strong>Preferred time:</strong> ${this.safeText(payload.preferredTime)}</p>`
          : ""
      }
      ${
        cleanerNamesText
          ? `<p><strong>Assigned cleaner(s):</strong> ${cleanerNamesText}</p>`
          : ""
      }
      ${
        payload.companyName
          ? `<p><strong>Company:</strong> ${this.safeText(payload.companyName)}</p>`
          : ""
      }
      ${
        payload.businessAddress
          ? `<p><strong>Address:</strong> ${this.safeText(payload.businessAddress)}</p>`
          : ""
      }
      <p>You can view your booking details here:</p>
      <p><a href="${bookingLink}">${bookingLink}</a></p>
    `);

    await this.send({
      to: payload.to,
      subject,
      html,
      text: this.stripHtml(html),
    });
  }

  async sendCleanerBookingClosedNotification(
    payload: CleanerBookingClosedNotificationPayload,
  ): Promise<void> {
    const subject = `${APP.NAME} booking closed #${this.safeText(
      payload.bookingId,
    )}`;
    const jobsLink = `${env.CLIENT_URL}/my-jobs/${payload.bookingId}`;

    const html = this.wrapTemplate(`
      <p>Hi ${this.safeText(payload.cleanerName || "there")},</p>
      <p>A booking assigned to you has been marked as <strong>closed</strong> by admin.</p>
      <p><strong>Booking ID:</strong> ${this.safeText(payload.bookingId)}</p>
      <p><strong>Service type:</strong> ${this.safeText(payload.serviceType)}</p>
      <p><strong>Service date:</strong> ${this.safeText(payload.serviceDate)}</p>
      ${
        payload.preferredTime
          ? `<p><strong>Preferred time:</strong> ${this.safeText(payload.preferredTime)}</p>`
          : ""
      }
      ${
        payload.companyName
          ? `<p><strong>Company:</strong> ${this.safeText(payload.companyName)}</p>`
          : ""
      }
      ${
        payload.businessAddress
          ? `<p><strong>Address:</strong> ${this.safeText(payload.businessAddress)}</p>`
          : ""
      }
      <p>You can check your jobs page for details:</p>
      <p><a href="${jobsLink}">${jobsLink}</a></p>
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
        "Email delivery skipped (not configured)",
      );
      return;
    }

    return this.sendWithRetry(() => this.sendSmtp(payload), payload);
  }

  private buildVerificationTemplate(
    userName: string,
    userType: string,
    code: string,
    expiresIn: string,
  ): string {
    return this.wrapTemplate(`
      <p>Hi ${this.safeText(userName)},</p>
      <p>Use the code below to verify your ${this.safeText(
        userType,
      )} account:</p>
      <p><strong>${code}</strong></p>
      <p>This code expires in ${expiresIn} minutes.</p>
    `);
  }

  private wrapTemplate(content: string): string {
    const companyName = this.safeText(APP.NAME);
    const brandColor = this.resolveBrandColor();

    return `
      <div style="margin:0; padding:24px; background-color:#f3f4f6;">
        <div style="max-width:640px; margin:0 auto; background-color:#ffffff; border:1px solid #e5e7eb; border-radius:16px; overflow:hidden; font-family:Arial, sans-serif; color:#111827;">
          ${this.buildTemplateHeader(companyName, brandColor)}
          <div style="padding:24px;">
            <div style="font-size:14px; line-height:1.6; color:#111827;">
              ${content}
            </div>
          </div>
          ${this.buildTemplateFooter(companyName, brandColor)}
        </div>
      </div>
    `;
  }

  private buildTemplateHeader(companyName: string, brandColor: string): string {
    const logoMarkup = this.logoUrl?.trim()
      ? `
          <img
            src="${this.safeText(this.logoUrl.trim())}"
            alt="${companyName} logo"
            style="display:block; max-width:52px; max-height:52px; width:auto; height:auto; border-radius:8px; background:#ffffff; padding:6px;"
          />
        `
      : "";

    return `
      <div style="padding:20px 24px; background:linear-gradient(135deg, ${brandColor} 0%, #111827 100%);">
        <div style="display:flex; align-items:center; gap:12px;">
          ${logoMarkup}
          <div>
            <p style="margin:0; font-size:12px; line-height:1.2; color:#ffffffCC; text-transform:uppercase; letter-spacing:0.08em;">
              ${this.safeText(this.fromName || "Company")}
            </p>
            <p style="margin:4px 0 0; font-size:20px; line-height:1.3; font-weight:700; color:#ffffff;">
              ${companyName}
            </p>
          </div>
        </div>
      </div>
    `;
  }

  private buildTemplateFooter(companyName: string, brandColor: string): string {
    const replyToLine = this.replyTo?.trim()
      ? `<p style="margin:0 0 8px;">Questions? Reply to <a href="mailto:${this.safeText(
          this.replyTo.trim(),
        )}" style="color:${brandColor}; text-decoration:none;">${this.safeText(this.replyTo.trim())}</a></p>`
      : "";

    return `
      <div style="padding:20px 24px; background-color:#f9fafb; border-top:1px solid #e5e7eb;">
        <p style="margin:0 0 8px; font-size:13px; line-height:1.5; color:#374151;">
          Thanks,<br />
          The ${companyName} team
        </p>
        ${replyToLine}
        <p style="margin:0; font-size:12px; line-height:1.5; color:#6b7280;">
          © ${new Date().getFullYear()} ${companyName}. All rights reserved.
        </p>
      </div>
    `;
  }

  private resolveBrandColor(): string {
    const color = this.brandColor?.trim();
    return color || "#111827";
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
    return html
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
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
    payload: BasicEmailPayload,
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
          "Email send attempt failed",
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
