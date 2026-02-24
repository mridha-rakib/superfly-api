// file: src/services/realtime.service.ts

import { logger } from "@/middlewares/pino-logger";
import { env } from "@/env";
import { AuthUtil } from "@/modules/auth/auth.utils";
import type { JWTPayload } from "@/modules/user/user.type";
import type { Server as HttpServer } from "node:http";
import { Server, type Socket } from "socket.io";

type AuthenticatedSocket = Socket & {
  data: {
    userId?: string;
    role?: string;
    email?: string;
  };
};

export type ReportSubmittedEvent = {
  quoteId: string;
  submittedBy: string;
  assignedCleanerIds: string[];
  reportStatus: string;
  submittedAt: string;
};

export type QuoteAssignmentNotificationEvent = {
  userId: string;
  recipientType: "cleaner" | "client";
  quoteId: string;
  assignmentType: "assigned" | "reassigned";
  title: string;
  message: string;
  serviceType?: string;
  serviceDate?: string;
  preferredTime?: string;
  createdAt: string;
};

export type AdminQuoteCreatedEvent = {
  quoteId: string;
  serviceType: string;
  clientName: string;
  clientEmail?: string;
  serviceDate?: string;
  preferredTime?: string;
  companyName?: string;
  createdAt: string;
};

export type QuoteStatusNotificationEvent = {
  userId: string;
  recipientType: "cleaner" | "client";
  quoteId: string;
  status: string;
  title: string;
  message: string;
  serviceType?: string;
  serviceDate?: string;
  preferredTime?: string;
  createdAt: string;
};

class RealtimeService {
  private io?: Server;

  initialize(server: HttpServer): void {
    if (this.io) {
      return;
    }

    const allowedOrigins = this.parseAllowedOrigins(env.CLIENT_URL);

    this.io = new Server(server, {
      path: "/ws",
      cors: {
        origin: allowedOrigins.length ? allowedOrigins : true,
        credentials: true,
      },
    });

    this.io.use((socket, next) => {
      try {
        const token = this.extractToken(socket as AuthenticatedSocket);
        if (!token) {
          return next(new Error("Unauthorized"));
        }
        const payload = AuthUtil.verifyAccessToken(token) as JWTPayload;
        socket.data.userId = payload.userId;
        socket.data.role = payload.role;
        socket.data.email = payload.email;
        socket.join(this.userRoom(payload.userId));
        if (payload.role) {
          socket.join(this.roleRoom(payload.role));
        }
        return next();
      } catch (error) {
        logger.warn({ error }, "WebSocket authentication failed");
        return next(new Error("Unauthorized"));
      }
    });

    this.io.on("connection", (socket) => {
      logger.info(
        { userId: socket.data.userId, socketId: socket.id },
        "WebSocket connected"
      );

      socket.on("disconnect", (reason) => {
        logger.debug(
          { userId: socket.data.userId, socketId: socket.id, reason },
          "WebSocket disconnected"
        );
      });
    });
  }

  emitReportSubmitted(event: ReportSubmittedEvent): void {
    if (!this.io) {
      logger.warn(
        { quoteId: event.quoteId },
        "WebSocket server not initialized; skipping report:submitted emit"
      );
      return;
    }

    const uniqueRecipients = Array.from(
      new Set(event.assignedCleanerIds.filter(Boolean))
    );

    const payload = {
      quoteId: event.quoteId,
      submittedBy: event.submittedBy,
      submittedAt: event.submittedAt,
      reportStatus: event.reportStatus,
    };

    uniqueRecipients.forEach((cleanerId) => {
      this.io!.to(this.userRoom(cleanerId)).emit("report:submitted", payload);
    });
  }

  emitQuoteAssignmentNotification(
    event: QuoteAssignmentNotificationEvent,
  ): void {
    if (!this.io) {
      logger.warn(
        { quoteId: event.quoteId, userId: event.userId },
        "WebSocket server not initialized; skipping quote:assignment emit"
      );
      return;
    }

    this.io.to(this.userRoom(event.userId)).emit("quote:assignment", {
      quoteId: event.quoteId,
      recipientType: event.recipientType,
      assignmentType: event.assignmentType,
      title: event.title,
      message: event.message,
      serviceType: event.serviceType,
      serviceDate: event.serviceDate,
      preferredTime: event.preferredTime,
      createdAt: event.createdAt,
    });
  }

  emitAdminQuoteCreated(event: AdminQuoteCreatedEvent): void {
    if (!this.io) {
      logger.warn(
        { quoteId: event.quoteId },
        "WebSocket server not initialized; skipping admin quote-created emit"
      );
      return;
    }

    const payload = {
      quoteId: event.quoteId,
      serviceType: event.serviceType,
      clientName: event.clientName,
      clientEmail: event.clientEmail,
      serviceDate: event.serviceDate,
      preferredTime: event.preferredTime,
      companyName: event.companyName,
      createdAt: event.createdAt,
    };

    this.io.to(this.roleRoom("admin")).emit("admin:quote-created", payload);
    this.io
      .to(this.roleRoom("super_admin"))
      .emit("admin:quote-created", payload);
  }

  emitQuoteStatusNotification(event: QuoteStatusNotificationEvent): void {
    if (!this.io) {
      logger.warn(
        { quoteId: event.quoteId, userId: event.userId, status: event.status },
        "WebSocket server not initialized; skipping quote:status emit"
      );
      return;
    }

    this.io.to(this.userRoom(event.userId)).emit("quote:status", {
      quoteId: event.quoteId,
      recipientType: event.recipientType,
      status: event.status,
      title: event.title,
      message: event.message,
      serviceType: event.serviceType,
      serviceDate: event.serviceDate,
      preferredTime: event.preferredTime,
      createdAt: event.createdAt,
    });
  }

  private userRoom(userId: string): string {
    return `user:${userId}`;
  }

  private roleRoom(role: string): string {
    return `role:${role}`;
  }

  private extractToken(socket: AuthenticatedSocket): string | undefined {
    const headerToken =
      (socket.handshake.headers.authorization as string | undefined)?.replace(
        /^Bearer\s+/i,
        ""
      );
    const authToken =
      typeof socket.handshake.auth?.token === "string"
        ? socket.handshake.auth.token
        : undefined;
    const queryToken = socket.handshake.query?.token;

    if (typeof queryToken === "string") {
      return queryToken;
    }
    if (authToken) {
      return authToken;
    }
    if (headerToken) {
      return headerToken;
    }
    return undefined;
  }

  private parseAllowedOrigins(value?: string): string[] {
    if (!value) return [];
    return value
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean);
  }
}

export const realtimeService = new RealtimeService();
