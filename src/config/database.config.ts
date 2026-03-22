// file: src/config/database.config.ts
import dns from "node:dns";
import { setTimeout as delay } from "node:timers/promises";
import mongoose from "mongoose";

import { env } from "@/env";
import { logger } from "@/middlewares/pino-logger";

const DEVELOPMENT_MONGO_DNS_FALLBACK = ["8.8.8.8", "1.1.1.1"];

let connectionListenersRegistered = false;

function isMongoSrvUri(uri: string): boolean {
  return uri.startsWith("mongodb+srv://");
}

function isLoopbackDnsServer(server: string): boolean {
  return server === "::1" || server.startsWith("127.");
}

function getMongoSrvRecordName(uri: string): string | null {
  if (!isMongoSrvUri(uri)) {
    return null;
  }

  try {
    const hostname = new URL(uri).hostname;
    return hostname ? `_mongodb._tcp.${hostname}` : null;
  } catch {
    return null;
  }
}

function registerConnectionListeners(): void {
  if (connectionListenersRegistered) {
    return;
  }

  connectionListenersRegistered = true;

  mongoose.connection.on("connected", () => {
    logger.info("Mongoose connected to DB");
  });

  mongoose.connection.on("error", (err) => {
    logger.error({ err }, "Mongoose connection error");
  });

  mongoose.connection.on("disconnected", () => {
    logger.warn("Mongoose disconnected from DB");
  });

  process.once("SIGINT", async () => {
    await mongoose.connection.close();
    logger.info("Mongoose connection closed due to app termination");
    process.exit(0);
  });
}

function configureMongoDnsServers(): void {
  if (!env.MONGO_DNS_SERVERS) {
    return;
  }

  const dnsServers = env.MONGO_DNS_SERVERS
    .split(",")
    .map(server => server.trim())
    .filter(Boolean);

  if (!dnsServers.length) {
    return;
  }

  dns.setServers(dnsServers);
  logger.info({ dnsServers }, "Using custom DNS servers for MongoDB SRV lookups");
}

async function applyDevelopmentMongoDnsFallback(): Promise<void> {
  const srvRecordName = getMongoSrvRecordName(env.MONGO_URI);

  if (!srvRecordName || env.MONGO_DNS_SERVERS || env.NODE_ENV !== "development") {
    return;
  }

  const dnsServers = dns.getServers();

  if (!dnsServers.length || !dnsServers.every(isLoopbackDnsServer)) {
    return;
  }

  try {
    await dns.promises.resolveSrv(srvRecordName);
  } catch (error) {
    const err = error as NodeJS.ErrnoException;

    if (err.code !== "ECONNREFUSED") {
      return;
    }

    dns.setServers(DEVELOPMENT_MONGO_DNS_FALLBACK);

    logger.warn(
      {
        dnsServers,
        fallbackDnsServers: DEVELOPMENT_MONGO_DNS_FALLBACK,
        srvRecordName,
      },
      "Local DNS server refused MongoDB SRV lookups. Falling back to public DNS servers in development.",
    );
  }
}

function logMongoSrvDnsHint(error: unknown): void {
  const err = error as NodeJS.ErrnoException;

  if (!isMongoSrvUri(env.MONGO_URI) || err.code !== "ECONNREFUSED") {
    return;
  }

  logger.error(
    {
      dnsServers: dns.getServers(),
      hint:
        "Node could not resolve MongoDB SRV records. Set MONGO_DNS_SERVERS=8.8.8.8,1.1.1.1 or use a standard mongodb:// URI.",
    },
    "MongoDB SRV DNS lookup failed",
  );
}

async function connectDB(retries = 3, retryDelay = 5000) {
  registerConnectionListeners();
  configureMongoDnsServers();
  await applyDevelopmentMongoDnsFallback();

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      await mongoose.connect(env.MONGO_URI);
      return;
    } catch (error) {
      logMongoSrvDnsHint(error);

      if (attempt === retries) {
        logger.error({ err: error }, "Error connecting to MongoDB database");
        throw error;
      }

      logger.warn(
        `Attempt ${attempt} failed. Retrying in ${retryDelay / 1000} seconds...`,
      );
      await delay(retryDelay);
    }
  }
}

export { connectDB };
