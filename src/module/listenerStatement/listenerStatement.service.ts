import { StatusCodes } from "http-status-codes";
import AppError from "../../errors/AppError";
import { ListenerStatementRepository } from "./listenerStatement.repository";
import { MessageRepository } from "../message/message.repository";
import { StationRepository } from "../station/station.repository";
import { ShowRepository } from "../show/show.repository";
import { Country } from "../country/country.model";

const generateStatementId = (): string => {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 6);
  return `LS-${timestamp}${random}`.toUpperCase();
};

const generateTicket = (): string => {
  const random = Math.random().toString(36).substring(2, 8);
  return `TKT-${random}`.toUpperCase();
};

const createStatementFromMessage = async (messageId: string) => {
  const message = await MessageRepository.findMessageById(messageId);
  if (!message) return;
  if (message.senderType !== "user") return;

  const station = await StationRepository.findById(message.station.toString());
  if (!station) return;

  const country = await Country.findById(station.country).lean();
  if (!country) return;

  const show = message.show
    ? await ShowRepository.findById(message.show.toString())
    : null;

  const amount = (message.creditsUsed || 1) * country.messageCreditPrice;

  const statement = await ListenerStatementRepository.create({
    statementId: generateStatementId(),
    user: message.user || undefined,
    type: "Message",
    sourceModel: "Message",
    sourceId: message._id,
    msisdn: message.msisdn || "",
    station: station._id,
    stationRef: station.stationCode,
    mediaStation: station.name,
    show: show?._id,
    showName: show?.name,
    amount,
    currency: country.currency,
    currencySymbol: country.currencySymbol,
    creditsUsed: message.creditsUsed || 1,
    country: country._id,
    operator: message.operator,
    ticket: generateTicket(),
    status: "Successful",
  });

  return statement;
};

const createStatementFromCall = async (_callId: string) => {
  // Placeholder for when call module is implemented
  // Will follow the same pattern as createStatementFromMessage
  // using country.callCreditPrice instead of messageCreditPrice
  return null;
};

const buildScopeFilter = (
  scope?: { partnerId?: string; stationId?: string; userId?: string; role?: string },
): Record<string, unknown> => {
  if (!scope) return {};

  if (scope.role === "user" && scope.userId) {
    return { user: scope.userId };
  }

  if (scope.role === "station_admin" && scope.stationId) {
    return { station: scope.stationId };
  }

  if (scope.role === "partner_admin" && scope.partnerId) {
    // Partner admin sees statements from all stations under their partner
    // This requires a $lookup or pre-filtered station list
    // For now, return empty (super_admin handles partner scoping via frontend)
    return {};
  }

  return {};
};

const getAllStatements = async (
  query: Record<string, unknown>,
  scope?: { partnerId?: string; stationId?: string; userId?: string; role?: string },
) => {
  const filter: Record<string, unknown> = {};

  // Apply role-based scope
  const scopeFilter = buildScopeFilter(scope);
  Object.assign(filter, scopeFilter);

  // Type filter (Call or Message) — CRITICAL
  if (query.type) {
    filter.type = query.type;
  }

  // Station filter
  if (query.station) {
    filter.station = query.station;
  }

  // Country filter
  if (query.country) {
    filter.country = query.country;
  }

  // Date range filter
  if (query.startDate || query.endDate) {
    const dateFilter: Record<string, Date> = {};
    if (query.startDate) dateFilter.$gte = new Date(query.startDate as string);
    if (query.endDate) dateFilter.$lte = new Date(query.endDate as string);
    filter.createdAt = dateFilter;
  }

  // Search by msisdn or stationRef
  if (query.search) {
    const searchRegex = new RegExp(query.search as string, "i");
    filter.$or = [
      { msisdn: searchRegex },
      { stationRef: searchRegex },
      { mediaStation: searchRegex },
    ];
  }

  const page = Math.max(1, Number(query.page) || 1);
  const limit = Math.max(1, Math.min(100, Number(query.limit) || 20));
  const skip = (page - 1) * limit;

  const [statements, total] = await Promise.all([
    ListenerStatementRepository.findAll(filter, { skip, limit }),
    ListenerStatementRepository.count(filter),
  ]);

  return {
    statements,
    meta: { page, limit, total, totalPage: Math.ceil(total / limit) },
  };
};

const getStatementById = async (id: string) => {
  const statement = await ListenerStatementRepository.findById(id);
  if (!statement) {
    throw new AppError(StatusCodes.NOT_FOUND, "Statement not found");
  }
  return statement;
};

const getKPIs = async (
  query: Record<string, unknown>,
  scope?: { partnerId?: string; stationId?: string; userId?: string; role?: string },
) => {
  const filter: Record<string, unknown> = {};

  const scopeFilter = buildScopeFilter(scope);
  Object.assign(filter, scopeFilter);

  if (query.station) {
    filter.station = query.station;
  }

  if (query.startDate || query.endDate) {
    const dateFilter: Record<string, Date> = {};
    if (query.startDate) dateFilter.$gte = new Date(query.startDate as string);
    if (query.endDate) dateFilter.$lte = new Date(query.endDate as string);
    filter.createdAt = dateFilter;
  }

  return ListenerStatementRepository.getAggregation(filter);
};

export const ListenerStatementService = {
  createStatementFromMessage,
  createStatementFromCall,
  getAllStatements,
  getStatementById,
  getKPIs,
};
