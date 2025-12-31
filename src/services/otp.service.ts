// file: src/services/otp.service.ts

import { logger } from "@/middlewares/pino-logger";

export interface IOTPServiceConfig {
  length: number;
  expiryMinutes: number;
  allowDuplicates: boolean;
  trackingEnabled: boolean;
  maxTrackedOTPs: number;
}

export interface IOTPGenerationResponse {
  code: string;
  expiresAt: Date;
  expiresInSeconds: number;
  createdAt: Date;
  moduleKey?: string;
}

export interface IOTPValidationResponse {
  isValid: boolean;
  message: string;
  isExpired?: boolean;
  remainingSeconds?: number;
  errorCode?: string;
}

export class OTPService {
  private readonly DEFAULT_CONFIG: IOTPServiceConfig = {
    length: 4,
    expiryMinutes: 10,
    allowDuplicates: false,
    trackingEnabled: true,
    maxTrackedOTPs: 100,
  };

  private config: IOTPServiceConfig;

  private recentOTPs: Map<string, Set<string>> = new Map();

  constructor(config?: Partial<IOTPServiceConfig>) {
    this.config = {
      ...this.DEFAULT_CONFIG,
      ...config,
    };

    this.validateConfig();

    logger.info(
      {
        config: this.config,
      },
      "OTP Service initialized"
    );
  }

  generate(
    moduleKey?: string,
    expiryOverride?: number
  ): IOTPGenerationResponse {
    try {
      const expiryMinutes = expiryOverride || this.config.expiryMinutes;

      if (expiryMinutes < 1 || expiryMinutes > 1440) {
        throw new Error("Expiry time must be between 1 and 1440 minutes");
      }

      let otp: string;
      let attempts = 0;
      const maxAttempts = 100;

      do {
        otp = this.generateRandomOTP(this.config.length);
        attempts++;

        if (
          this.config.allowDuplicates ||
          !this.config.trackingEnabled ||
          !moduleKey
        ) {
          break;
        }

        const recentSet = this.recentOTPs.get(moduleKey);
        if (!recentSet || !recentSet.has(otp)) {
          break;
        }
      } while (attempts < maxAttempts);

      if (attempts >= maxAttempts) {
        logger.warn(
          {
            moduleKey,
            maxAttempts,
          },
          "OTP duplicate prevention failed after max attempts"
        );
      }

      if (moduleKey && this.config.trackingEnabled) {
        this.trackOTP(moduleKey, otp);
      }

      const createdAt = new Date();
      const expiresAt = new Date(
        createdAt.getTime() + expiryMinutes * 60 * 1000
      );
      const expiresInSeconds = expiryMinutes * 60;

      logger.debug(
        {
          moduleKey,
          length: this.config.length,
          expiryMinutes,
        },
        "OTP generated"
      );

      return {
        code: otp,
        expiresAt,
        expiresInSeconds,
        createdAt,
        moduleKey,
      };
    } catch (error) {
      logger.error(
        {
          error: error instanceof Error ? error.message : String(error),
          moduleKey,
        },
        "Failed to generate OTP"
      );
      throw error;
    }
  }

  generate6Digit(
    moduleKey?: string,
    expiryOverride?: number
  ): IOTPGenerationResponse {
    const originalLength = this.config.length;
    try {
      this.config.length = 6;
      return this.generate(moduleKey, expiryOverride);
    } finally {
      this.config.length = originalLength;
    }
  }

  generate8Digit(
    moduleKey?: string,
    expiryOverride?: number
  ): IOTPGenerationResponse {
    const originalLength = this.config.length;
    try {
      this.config.length = 8;
      return this.generate(moduleKey, expiryOverride);
    } finally {
      this.config.length = originalLength;
    }
  }

