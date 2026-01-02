// file: src/seeders/super-admin.seeder.ts

import { ACCOUNT_STATUS, ROLES } from "@/constants/app.constants";
import { logger } from "@/middlewares/pino-logger";
import { User } from "@/modules/user/user.model";
import { hashPassword } from "@/utils/password.utils";

/**
 * Super Admin Seeder
 * Creates default super admin user
 */
export class SuperAdminSeeder {
  private static readonly DEFAULT_SUPER_ADMIN = {
    email: "superadmin@rentalpennymore.com",
    password: "SuperAdmin@12345",
    fullName: "Super Admin",
    phoneNumber: "+1234567890",
    address: "Head Office",
    role: ROLES.SUPER_ADMIN,
  };

  /**
   * Run seeder - creates super admin if not exists
   */
  static async run(): Promise<void> {
    try {
      logger.info("Starting super admin seeder...");

      const existing = await User.findOne({
        email: this.DEFAULT_SUPER_ADMIN.email,
        role: ROLES.SUPER_ADMIN,
      });

      if (existing) {
        logger.info("Super admin already exists. Skipping seeder.");
        return;
      }

      const hashedPassword = await hashPassword(
        this.DEFAULT_SUPER_ADMIN.password
      );

      const superAdmin = new User({
        email: this.DEFAULT_SUPER_ADMIN.email,
        password: hashedPassword,
        fullName: this.DEFAULT_SUPER_ADMIN.fullName,
        phoneNumber: this.DEFAULT_SUPER_ADMIN.phoneNumber,
        address: this.DEFAULT_SUPER_ADMIN.address,
        role: ROLES.SUPER_ADMIN,
        emailVerified: true,
        accountStatus: ACCOUNT_STATUS.ACTIVE,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      await superAdmin.save();

      logger.info(
        {
          email: this.DEFAULT_SUPER_ADMIN.email,
          role: ROLES.SUPER_ADMIN,
        },
        "Super admin created successfully"
      );

      logger.warn(
        {
          email: this.DEFAULT_SUPER_ADMIN.email,
          password: this.DEFAULT_SUPER_ADMIN.password,
        },
        "IMPORTANT: Change super admin password after first login."
      );
    } catch (error) {
      logger.error(error, "Error running super admin seeder");
      throw error;
    }
  }
}
