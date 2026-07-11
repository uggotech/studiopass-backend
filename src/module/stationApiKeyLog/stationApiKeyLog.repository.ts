import { StationApiKeyLog } from "../stationApiKeyLog/stationApiKeyLog.model";

const create = (data: {
  apiKey: string;
  station: string;
  endpoint: string;
  queryParams?: Record<string, unknown>;
  responseTimeMs: number;
  statusCode: number;
  ipAddress?: string;
  responseSizeBytes?: number;
}) => {
  return StationApiKeyLog.create(data);
};

export const StationApiKeyLogRepository = {
  create,
};
