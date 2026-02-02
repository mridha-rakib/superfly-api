// file: src/seeders/admin.seeder.ts

import { ACCOUNT_STATUS, ROLES } from "@/constants/app.constants";
import { logger } from "@/middlewares/pino-logger";
import { User } from "@/modules/user/user.model";
import { hashPassword } from "@/utils/password.utils";

/**
 * Admin Seeder
 * Creates default admin user
 */
export class AdminSeeder {
  private static readonly DEFAULT_ADMIN = {
    email: "admin@rentalpennymore.com",
    password: "Admin@12345",
    fullName: "Admin User",
    phoneNumber: "+1234567890",
    address: "Admin Office",
    role: ROLES.ADMIN,
  };

  static async run(): Promise<void> {
    try {
      logger.info("Starting admin seeder...");

      // Check if admin already exists
      const existingAdmin = await User.findOne({
        email: this.DEFAULT_ADMIN.email,
        role: ROLES.ADMIN,
      });

      if (existingAdmin) {
        logger.info("Admin user already exists. Skipping seeder.");
        return;
      }

      // Hash password
      const hashedPassword = await hashPassword(this.DEFAULT_ADMIN.password);

      // Create admin user
      const adminUser = new User({
        email: this.DEFAULT_ADMIN.email,
        password: hashedPassword,
        fullName: this.DEFAULT_ADMIN.fullName,
        phoneNumber: this.DEFAULT_ADMIN.phoneNumber,
        address: this.DEFAULT_ADMIN.address,
        role: ROLES.ADMIN,
        emailVerified: true,
        accountStatus: ACCOUNT_STATUS.ACTIVE,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      await adminUser.save();

      logger.info(
        {
          email: this.DEFAULT_ADMIN.email,
          role: ROLES.ADMIN,
        },
        "Admin user created successfully",
      );

      logger.warn(
        {
          email: this.DEFAULT_ADMIN.email,
          password: this.DEFAULT_ADMIN.password,
        },
        "IMPORTANT: Change admin password after first login.",
      );
    } catch (error) {
      logger.error(error, "Error running admin seeder");
      throw error;
    }
  }

  /**
   * Reset admin password to default (use with caution!)
   */
  static async resetAdminPassword(): Promise<void> {
    try {
      const hashedPassword = await hashPassword(this.DEFAULT_ADMIN.password);

      const admin = await User.findOneAndUpdate(
        { email: this.DEFAULT_ADMIN.email, role: ROLES.ADMIN },
        {
          password: hashedPassword,
          mustChangePassword: true, // Force password change
        },
        { new: true },
      );

      if (!admin) {
        throw new Error("Admin user not found");
      }

      logger.warn("Admin password reset to default. Change it immediately!");
    } catch (error) {
      logger.error(error, "Error resetting admin password");
      throw error;
    }
  }
}
