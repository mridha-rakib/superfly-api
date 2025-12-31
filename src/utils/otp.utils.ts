// file: src/utils/otp.utils.ts

export interface IOTPConfig {
  length: number;
  expiryMinutes: number;
  allowDuplicates: boolean;
}

/**
 * OTP Result Interface
 * Standard response structure
 */
export interface IOTPResult {
  code: string;
  expiresAt: Date;
  expiresInSeconds: number;
  createdAt: Date;
}

/**
 * OTP Validation Result Interface
 */
export interface IOTPValidationResult {
  isValid: boolean;
  message: string;
  isExpired?: boolean;
  remainingSeconds?: number;
}

/**
 * OTP Utility Class
 * Provides static methods for OTP generation and validation
 * Follows Single Responsibility Principle
 */
export class OTPUtil {
  /**
   * Default configuration
   * Can be overridden per call
   */
  private static readonly DEFAULT_CONFIG: IOTPConfig = {
    length: 4,
    expiryMinutes: 10,
    allowDuplicates: false,
  };

  private static readonly recentOTPs = new Map<string, Set<string>>();
  private static readonly MAX_RECENT_OTPS = 100;

  static generate(
    config?: Partial<IOTPConfig>,
    moduleKey?: string
  ): IOTPResult {
    // Merge with default config
    const finalConfig = { ...OTPUtil.DEFAULT_CONFIG, ...config };

    // Validate config
    OTPUtil.validateConfig(finalConfig);

    let otp: string;
    let attempts = 0;
    const maxAttempts = 5;

    // Generate OTP with duplicate prevention
    do {
      otp = OTPUtil.generateRandomOTP(finalConfig.length);
      attempts++;

      // If duplicates allowed or no module key, use the OTP
      if (finalConfig.allowDuplicates || !moduleKey) {
        break;
      }

      const recentSet = OTPUtil.recentOTPs.get(moduleKey);
      if (!recentSet || !recentSet.has(otp)) {
        break;
      }
    } while (attempts < maxAttempts);

    if (moduleKey) {
      OTPUtil.trackOTP(moduleKey, otp);
    }

    // Calculate expiration
    const createdAt = new Date();
    const expiresAt = new Date(
      createdAt.getTime() + finalConfig.expiryMinutes * 60 * 1000
    );
    const expiresInSeconds = finalConfig.expiryMinutes * 60;

    return {
      code: otp,
      expiresAt,
      expiresInSeconds,
      createdAt,
    };
  }

  static validate(
    otp: string,
    expiresAt: Date,
    expectedLength: number = 4
  ): IOTPValidationResult {
    if (!otp) {
      return {
        isValid: false,
        message: "OTP is required",
      };
    }

    if (!/^\d+$/.test(otp)) {
      return {
        isValid: false,
        message: "OTP must contain only digits",
      };
    }

    if (otp.length !== expectedLength) {
      return {
        isValid: false,
        message: `OTP must be ${expectedLength} digits`,
      };
    }

    // Check expiration
    const now = new Date();
    const isExpired = now > expiresAt;

    if (isExpired) {
      return {
        isValid: false,
        message: "OTP has expired",
        isExpired: true,
      };
    }

    // Calculate remaining time
    const remainingSeconds = Math.floor(
      (expiresAt.getTime() - now.getTime()) / 1000
    );

    return {
      isValid: true,
      message: "OTP is valid",
      isExpired: false,
      remainingSeconds,
    };
  }

  static getRemainingSeconds(expiresAt: Date): number {
    const now = new Date();
    const remaining = Math.floor((expiresAt.getTime() - now.getTime()) / 1000);
    return Math.max(0, remaining);
  }

  static isExpired(expiresAt: Date): boolean {
    return new Date() > expiresAt;
  }

  static clearOTPs(moduleKey?: string): void {
    if (moduleKey) {
      OTPUtil.recentOTPs.delete(moduleKey);
    } else {
      OTPUtil.recentOTPs.clear();
    }
  }

  static getStats(): Record<string, number> {
    const stats: Record<string, number> = { totalModules: 0 };
    OTPUtil.recentOTPs.forEach((otpSet, moduleKey) => {
      stats[moduleKey] = otpSet.size;
      stats.totalModules++;
    });
    return stats;
  }

  private static generateRandomOTP(length: number): string {
    const min = Math.pow(10, length - 1); // 10^(length-1)
    const max = Math.pow(10, length) - 1; // 10^length - 1
    const randomNumber = Math.floor(Math.random() * (max - min + 1) + min);
    return randomNumber.toString();
  }

  /**
   * Track OTP for duplicate prevention
   * @private
   */
  private static trackOTP(moduleKey: string, otp: string): void {
    let otpSet = OTPUtil.recentOTPs.get(moduleKey);

    if (!otpSet) {
      otpSet = new Set();
      OTPUtil.recentOTPs.set(moduleKey, otpSet);
    }

    otpSet.add(otp);

    // Keep only last MAX_RECENT_OTPS
    if (otpSet.size > OTPUtil.MAX_RECENT_OTPS) {
      const firstItem = otpSet.values().next().value!;
      otpSet.delete(firstItem);
    }
  }

  /**
   * Validate configuration
   * @private
   */
  private static validateConfig(config: IOTPConfig): void {
    if (config.length < 4 || config.length > 8) {
      throw new Error("OTP length must be between 4 and 8 digits");
    }

    if (config.expiryMinutes < 1 || config.expiryMinutes > 1440) {
      throw new Error("Expiry time must be between 1 and 1440 minutes");
    }
  }
}

export function generateOTP(): IOTPResult {
  return OTPUtil.generate();
}

export function validateOTP(
  otp: string,
  expiresAt: Date,
  length?: number
): IOTPValidationResult {
  return OTPUtil.validate(otp, expiresAt, length);
}
