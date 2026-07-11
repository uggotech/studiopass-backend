import { z } from "zod";

const requestCall = z.object({
  body: z.object({
    stationId: z.string().min(1, "Station ID is required"),
  }),
});

const acceptCall = z.object({
  body: z.object({
    callId: z.string().min(1, "Call ID is required"),
  }),
});

const joinCall = z.object({
  body: z.object({
    callId: z.string().min(1, "Call ID is required"),
  }),
});

const endCall = z.object({
  body: z.object({
    callId: z.string().min(1, "Call ID is required"),
  }),
});

const cancelCall = z.object({
  body: z.object({
    callId: z.string().min(1, "Call ID is required"),
  }),
});

const getHistory = z.object({
  query: z.object({
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().positive().max(100).default(20),
  }),
});

const getStationCalls = z.object({
  query: z.object({
    stationId: z.string().min(1, "Station ID is required"),
    status: z.string().optional(),
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().positive().max(100).default(20),
  }),
});

export const CallDto = {
  requestCall,
  acceptCall,
  joinCall,
  endCall,
  cancelCall,
  getHistory,
  getStationCalls,
};
