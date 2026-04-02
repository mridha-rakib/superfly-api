// file: src/services/email.service.ts

import { EMAIL_CONFIG, EMAIL_ENABLED } from "@/config/email.config";
import { DEFAULT_EMAIL_INLINE_LOGO } from "@/constants/email-branding.constants";
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
  replyTo?: string;
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

type PublicContactMessagePayload = {
  name: string;
  email: string;
  subject: string;
  message: string;
};

type EmailTemplateOptions = {
  title?: string;
  subtitle?: string;
  eyebrow?: string;
  ctaLabel?: string;
  ctaUrl?: string;
  previewText?: string;
};

type EmailDetailItem = {
  label: string;
  value?: string | null;
};

type EmailNoticeTone = "neutral" | "success" | "warning";

type InlineEmailAttachment = {
  contentBase64: string;
  contentId: string;
  contentType: string;
  fileName: string;
};

type SmtpInlineAttachment = {
  cid: string;
  content: string;
  contentType: string;
  encoding: "base64";
  filename: string;
};

export class EmailService {
  private provider: "postmark" | "smtp" | "disabled";
  private transporter?: Transporter;
  private postmarkClient?: postmark.ServerClient;
  private readonly fromName: string;
  private readonly fromAddress: string;
  private readonly replyTo?: string;
  private readonly logoImageSrc?: string;
  private readonly logoInlineAttachment?: InlineEmailAttachment;
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
    const resolvedLogoAsset = this.resolveLogoAsset(
      EMAIL_CONFIG.branding.logoUrl,
    );
    this.logoImageSrc = resolvedLogoAsset.src;
    this.logoInlineAttachment = resolvedLogoAsset.inlineAttachment;
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
    const html = this.wrapTemplate(
      this.joinSections([
        this.buildGreeting(payload.userName),
        this.buildLead(
          `Your ${payload.userType} account is ready to use and your dashboard is waiting for you.`,
        ),
        this.buildDetailsCard("What happens next", [
          {
            label: "Account type",
            value: payload.userType,
          },
          {
            label: "Recommended next step",
            value: "Sign in, review your details, and finish setting up your profile.",
          },
        ]),
        this.buildNoticeCard(
          "Need help?",
          "If you did not create this account, contact support right away so we can secure it for you.",
          "warning",
        ),
      ]),
      {
        title: `Welcome to ${APP.NAME}`,
        subtitle: "Your account is live and ready for your first sign-in.",
        eyebrow: "Welcome",
        ctaLabel: "Log in now",
        ctaUrl: payload.loginLink,
        previewText: "Your account is ready to use.",
      },
    );

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
    const verifyUrl = this.buildClientUrl(
      `/verify-code?email=${encodeURIComponent(to)}&mode=password-reset`,
    );
    const html = this.wrapTemplate(
      this.joinSections([
        this.buildGreeting(userName || "there"),
        this.buildLead("Use the secure code below to reset your password."),
        this.buildCodeCard(
          "Reset code",
          otp,
          `This code expires in ${expiresInMinutes} minutes.`,
        ),
        this.buildNoticeCard(
          "Security note",
          "If you did not request a password reset, you can safely ignore this email and your password will remain unchanged.",
        ),
      ]),
      {
        title: "Password reset code",
        subtitle: "A secure reset was requested for your account.",
        eyebrow: "Security",
        ctaLabel: "Open reset page",
        ctaUrl: verifyUrl,
        previewText: `Your reset code is ${otp}.`,
      },
    );

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
    const html = this.wrapTemplate(
      this.joinSections([
        this.buildGreeting(userName),
        this.buildLead(
          "Your password has been reset successfully and your account is ready for sign-in.",
        ),
        this.buildNoticeCard(
          "All set",
          "You can now log in with your new password whenever you're ready.",
          "success",
        ),
        this.buildNoticeCard(
          "Didn't do this?",
          "If you did not perform this action, contact support immediately so we can help protect your account.",
          "warning",
        ),
      ]),
      {
        title: "Password reset successful",
        subtitle: "Your password was updated successfully.",
        eyebrow: "Security",
        ctaLabel: "Sign in",
        ctaUrl: `${env.CLIENT_URL}/login`,
        previewText: "Your password was reset successfully.",
      },
    );

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
    const html = this.wrapTemplate(
      this.joinSections([
        this.buildGreeting(payload.userName),
        this.buildLead(
          "We detected a password change on your account and wanted to let you know right away.",
        ),
        this.buildDetailsCard("Change details", [
          {
            label: "Changed at",
            value: this.formatDateTime(payload.changedAt),
          },
          {
            label: "Status",
            value: "Password updated successfully",
          },
        ]),
        this.buildNoticeCard(
          "Didn't do this?",
          "If this change was not made by you, contact support immediately and update your account credentials.",
          "warning",
        ),
      ]),
      {
        title: "Password changed",
        subtitle: "A recent security update was detected on your account.",
        eyebrow: "Security",
        ctaLabel: "Review account",
        ctaUrl: `${env.CLIENT_URL}/login`,
        previewText: "A password change was detected on your account.",
      },
    );

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
    const html = this.wrapTemplate(
      this.joinSections([
        this.buildGreeting(payload.userName),
        this.buildLead(
          `Your ${payload.userType} account has been created. Use the temporary password below to sign in, then change it immediately.`,
        ),
        this.buildCredentialCard(
          "Temporary password",
          payload.password,
          "For your security, update this password after your first login.",
        ),
        this.buildDetailsCard("Account summary", [
          {
            label: "Account type",
            value: payload.userType,
          },
          {
            label: "Sign-in method",
            value: "Use the button below to open the login page securely.",
          },
        ]),
      ]),
      {
        title: "Your account credentials",
        subtitle: "Everything you need for your first login is below.",
        eyebrow: "Sign-in details",
        ctaLabel: "Log in and update password",
        ctaUrl: loginLink,
        previewText: "Your account is ready and includes a temporary password.",
      },
    );

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
    const subject = `${APP.NAME} job reminder: ${payload.serviceType} in the next 12-24 hours`;
    const html = this.wrapTemplate(
      this.joinSections([
        this.buildGreeting(payload.cleanerName || "there"),
        this.buildLead(
          `This is a reminder that your ${payload.serviceType} job is scheduled within the next 12 to 24 hours.`,
        ),
        this.buildDetailsCard("Job schedule", [
          {
            label: "Scheduled for",
            value: payload.scheduledFor,
          },
          {
            label: "Cleaning frequency",
            value: payload.cleaningFrequency,
          },
          {
            label: "Company",
            value: payload.companyName,
          },
          {
            label: "Address",
            value: payload.businessAddress,
          },
        ]),
        this.buildNoticeCard(
          "Before you go",
          "Please plan to arrive on time, review any site instructions, and be ready with the supplies or notes you need.",
        ),
      ]),
      {
        title: "Upcoming job reminder",
        subtitle: "A scheduled cleaning job is coming up soon.",
        eyebrow: "Job update",
        ctaLabel: "View my jobs",
        ctaUrl: `${env.CLIENT_URL}/my-jobs`,
        previewText: `Reminder: ${payload.serviceType} job in the next 12-24 hours.`,
      },
    );

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
    const html = this.wrapTemplate(
      this.joinSections([
        this.buildGreeting(payload.clientName || "there"),
        this.buildLead(
          `Your ${payload.serviceType} booking has been created successfully.`,
        ),
        this.buildDetailsCard("Booking summary", [
          {
            label: "Booking ID",
            value: payload.bookingId,
          },
          {
            label: "Service date",
            value: payload.serviceDate,
          },
          {
            label: "Preferred time",
            value: payload.preferredTime,
          },
          {
            label: "Company",
            value: payload.companyName,
          },
          {
            label: "Address",
            value: payload.businessAddress,
          },
        ]),
        this.buildNoticeCard(
          "Stay in the loop",
          "You can track status updates, assignment changes, and future activity from your booking dashboard at any time.",
          "success",
        ),
      ]),
      {
        title: "Booking confirmed",
        subtitle: "Your booking is in and the details are ready below.",
        eyebrow: "Booking update",
        ctaLabel: "View booking",
        ctaUrl: bookingLink,
        previewText: `Your booking #${payload.bookingId} is confirmed.`,
      },
    );

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
    const html = this.wrapTemplate(
      this.joinSections([
        this.buildGreeting(payload.cleanerName || "there"),
        this.buildLead(
          isReassignment
            ? `Your assignment has been updated for a ${payload.serviceType} booking.`
            : `You have been assigned to a ${payload.serviceType} booking.`,
        ),
        this.buildDetailsCard("Assignment details", [
          {
            label: "Booking ID",
            value: payload.bookingId,
          },
          {
            label: "Service date",
            value: payload.serviceDate,
          },
          {
            label: "Preferred time",
            value: payload.preferredTime,
          },
          {
            label: "Client",
            value: payload.clientName,
          },
          {
            label: "Company",
            value: payload.companyName,
          },
          {
            label: "Address",
            value: payload.businessAddress,
          },
        ]),
        this.buildNoticeCard(
          "Next step",
          "Open the job details page to review the assignment carefully and plan your arrival.",
        ),
      ]),
      {
        title: isReassignment ? "Assignment updated" : "New assignment",
        subtitle: isReassignment
          ? "Your job assignment details have changed."
          : "A new cleaning job has been assigned to you.",
        eyebrow: "Job update",
        ctaLabel: "Open job details",
        ctaUrl: jobsLink,
        previewText: `Booking #${payload.bookingId} has been ${
          isReassignment ? "reassigned" : "assigned"
        } to you.`,
      },
    );

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
        ? payload.cleanerNames.join(", ")
        : "";