  validate(
    otp: string,
    expiresAt: Date,
    expectedLength?: number
  ): IOTPValidationResponse {
    try {
      const length = expectedLength || this.config.length;

      if (!otp || otp.trim() === "") {
        return {
          isValid: false,
          message: "OTP is required",
          errorCode: "OTP_MISSING",
        };
      }

      if (!/^\d+$/.test(otp)) {
        return {
          isValid: false,
          message: "OTP must contain only digits",
          errorCode: "OTP_INVALID_FORMAT",
        };
      }

      if (otp.length !== length) {
        return {
          isValid: false,
          message: `OTP must be ${length} digits`,
          errorCode: "OTP_INVALID_LENGTH",
        };
      }

      const min = Math.pow(10, length - 1);
      const max = Math.pow(10, length) - 1;
      const otpNumber = parseInt(otp, 10);

      if (otpNumber < min || otpNumber > max) {
        return {
          isValid: false,
          message: `OTP must be between ${min} and ${max}`,
          errorCode: "OTP_OUT_OF_RANGE",
        };
      }

      const now = new Date();
      const isExpired = now > expiresAt;

      if (isExpired) {
        const expiredMinutesAgo = Math.floor(
          (now.getTime() - expiresAt.getTime()) / 60000
        );
        return {
          isValid: false,
          message: `OTP has expired ${expiredMinutesAgo} minutes ago`,
          isExpired: true,
          errorCode: "OTP_EXPIRED",
        };
      }

      const remainingSeconds = Math.floor(
        (expiresAt.getTime() - now.getTime()) / 1000
      );

      return {
        isValid: true,
        message: "OTP is valid",
        isExpired: false,
        remainingSeconds,
      };
    } catch (error) {
      logger.error(
        {
          error: error instanceof Error ? error.message : String(error),
        },
        "Error validating OTP"
      );

      return {
        isValid: false,
        message: "OTP validation failed",
        errorCode: "OTP_VALIDATION_ERROR",
      };
    }
  }

  getRemainingSeconds(expiresAt: Date): number {
    const now = new Date();
    const remaining = Math.floor((expiresAt.getTime() - now.getTime()) / 1000);
    return Math.max(0, remaining);
  }

  getRemainingMinutes(expiresAt: Date): number {
    return Math.ceil(this.getRemainingSeconds(expiresAt) / 60);
  }

  isExpired(expiresAt: Date): boolean {
    return new Date() > expiresAt;
  }

  clearTrackedOTPs(moduleKey?: string): void {
    try {
      if (moduleKey) {
        this.recentOTPs.delete(moduleKey);
        logger.debug({ moduleKey }, "Cleared tracked OTPs");
      } else {
        this.recentOTPs.clear();
        logger.debug("Cleared all tracked OTPs");
      }
    } catch (error) {
      logger.error(
        {
          error: error instanceof Error ? error.message : String(error),
          moduleKey,
        },
        "Error clearing tracked OTPs"
      );
    }
  }

  getStats(): Record<string, any> {
    const stats: Record<string, any> = {
      config: this.config,
      trackedModules: this.recentOTPs.size,
      totalTrackedOTPs: 0,
    };

    this.recentOTPs.forEach((otpSet, moduleKey) => {
      stats[moduleKey] = {
        count: otpSet.size,
      };
      stats.totalTrackedOTPs += otpSet.size;
    });

    return stats;
  }

  updateConfig(config: Partial<IOTPServiceConfig>): void {
    try {
      const newConfig = { ...this.config, ...config };
      this.validateConfig();
      this.config = newConfig;

      logger.info({ config: this.config }, "OTP Service configuration updated");
    } catch (error) {
      logger.error(
        {
          error: error instanceof Error ? error.message : String(error),
        },
        "Failed to update OTP Service configuration"
      );
      throw error;
    }
  }

  private generateRandomOTP(length: number): string {
    const min = Math.pow(10, length - 1);
    const max = Math.pow(10, length) - 1;
    const randomNumber = Math.floor(Math.random() * (max - min + 1) + min);
    return randomNumber.toString();
  }

  private trackOTP(moduleKey: string, otp: string): void {
    let otpSet = this.recentOTPs.get(moduleKey);

    if (!otpSet) {
      otpSet = new Set();
      this.recentOTPs.set(moduleKey, otpSet);
    }

    otpSet.add(otp);

    if (otpSet.size > this.config.maxTrackedOTPs) {
      const firstItem = otpSet.values().next().value!;
      otpSet.delete(firstItem);
    }
  }

  private validateConfig(): void {
    if (this.config.length < 4 || this.config.length > 8) {
      throw new Error("OTP length must be between 4 and 8 digits");
    }

    if (this.config.expiryMinutes < 1 || this.config.expiryMinutes > 1440) {
      throw new Error("Expiry time must be between 1 and 1440 minutes (1 day)");
    }

    if (this.config.maxTrackedOTPs < 10 || this.config.maxTrackedOTPs > 10000) {
      throw new Error("Max tracked OTPs must be between 10 and 10000");
    }
  }
}

export const otpService = new OTPService();
