import type { CorsOptions } from "cors";

import { env } from "@/env";

type CorsEnvConfig = {
  NODE_ENV?: string;
  CLIENT_URL?: string;
  ADMIN_URL?: string;
  ALLOWED_ORIGINS?: string;
};

const LOCAL_DEV_ORIGINS = [
  "http://localhost:3000",
  "http://localhost:3001",
  "http://localhost:3002",
  "http://localhost:4173",
  "http://localhost:5173",
  "http://localhost:5174",
  "http://127.0.0.1:3000",
  "http://127.0.0.1:3001",
  "http://127.0.0.1:3002",
  "http://127.0.0.1:4173",
  "http://127.0.0.1:5173",
  "http://127.0.0.1:5174",
];

const DEFAULT_CORS_METHODS = [
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "OPTIONS",
];

const DEFAULT_CORS_ALLOWED_HEADERS = [
  "Content-Type",
  "Authorization",
  "X-Requested-With",
  "Accept",
  "Origin",
];

const normalizeOrigin = (value?: string | null): string | null => {
  if (!value) {
    return null;
  }

  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
};

const appendOrigin = (origins: Set<string>, value?: string) => {
  if (!value) {
    return;
  }

  value
    .split(",")
    .map((origin) => normalizeOrigin(origin.trim()))
    .filter((origin): origin is string => Boolean(origin))
    .forEach((origin) => origins.add(origin));
};

const deriveAdminOrigin = (clientUrl?: string): string | null => {
  const normalizedClientOrigin = normalizeOrigin(clientUrl);
  if (!normalizedClientOrigin) {
    return null;
  }

  try {
    const url = new URL(normalizedClientOrigin);
    const hostname = url.hostname;

    if (hostname === "localhost" || hostname === "127.0.0.1") {
      url.port = "3002";
      return url.origin;
    }

    const parts = hostname.split(".");
    if (parts.length < 2) {
      return null;
    }

    if (parts[0] === "admin") {
      return url.origin;
    }

    if (parts[0] === "www") {
      parts[0] = "admin";
    } else if (parts.length === 2) {
      parts.unshift("admin");
    } else {
      parts[0] = "admin";
    }

    url.hostname = parts.join(".");
    return url.origin;
  } catch {
    return null;
  }
};

const deriveWebsiteOrigin = (clientUrl?: string): string | null => {
  const normalizedClientOrigin = normalizeOrigin(clientUrl);
  if (!normalizedClientOrigin) {
    return null;
  }

  try {
    const url = new URL(normalizedClientOrigin);
    const hostname = url.hostname;

    if (hostname === "localhost" || hostname === "127.0.0.1") {
      return null;
    }

    const parts = hostname.split(".");
    if (parts.length < 2) {
      return null;
    }

    if (parts[0] === "www" || parts[0] === "admin") {
      url.hostname = parts.slice(1).join(".");
      return url.origin;
    }

    if (parts.length === 2) {
      url.hostname = ["www", ...parts].join(".");
      return url.origin;
    }

    return null;
  } catch {
    return null;
  }
};

export const buildAllowedOrigins = (config: CorsEnvConfig = env): string[] => {
  const origins = new Set<string>();

  appendOrigin(origins, config.CLIENT_URL);
  appendOrigin(origins, config.ADMIN_URL);
  appendOrigin(origins, config.ALLOWED_ORIGINS);

  const derivedAdminOrigin = deriveAdminOrigin(config.CLIENT_URL);
  if (derivedAdminOrigin) {
    origins.add(derivedAdminOrigin);
  }

  const derivedWebsiteOrigin = deriveWebsiteOrigin(config.CLIENT_URL);
  if (derivedWebsiteOrigin) {
    origins.add(derivedWebsiteOrigin);
  }

  if (config.NODE_ENV !== "production") {
    LOCAL_DEV_ORIGINS.forEach((origin) => origins.add(origin));
  }

  return Array.from(origins);
};

export const getPreferredCorsOrigin = (
  config: CorsEnvConfig = env,
): string | null => {
  return (
    normalizeOrigin(config.ADMIN_URL) ||
    deriveAdminOrigin(config.CLIENT_URL) ||
    normalizeOrigin(config.CLIENT_URL) ||
    (config.NODE_ENV !== "production" ? LOCAL_DEV_ORIGINS[2] : null)
  );
};

export const resolveCorsOrigin = (
  requestOrigin?: string,
  config: CorsEnvConfig = env,
): string | true | false => {
  if (!requestOrigin) {
    return getPreferredCorsOrigin(config) || true;
  }

  const normalizedRequestOrigin = normalizeOrigin(requestOrigin);
  if (!normalizedRequestOrigin) {
    return false;
  }

  const allowedOrigins = new Set(buildAllowedOrigins(config));
  return allowedOrigins.has(normalizedRequestOrigin)
    ? normalizedRequestOrigin
    : false;
};

// Keep HTTP and Socket.IO CORS behavior aligned so admin and website clients
// don't succeed over REST while failing over realtime polling.
export const sharedCorsOptions: CorsOptions = {
  origin: (requestOrigin, callback) => {
    if (!requestOrigin) {
      callback(null, true);
      return;
    }

    callback(null, resolveCorsOrigin(requestOrigin));
  },
  credentials: true,
  methods: DEFAULT_CORS_METHODS,
  allowedHeaders: DEFAULT_CORS_ALLOWED_HEADERS,
};

export const buildSocketCorsOptions = (
  config: CorsEnvConfig = env,
): CorsOptions => {
  const allowedOrigins = buildAllowedOrigins(config);

  return {
    // Engine.IO polling is more reliable with a concrete allowlist than the
    // callback-based origin resolver used by Express.
    origin: allowedOrigins.length ? allowedOrigins : true,
    credentials: true,
    methods: DEFAULT_CORS_METHODS,
    allowedHeaders: DEFAULT_CORS_ALLOWED_HEADERS,
  };
};

export const socketCorsOptions = buildSocketCorsOptions();
