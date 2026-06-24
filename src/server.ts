import mongoose from "mongoose";
import http from "http";
import redisClient from "./redis/redisClient";
import app from "./app";
import config from "./config";
import { errorLogger, logger } from "./logger/logger";
import ConnectDB from "./db";
import seedSuperAdmin from "./db/seedSuperAdmin";
import seedCountries from "./db/seedCountries";
import { initMinio } from "./util/minio";

const server = http.createServer(app);

export { server };

async function main() {
  try {
    await ConnectDB();
    await seedSuperAdmin();
    await seedCountries();

    try {
      await redisClient.connect();
      logger.info("Redis connected successfully");
    } catch (error) {
      logger.warn(
        `Redis unavailable, continuing with MongoDB only: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    await initMinio();

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

