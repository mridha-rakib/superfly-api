// file: src/utils/password.utils.ts

import { env } from "@/env";
import bcryptjs from "bcryptjs";

export class PasswordUtil {
  static async hashPassword(password: string): Promise<string> {
    const saltRounds = env.SALT_ROUNDS || 10;
    return bcryptjs.hash(password, saltRounds);
  }

  static async comparePassword(
    password: string,
    hash: string
  ): Promise<boolean> {
    return bcryptjs.compare(password, hash);
  }

  static generateRandomPassword(length: number = 12): string {
    const uppercase = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    const lowercase = "abcdefghijklmnopqrstuvwxyz";
    const numbers = "0123456789";
    const specials = "!@#$%^&*";

    let password = "";
    password += uppercase[Math.floor(Math.random() * uppercase.length)];
    password += lowercase[Math.floor(Math.random() * lowercase.length)];
    password += numbers[Math.floor(Math.random() * numbers.length)];
    password += specials[Math.floor(Math.random() * specials.length)];

    const allChars = uppercase + lowercase + numbers + specials;
    for (let i = password.length; i < length; i++) {
      password += allChars[Math.floor(Math.random() * allChars.length)];
    }

    return password
      .split("")
      .sort(() => Math.random() - 0.5)
      .join("");
  }
}

export const hashPassword = PasswordUtil.hashPassword;
export const comparePassword = PasswordUtil.comparePassword;
export const generateRandomPassword = PasswordUtil.generateRandomPassword;
