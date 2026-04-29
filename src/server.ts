import mongoose from "mongoose";
import http from "http";
import redisClient from "./redis/redisClient";
import app from "./app";
import config from "./config";
import { errorLogger, logger } from "./logger/logger";
import ConnectDB from "./db";
import { syncUserIndexes } from "module/user/user.model";
import seedSuperAdmin from "./db/seedSuperAdmin";

// ============ CREATE SERVER ============
const server = http.createServer(app);

export { server };

// ============ MAIN ============
async function main() {
  try {
    // 1. Connect MongoDB
    await ConnectDB();

    // 2. Ensure indexes
    await syncUserIndexes();

    // 3. Seed super admin
    await seedSuperAdmin();

    // 4. Connect Redis
    try {
      await redisClient.connect();
      logger.info("Redis connected successfully");
    } catch (error) {
      logger.warn(
        `Redis unavailable, continuing with MongoDB reads only: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    // 5. Start server
    const port = Number(config.port) || 5000;

    server.listen(port, "0.0.0.0", () => {
      logger.info(`Server listening on 0.0.0.0:${port}`);
      logger.info(`Environment: ${config.node_env}`);
    });
  } catch (error) {
    errorLogger.error("Failed to start server", {
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    process.exit(1);
  }
}

main();

// ============ GRACEFUL SHUTDOWN ============
async function gracefulShutdown(signal: string) {
  logger.info(`${signal} received. Starting graceful shutdown...`);

  try {
    await new Promise<void>((resolve) => {
      if (server.closeAllConnections) {
        server.closeAllConnections();
      }
      server.close(() => {
        logger.info("HTTP server closed");
        resolve();
      });
    });

    await mongoose.disconnect();
    logger.info("MongoDB disconnected");

    await redisClient.disconnect();
    logger.info("Redis disconnected");

    logger.info("Graceful shutdown complete");
    process.exit(0);
  } catch (error) {
    errorLogger.error("Error during graceful shutdown", {
      message: error instanceof Error ? error.message : String(error),
    });
    process.exit(1);
  }
}

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));

