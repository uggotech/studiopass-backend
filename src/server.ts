import mongoose from "mongoose";
import http from "http";
import redisClient from "./redis/redisClient";
import app from "./app";
import config from "./config";
import { errorLogger, logger } from "./logger/logger";
import ConnectDB from "./db";
import seedSuperAdmin from "./db/seedSuperAdmin";
import seedCountries from "./db/seedCountries";
import { seedPrizeTypes } from "./module/prizeType/prizeType.service";
import { startChallengeScheduler } from "./module/challenge/challengeScheduler";
import { initMinio } from "./util/minio";
import { initSocket, getIO } from "./socket";
import { startShowScheduler, stopShowScheduler } from "./module/show/showScheduler";
import { StatusService } from "./module/status/status.service";
import { CallService } from "./module/call/call.service";

import { ListenerStatementService } from "./module/listenerStatement/listenerStatement.service";

const server = http.createServer(app);
let cleanupInterval: NodeJS.Timeout | null = null;

export { server };

async function main() {
  try {
    await ConnectDB();
    await seedSuperAdmin();
    await seedCountries();
    await seedPrizeTypes();
    await ListenerStatementService.syncFreeListenerStatements();

    try {
      await redisClient.connect();
      logger.info("Redis connected successfully");
    } catch (error) {
      logger.warn(
        `Redis unavailable, continuing with MongoDB only: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    await initMinio();
    initSocket(server);
    logger.info("Socket.io initialized");

    // Clean up stale calls from previous server run
    await CallService.cleanupStaleCalls();

    // Re-register timeouts for active queued calls
    await CallService.reregisterTimeouts();

    // Periodic stale call cleanup every 30 minutes
    cleanupInterval = setInterval(async () => {
      try {
        await CallService.cleanupStaleCalls();
      } catch (err) {
        logger.error("[Call] Periodic cleanup error:", err);
      }
    }, 30 * 60 * 1000);

    startShowScheduler(60000);
    logger.info("Show scheduler started");

    startChallengeScheduler(60000);
    logger.info("Challenge scheduler started");

    StatusService.startWeeklyTopFansScheduler();
    logger.info("Weekly top fans scheduler started");

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
    stopShowScheduler();
    StatusService.stopWeeklyTopFansScheduler();
    if (cleanupInterval) clearInterval(cleanupInterval);

    try {
      const io = getIO();
      io.close();
      logger.info("Socket.io closed");
    } catch {
      // Socket.io not initialized, skip
    }

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

