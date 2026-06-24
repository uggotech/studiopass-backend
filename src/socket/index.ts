import { Server } from "socket.io";
import http from "http";
import config from "../config";
import { logger } from "../logger/logger";

let io: Server | null = null;

export function initSocket(server: http.Server): Server {
  io = new Server(server, {
    cors: {
      origin: config.socket.cors_origin,
      methods: ["GET", "POST"],
    },
  });

  io.on("connection", (socket) => {
    logger.info(`Socket connected: ${socket.id}`);

    socket.on("join-station", (stationId: string) => {
      socket.join(`station:${stationId}`);
      logger.info(`Socket ${socket.id} joined station:${stationId}`);
    });

    socket.on("leave-station", (stationId: string) => {
      socket.leave(`station:${stationId}`);
      logger.info(`Socket ${socket.id} left station:${stationId}`);
    });

    socket.on("disconnect", () => {
      logger.info(`Socket disconnected: ${socket.id}`);
    });
  });

  return io;
}

export function getIO(): Server {
  if (!io) {
    throw new Error("Socket.io not initialized. Call initSocket first.");
  }
  return io;
}

export function emitToStation(stationId: string, event: string, data: unknown): void {
  getIO().to(`station:${stationId}`).emit(event, data);
}
