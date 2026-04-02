import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const BUNDLED_EMAIL_LOGO_PATH = resolve(
  process.cwd(),
  "src/assets/superfly-email-logo.base64.txt",
);

const loadBundledEmailLogoBase64 = (): string => {
  if (!existsSync(BUNDLED_EMAIL_LOGO_PATH)) {
    throw new Error(
      `Bundled Superfly email logo asset not found at ${BUNDLED_EMAIL_LOGO_PATH}`,
    );
  }

  return readFileSync(BUNDLED_EMAIL_LOGO_PATH, "utf8").trim();
};

export const DEFAULT_EMAIL_INLINE_LOGO = {
  contentBase64: loadBundledEmailLogoBase64(),
  contentId: "superfly-cleaning-services-logo",
  contentType: "image/png",
  fileName: "superfly-cleaning-services-logo.png",
} as const;
