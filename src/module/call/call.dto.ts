import { z } from "zod";

const objectIdRegex = /^[0-9a-fA-F]{24}$/;

const requestCall = z.object({
  body: z.object({
    stationId: z.string().regex(objectIdRegex, "Invalid station ID format"),
  }),
});

const acceptCall = z.object({
  body: z.object({
    callId: z.string().regex(objectIdRegex, "Invalid call ID format"),
  }),
});

const joinCall = z.object({
  body: z.object({
    callId: z.string().regex(objectIdRegex, "Invalid call ID format"),
  }),
});

const endCall = z.object({
  body: z.object({
    callId: z.string().regex(objectIdRegex, "Invalid call ID format"),
  }),
});

const cancelCall = z.object({
  body: z.object({
    callId: z.string().regex(objectIdRegex, "Invalid call ID format"),
  }),
});

const rejectCall = z.object({
  body: z.object({
    callId: z.string().regex(objectIdRegex, "Invalid call ID format"),
    reason: z.string().optional(),
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
    stationId: z.string().regex(objectIdRegex, "Invalid station ID format"),
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
  rejectCall,
  getHistory,
  getStationCalls,
};
