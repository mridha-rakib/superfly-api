// file: src/config/cookie.config.ts

export const COOKIE_CONFIG = {
  REFRESH_TOKEN: {
    name: "refreshToken",
    options: {
      httpOnly: true,
      secure: true,
      sameSite: "none",
      maxAge: 30 * 24 * 60 * 60 * 1000,
    },
  },
} as const;