    const html = this.wrapTemplate(
      this.joinSections([
        this.buildGreeting(payload.clientName || "there"),
        this.buildLead(
          isReassignment
            ? "Your booking cleaner assignment has been updated."
            : "A cleaner has been assigned to your booking.",
        ),
        this.buildDetailsCard("Booking update", [
          {
            label: "Booking ID",
            value: payload.bookingId,
          },
          {
            label: "Service type",
            value: payload.serviceType,
          },
          {
            label: "Service date",
            value: payload.serviceDate,
          },
          {
            label: "Preferred time",
            value: payload.preferredTime,
          },
          {
            label: "Assigned cleaner(s)",
            value: cleanerNamesText || null,
          },
          {
            label: "Company",
            value: payload.companyName,
          },
          {
            label: "Address",
            value: payload.businessAddress,
          },
        ]),
        this.buildNoticeCard(
          "Need the full booking view?",
          "Open your booking details to review assignment changes, notes, and service progress in one place.",
        ),
      ]),
      {
        title: isReassignment ? "Cleaner assignment updated" : "Cleaner assigned",
        subtitle: isReassignment
          ? "Your assigned cleaner details have changed."
          : "Your booking now has an assigned cleaner.",
        eyebrow: "Booking update",
        ctaLabel: "View booking details",
        ctaUrl: bookingLink,
        previewText: `Update for booking #${payload.bookingId}.`,
      },
    );

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

    const html = this.wrapTemplate(
      this.joinSections([
        this.buildGreeting(payload.cleanerName || "there"),
        this.buildLead(
          "A booking assigned to you has been marked as closed by an administrator.",
        ),
        this.buildDetailsCard("Closed booking details", [
          {
            label: "Booking ID",
            value: payload.bookingId,
          },
          {
            label: "Service type",
            value: payload.serviceType,
          },
          {
            label: "Service date",
            value: payload.serviceDate,
          },
          {
            label: "Preferred time",
            value: payload.preferredTime,
          },
          {
            label: "Company",
            value: payload.companyName,
          },
          {
            label: "Address",
            value: payload.businessAddress,
          },
        ]),
        this.buildNoticeCard(
          "Need more context?",
          "Open the job details page to review the closed booking record and any related notes.",
        ),
      ]),
      {
        title: "Booking closed",
        subtitle: "An assigned booking has been closed.",
        eyebrow: "Job update",
        ctaLabel: "Review job details",
        ctaUrl: jobsLink,
        previewText: `Booking #${payload.bookingId} has been marked closed.`,
      },
    );

    await this.send({
      to: payload.to,
      subject,
      html,
      text: this.stripHtml(html),
    });
  }

  async sendPublicContactMessage(
    payload: PublicContactMessagePayload,
  ): Promise<void> {
    const contactInbox = this.resolveContactEmail();
    const senderName = payload.name.trim();
    const senderEmail = payload.email.trim().toLowerCase();
    const normalizedSubject = payload.subject.replace(/[\r\n]+/g, " ").trim();
    const normalizedMessage = payload.message.trim();
    const replyLink = `mailto:${senderEmail}?subject=${encodeURIComponent(
      `Re: ${normalizedSubject}`,
    )}`;
    const messageHtml = normalizedMessage
      .split(/\r?\n/)
      .map((line) => this.safeText(line))
      .join("<br />");

    const subject = `${APP.NAME} contact form: ${normalizedSubject}`;
    const html = this.wrapTemplate(
      this.joinSections([
        this.buildLead(
          "A new message was submitted through the public website contact form.",
        ),
        this.buildDetailsCard("Sender details", [
          {
            label: "Name",
            value: senderName,
          },
          {
            label: "Email",
            value: senderEmail,
          },
          {
            label: "Subject",
            value: normalizedSubject,
          },
        ]),
        this.buildMessageCard("Message", messageHtml),
        this.buildNoticeCard(
          "Quick reply",
          "Use the reply button below to respond directly to the sender.",
          "success",
        ),
      ]),
      {
        title: "New contact request",
        subtitle: "A website visitor has sent a new message.",
        eyebrow: "Website lead",
        ctaLabel: "Reply to sender",
        ctaUrl: replyLink,
        previewText: `Message from ${senderName}.`,
      },
    );

    await this.send({
      to: contactInbox,
      subject,
      html,
      text: this.stripHtml(html),
      replyTo: senderEmail,
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
    return this.wrapTemplate(
      this.joinSections([
        this.buildGreeting(userName),
        this.buildLead(
          `Use the secure code below to verify your ${userType} account.`,
        ),
        this.buildCodeCard(
          "Verification code",
          code,
          `This code expires in ${expiresIn} minutes.`,
        ),
        this.buildDetailsCard("Verification details", [
          {
            label: "Account type",
            value: userType,
          },
          {
            label: "Code validity",
            value: `${expiresIn} minutes`,
          },
        ]),
        this.buildNoticeCard(
          "Keep it secure",
          "Do not share this code with anyone. Our team will never ask for it by email or phone.",
        ),
      ]),
      {
        title: "Verify your email",
        subtitle: "Confirm your account to finish setting things up.",
        eyebrow: "Account security",
        ctaLabel: "Open verification page",
        ctaUrl: this.buildClientUrl("/verify-code"),
        previewText: `Your verification code is ${code}.`,
      },
    );
  }

  private wrapTemplate(
    content: string,
    options: EmailTemplateOptions = {},
  ): string {
    const companyName = this.safeText(APP.NAME);
    const brandColor = this.resolveBrandColor();
    const clientBaseUrl = this.resolveClientBaseUrl();
    const title = this.safeText(options.title || `${APP.NAME} notification`);
    const subtitle = this.safeText(
      options.subtitle || "Here is the latest update with the details you need.",
    );
    const eyebrow = this.safeText(options.eyebrow || "Account update");
    const previewText = this.safeText(
      options.previewText || `${APP.NAME} account update`,
    );
    const ctaLabel = this.safeText(options.ctaLabel || "Open dashboard");
    const ctaUrl = this.safeText(
      options.ctaUrl?.trim() || env.CLIENT_URL?.trim() || "#",
    );

    return `
      <!doctype html>
      <html lang="en">
        <head>
          <meta charset="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          <meta name="x-apple-disable-message-reformatting" />
          <title>${title}</title>
          <style>
            body {
              margin: 0;
              padding: 0;
            }
            table {
              border-spacing: 0;
              border-collapse: collapse;
            }
            img {
              outline: none;
              text-decoration: none;
            }
            @media screen and (max-width: 620px) {
              .email-shell {
                padding: 20px 10px !important;
              }
              .email-header {
                padding: 30px 20px 24px !important;
              }
              .email-header h1 {
                font-size: 30px !important;
              }
              .email-body {
                padding: 26px 20px !important;
              }
              .email-footer {
                padding: 22px 20px 24px !important;
              }
              .email-button a {
                display: block !important;
              }
            }
          </style>
        </head>
        <body style="margin:0; padding:0; background-color:#f2ebe2;">
          <span style="display:none!important; visibility:hidden; opacity:0; color:transparent; height:0; width:0; overflow:hidden;">
            ${previewText}
          </span>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f2ebe2;">
            <tr>
              <td class="email-shell" align="center" style="padding:32px 14px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:640px; background-color:#ffffff;">
                  <tr>
                    <td class="email-header" align="center" style="padding:38px 32px 30px; background-color:${brandColor}; font-family:'Segoe UI', Arial, sans-serif;">
                      ${this.buildTemplateHeader(
                        companyName,
                        title,
                        subtitle,
                        eyebrow,
                      )}
                    </td>
                  </tr>
                  <tr>
                    <td class="email-body" style="padding:30px 32px 28px; background-color:#ffffff; font-family:'Segoe UI', Arial, sans-serif; color:#111827;">
                      <div style="font-size:15px; line-height:1.8; color:#374151;">
                        ${content}
                      </div>
                      <table role="presentation" align="center" cellpadding="0" cellspacing="0" style="margin:26px auto 0;">
                        <tr>
                          <td class="email-button" align="center" style="background-color:${brandColor};">
                            <a href="${ctaUrl}" style="display:inline-block; padding:15px 26px; font-size:15px; line-height:1; font-weight:700; color:#ffffff; text-decoration:none;">
                              ${ctaLabel}
                            </a>
                          </td>
                        </tr>
                      </table>
                    </td>
                  </tr>
                  <tr>
                    <td class="email-footer" style="padding:24px 32px 28px; background-color:#f7f1eb; font-family:'Segoe UI', Arial, sans-serif;">
                      ${this.buildTemplateFooter(companyName, brandColor, clientBaseUrl)}
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>
        </body>
      </html>
    `;
  }

  private buildTemplateHeader(
    companyName: string,
    title: string,
    subtitle: string,
    eyebrow: string,
  ): string {
    const logoMarkup = this.logoImageSrc?.trim()
      ? `
        <img
          src="${this.safeText(this.logoImageSrc.trim())}"
          alt="${companyName} logo"
          style="display:block; margin:0 auto 18px; max-width:168px; max-height:60px; width:auto; height:auto;"
        />
      `
      : `
        <p style="margin:0 0 18px; font-size:14px; line-height:1.5; font-weight:700; letter-spacing:0.08em; text-transform:uppercase; color:#fff3ea;">
          ${companyName}
        </p>
      `;

    return `
      <div style="text-align:center;">
        <p style="margin:0 0 12px; font-size:11px; line-height:1.4; font-weight:700; letter-spacing:0.16em; text-transform:uppercase; color:#ffe5da;">
          ${eyebrow}
        </p>
        ${logoMarkup}
        <h1 style="margin:0 0 12px; font-size:40px; line-height:1.12; font-weight:700; color:#ffffff;">
          ${title}
        </h1>
        <p style="margin:0; font-size:15px; line-height:1.75; color:#ffe5da;">
          ${subtitle}
        </p>
      </div>
    `;
  }

  private buildTemplateFooter(
    companyName: string,
    brandColor: string,
    clientBaseUrl: string,
  ): string {
    const contactEmail = this.resolveContactEmail();
    const contactUrl = clientBaseUrl ? `${clientBaseUrl}/contact` : "#";
    const privacyUrl = clientBaseUrl ? `${clientBaseUrl}/privacy-policy` : "#";
    const termsUrl = clientBaseUrl
      ? `${clientBaseUrl}/terms-and-conditions`
      : "#";

    return `
      <p style="margin:0 0 10px; font-size:13px; line-height:1.7; color:#6f7a89; text-align:center;">
        Need a hand or have a question?
        <a href="mailto:${this.safeText(contactEmail)}" style="color:${brandColor}; text-decoration:none; font-weight:700;">
          Contact Support
        </a>
      </p>
      <p style="margin:0 0 12px; font-size:13px; line-height:1.6; color:#7f8793; text-align:center;">
        &copy; ${new Date().getFullYear()} ${companyName}. All rights reserved.
      </p>
      <p style="margin:0; font-size:13px; line-height:1.7; text-align:center;">
        <a href="${this.safeText(contactUrl)}" style="color:${brandColor}; text-decoration:none;">Contact Us</a>
        <span style="color:#b3aa9f;"> | </span>
        <a href="${this.safeText(privacyUrl)}" style="color:${brandColor}; text-decoration:none;">Privacy Policy</a>
        <span style="color:#b3aa9f;"> | </span>
        <a href="${this.safeText(termsUrl)}" style="color:${brandColor}; text-decoration:none;">Terms and Conditions</a>
      </p>
    `;
  }

  private joinSections(
    sections: Array<string | null | undefined | false>,
  ): string {
    return sections.filter((section): section is string => Boolean(section)).join("");
  }

  private buildGreeting(name: string): string {
    return `
      <p style="margin:0 0 12px; font-size:17px; line-height:1.7; color:#223040; font-weight:700;">
        Hi ${this.safeText(name)},
      </p>
    `;
  }

  private buildLead(text: string): string {
    return `
      <p style="margin:0 0 24px; font-size:16px; line-height:1.9; color:#516072;">
        ${this.safeText(text)}
      </p>
    `;
  }

  private buildDetailsCard(title: string, items: EmailDetailItem[]): string {
    const normalizedItems = items.filter(
      (item): item is { label: string; value: string } =>
        typeof item.value === "string" && item.value.trim().length > 0,
    );

    if (!normalizedItems.length) {
      return "";
    }

    const rows = normalizedItems
      .map(
        (item) => `
          <tr>
            <td style="width:38%; padding:0 14px 10px 0; vertical-align:top;">
              <p style="margin:0; font-size:13px; line-height:1.6; font-weight:700; color:#8f7567;">
                ${this.safeText(item.label)}:
              </p>
            </td>
            <td style="padding:0 0 10px; vertical-align:top;">
              <p style="margin:0; font-size:15px; line-height:1.75; color:#223040;">
                ${this.safeText(item.value)}
              </p>
            </td>
          </tr>
        `,
      )
      .join("");

    return `
      <div style="margin:0 0 22px;">
        <p style="margin:0 0 10px; font-size:13px; line-height:1.5; font-weight:700; letter-spacing:0.08em; text-transform:uppercase; color:#9a7867;">
          ${this.safeText(title)}
        </p>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
          ${rows}
        </table>
      </div>
    `;
  }

  private buildCodeCard(label: string, code: string, hint?: string): string {
    return `
      <div style="margin:0 0 22px; text-align:center;">
        <p style="margin:0 0 10px; font-size:12px; line-height:1.4; font-weight:700; letter-spacing:0.12em; text-transform:uppercase; color:#9a7867;">
          ${this.safeText(label)}
        </p>
        <div style="margin:0 auto; max-width:420px; background-color:#fff2e8; padding:16px 18px 14px;">
          <p style="margin:0 0 10px; font-size:11px; line-height:1.4; font-weight:700; letter-spacing:0.12em; text-transform:uppercase; color:#b06d4f;">
            Tap or click to select
          </p>
          <p dir="ltr" style="margin:0; font-size:34px; line-height:1.1; font-weight:700; letter-spacing:8px; color:#1f2937; font-family:'Courier New', monospace; -webkit-user-select:all; user-select:all; cursor:text;">
            ${this.safeText(code)}
          </p>
        </div>
        ${
          hint
            ? `
              <p style="margin:12px 0 0; font-size:13px; line-height:1.7; color:#7b6758;">
                ${this.safeText(hint)}
              </p>
            `
            : ""
        }
      </div>
    `;
  }

  private buildCredentialCard(
    label: string,
    value: string,
    hint?: string,
  ): string {
    return `
      <div style="margin:0 0 22px;">
        <p style="margin:0 0 10px; font-size:12px; line-height:1.4; font-weight:700; letter-spacing:0.12em; text-transform:uppercase; color:#9a7867;">
          ${this.safeText(label)}
        </p>
        <div style="background-color:#fff3ea; padding:16px 18px 14px;">
          <p style="margin:0 0 8px; font-size:11px; line-height:1.4; font-weight:700; letter-spacing:0.12em; text-transform:uppercase; color:#b06d4f;">
            Tap or click to select
          </p>
          <p dir="ltr" style="margin:0; font-size:22px; line-height:1.6; font-weight:700; color:#1f2937; font-family:'Courier New', monospace; word-break:break-word; -webkit-user-select:all; user-select:all; cursor:text;">
            ${this.safeText(value)}
          </p>
        </div>
        ${
          hint
            ? `
              <p style="margin:12px 0 0; font-size:13px; line-height:1.7; color:#7b6758;">
                ${this.safeText(hint)}
              </p>
            `
            : ""
        }
      </div>
    `;
  }

  private buildNoticeCard(
    title: string,
    body: string,
    tone: EmailNoticeTone = "neutral",
  ): string {
    const palette = {
      neutral: {
        title: "#7a6253",
        text: "#566273",
      },
      success: {
        title: "#2f714c",
        text: "#496056",
      },
      warning: {
        title: "#b15d27",
        text: "#6d6259",
      },
    } as const;
    const colors = palette[tone];

    return `
      <p style="margin:0 0 18px; font-size:14px; line-height:1.8; color:${colors.text};">
        <strong style="color:${colors.title};">${this.safeText(title)}:</strong>
        ${this.safeText(body)}
      </p>
    `;
  }

  private buildMessageCard(title: string, messageHtml: string): string {
    return `
      <div style="margin:0 0 22px;">
        <p style="margin:0 0 12px; font-size:13px; line-height:1.5; font-weight:700; color:#9a7867;">
          ${this.safeText(title)}
        </p>
        <div style="font-size:15px; line-height:1.85; color:#3f4a58;">
          ${messageHtml}
        </div>
      </div>
    `;
  }

  private formatDateTime(date: Date): string {
    return `${new Intl.DateTimeFormat("en-US", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "UTC",
    }).format(date)} UTC`;
  }

  private resolveContactEmail(): string {
    const replyTo = this.replyTo?.trim();
    if (replyTo) {
      return replyTo;
    }

    const fromAddress = this.fromAddress?.trim();
    if (fromAddress) {
      return fromAddress;
    }

    return "support@example.com";
  }

  private resolveClientBaseUrl(): string {
    const url = env.CLIENT_URL?.trim() || "";
    return url.replace(/\/+$/, "");
  }

  private buildClientUrl(path: string): string {
    const baseUrl = this.resolveClientBaseUrl();
    const normalizedPath = path.trim();

    if (!baseUrl) {
      return normalizedPath || "#";
    }

    if (!normalizedPath) {
      return baseUrl;
    }

    return `${baseUrl}${normalizedPath.startsWith("/") ? "" : "/"}${normalizedPath}`;
  }

  private resolveBrandColor(): string {
    const color = this.brandColor?.trim();
    return color || "#C85344";
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

  private resolveLogoAsset(
    logoUrl?: string | null,
  ): {
    inlineAttachment?: InlineEmailAttachment;
    src?: string;
  } {
    const externalLogoUrl = this.normalizeLogoUrl(logoUrl);
    if (externalLogoUrl) {
      return {
        src: externalLogoUrl,
      };
    }

    return {
      inlineAttachment: DEFAULT_EMAIL_INLINE_LOGO,
      src: `cid:${DEFAULT_EMAIL_INLINE_LOGO.contentId}`,
    };
  }

  private normalizeLogoUrl(logoUrl?: string | null): string | undefined {
    const value = logoUrl?.trim();
    if (!value) {
      return undefined;
    }

    if (value.startsWith("data:image/")) {
      return value;
    }

    try {
      const parsed = new URL(value);
      if (!["http:", "https:"].includes(parsed.protocol)) {
        return undefined;
      }

      const pathName = parsed.pathname.toLowerCase();
      const imageExtensions = [
        ".png",
        ".jpg",
        ".jpeg",
        ".gif",
        ".webp",
        ".svg",
        ".bmp",
        ".avif",
      ];

      if (imageExtensions.some(extension => pathName.endsWith(extension))) {
        return parsed.toString();
      }
    } catch {
      return undefined;
    }

    return undefined;
  }

  private buildInlineAttachments(): InlineEmailAttachment[] {
    return this.logoInlineAttachment ? [this.logoInlineAttachment] : [];
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
    const attachments = this.buildInlineAttachments();

    const replyToAddress = payload.replyTo?.trim() || this.replyTo;
    if (replyToAddress) {
      message.ReplyTo = replyToAddress;
    }

    if (attachments.length > 0) {
      message.Attachments = attachments.map(attachment => ({
        Content: attachment.contentBase64,
        ContentID: `cid:${attachment.contentId}`,
        ContentType: attachment.contentType,
        Name: attachment.fileName,
      }));
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

    const attachments = this.buildInlineAttachments().map(
      (attachment): SmtpInlineAttachment => ({
        cid: attachment.contentId,
        content: attachment.contentBase64,
        contentType: attachment.contentType,
        encoding: "base64",
        filename: attachment.fileName,
      }),
    );

    await this.transporter.sendMail({
      attachments,
      from,
      to: payload.to,
      replyTo: payload.replyTo?.trim() || this.replyTo,
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
