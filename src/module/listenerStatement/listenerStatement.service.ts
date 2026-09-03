import crypto from "crypto";
import { StatusCodes } from "http-status-codes";
import AppError from "../../errors/AppError";
import { ListenerStatementRepository } from "./listenerStatement.repository";
import { MessageRepository } from "../message/message.repository";
import Call from "../call/call.model";
import { User } from "../user/user.model";
import { StationRepository } from "../station/station.repository";
import { ShowRepository } from "../show/show.repository";
import { Country } from "../country/country.model";
import { maskMsisdn, shouldMaskMsisdn } from "../../shared/maskMsisdn";
import { CarrierService } from "../../shared/telecom/carrier.service";

const generateTicket = (): string => {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  const randomValues = new Uint8Array(12);
  crypto.getRandomValues(randomValues);
  let result = "";
  for (let i = 0; i < 12; i++) {
    const randomValue = randomValues[i] ?? 0;
    result += chars[randomValue % chars.length];
  }
  return `TKT-${result}`;
};

const createStatementFromMessage = async (messageId: string, isFree: boolean = false) => {
  const message = await MessageRepository.findMessageById(messageId);
  if (!message) return;
  if (message.senderType !== "user") return;

  // Idempotency check: skip if statement already exists for this message
  const existing = await ListenerStatementRepository.findOne({ sourceId: message._id });
  if (existing) return existing;

  const station = await StationRepository.findById((message as any).station?._id?.toString() || (message as any).station?.toString());
  if (!station) return;

  const country = await Country.findById(station.country).lean();
  if (!country) return;

  const show = message.show
    ? await ShowRepository.findById((message as any).show?._id?.toString() || (message as any).show?.toString())
    : null;

  const amount = isFree ? 0 : (message.creditsUsed || 1) * country.messageCreditPrice;

  const statement = await ListenerStatementRepository.create({
    user: (message.user as any)?._id?.toString() || (message.user as any)?.toString() || undefined,
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
    operator: message.operator || CarrierService.detectOperator(message.msisdn, country.code || "UG") || undefined,
    ticket: generateTicket(),
    isFree,
    status: "Successful",
  });

  return statement;
};

const createStatementFromCall = async (callId: string, isFree: boolean = false) => {
  const call = await Call.findById(callId);
  if (!call) return;

  // Idempotency check: skip if statement already exists for this call
  const existing = await ListenerStatementRepository.findOne({ sourceId: call._id });
  if (existing) return existing;

  const station = await StationRepository.findById((call as any).station?._id?.toString() || (call as any).station?.toString());
  if (!station) return;

  const country = await Country.findById(station.country).lean();
  if (!country) return;

  const show = call.show
    ? await ShowRepository.findById((call as any).show?._id?.toString() || (call as any).show?.toString())
    : null;

  const amount = isFree ? 0 : (call.creditsUsed || 1) * country.callCreditPrice;

  const caller = await User.findById(call.startedBy).select("phone").lean();

  const statement = await ListenerStatementRepository.create({
    user: call.startedBy,
    type: "Call",
    sourceModel: "Call",
    sourceId: call._id,
    msisdn: caller?.phone || "",
    station: station._id,
    stationRef: station.stationCode,
    mediaStation: station.name,
    show: show?._id,
    showName: show?.name,
    amount,
    currency: country.currency,
    currencySymbol: country.currencySymbol,
    creditsUsed: call.creditsUsed || 1,
    country: country._id,
    operator: call.operator || CarrierService.detectOperator(caller?.phone, country.code || "UG") || undefined,
    ticket: generateTicket(),
    isFree,
    status: "Successful",
  });

  return statement;
};

// ─── Shared scope resolution helpers ──────────────────────────────────────────

type Scope = { partnerId?: string; stationId?: string; userId?: string; role?: string };

/**
 * Build base scope filter from role (handles _partnerFilter / _presenterFilter placeholders).
 */
const buildScopeFilter = (scope?: Scope): Record<string, unknown> => {
  if (!scope) return {};

  if (scope.role === "user" && scope.userId) {
    return { user: scope.userId };
  }

  if (scope.role === "station_admin" && scope.stationId) {
    return { station: scope.stationId };
  }

  if (scope.role === "partner_admin" && scope.partnerId) {
    return { _partnerFilter: scope.partnerId };
  }

  if (scope.role === "presenter" && scope.userId) {
    return { _presenterFilter: scope.userId };
  }

  if (["station_admin", "media_station", "customer_care"].includes(scope.role || "") && scope.stationId) {
    return { station: scope.stationId };
  }

  return {};
};

/**
 * Resolve _partnerFilter and _presenterFilter placeholders into real MongoDB filters.
 * Returns null with early-exit result if no stations/shows found.
 */
const resolveScopeFilters = async (
  filter: Record<string, unknown>,
): Promise<{ ok: true } | { ok: false; result: any }> => {
  if (filter._partnerFilter) {
    const partnerId = filter._partnerFilter as string;
    delete filter._partnerFilter;
    const partnerStations = await StationRepository.findAll(
      { partner: partnerId },
      { limit: 1000 },
    );
    const stationIds = partnerStations.map((s) => s._id);
    if (stationIds.length === 0) {
      return { ok: false, result: { statements: [], meta: { page: 1, limit: 20, total: 0, totalPage: 0 } } };
    }
    filter.station = { $in: stationIds };
  }

  if (filter._presenterFilter) {
    const presenterId = filter._presenterFilter as string;
    delete filter._presenterFilter;
    const presenterShows = await ShowRepository.findByPresenter(presenterId);
    const showIds = presenterShows.map((s) => s._id);
    if (showIds.length === 0) {
      return { ok: false, result: { statements: [], meta: { page: 1, limit: 20, total: 0, totalPage: 0 } } };
    }
    filter.show = { $in: showIds };
  }

  return { ok: true };
};

/**
 * Validate a station query param against the caller's scope, setting filter.station if allowed.
 */
const validateStationFilter = async (
  filter: Record<string, unknown>,
  query: Record<string, unknown>,
  scope?: Scope,
) => {
  if (!query.station) return;
  const requestedStation = query.station as string;
  const role = scope?.role;

  if (role === "super_admin" || role === "user") {
    filter.station = requestedStation;
  } else if (role === "station_admin" || role === "media_station") {
    if (scope?.stationId && requestedStation === scope.stationId) {
      filter.station = requestedStation;
    }
  } else if (role === "partner_admin" && scope?.partnerId) {
    const partnerStations = await StationRepository.findAll(
      { partner: scope.partnerId },
      { limit: 1000 },
    );
    const partnerStationIds = partnerStations.map((s) => s._id.toString());
    if (partnerStationIds.includes(requestedStation)) {
      filter.station = requestedStation;
    }
  } else if (role === "presenter" && scope?.userId) {
    const presenterShows = await ShowRepository.findByPresenter(scope.userId);
    const presenterStationIds = presenterShows.map((s) => (s.station as any)?._id?.toString() || (s.station as any)?.toString());
    if (presenterStationIds.includes(requestedStation)) {
      filter.station = requestedStation;
    }
  } else if (role === "customer_care" && scope?.stationId) {
    if (requestedStation === scope.stationId) {
      filter.station = requestedStation;
    }
  }
};

/**
 * Apply common query filters (type, isFree, date range, search) to a filter object.
 */
const applyQueryFilters = (
  filter: Record<string, unknown>,
  query: Record<string, unknown>,
) => {
  if (query.userId) filter.user = query.userId;
  if (query.type) filter.type = query.type;
  if (query.isFree !== undefined) filter.isFree = query.isFree === "true";
  if (query.country) filter.country = query.country;

  if (query.startDate || query.endDate) {
    const dateFilter: Record<string, Date> = {};
    if (query.startDate) dateFilter.$gte = new Date(query.startDate as string);
    if (query.endDate) dateFilter.$lte = new Date(query.endDate as string);
    filter.createdAt = dateFilter;
  }

  if (query.search) {
    const escaped = (query.search as string).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const searchRegex = new RegExp(escaped, "i");
    filter.$or = [
      { msisdn: searchRegex },
      { stationRef: searchRegex },
      { mediaStation: searchRegex },
      { ticket: searchRegex },
    ];
  }
};

// ─── Service methods ──────────────────────────────────────────────────────────

const getAllStatements = async (
  query: Record<string, unknown>,
  scope?: Scope,
) => {
  const filter: Record<string, unknown> = {};

  // Apply role-based scope
  Object.assign(filter, buildScopeFilter(scope));

  // Resolve placeholder filters
  const resolved = await resolveScopeFilters(filter);
  if (!resolved.ok) return resolved.result;

  // Validate station filter
  await validateStationFilter(filter, query, scope);

  // Apply query filters
  applyQueryFilters(filter, query);

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

const getStatementById = async (
  id: string,
  scope?: { partnerId?: string; stationId?: string; userId?: string; role?: string },
) => {
  const statement = await ListenerStatementRepository.findById(id);
  if (!statement) {
    throw new AppError(StatusCodes.NOT_FOUND, "Statement not found");
  }

  // Authorization: users can only view their own statements
  if (scope?.role === "user" && scope.userId) {
    const statementUserId = (statement as any).user?.toString() || (statement as any).user;
    if (statementUserId !== scope.userId) {
      throw new AppError(StatusCodes.FORBIDDEN, "You can only view your own statements.");
    }
  }

  // Station admin can only view their station's statements
  if (scope?.role === "station_admin" && scope.stationId) {
    const statementStationId = (statement as any).station?._id?.toString() || (statement as any).station?.toString();
    if (statementStationId !== scope.stationId) {
      throw new AppError(StatusCodes.FORBIDDEN, "You can only view statements from your station.");
    }
  }

  return statement;
};

const getKPIs = async (
  query: Record<string, unknown>,
  scope?: Scope,
) => {
  const filter: Record<string, unknown> = {};

  Object.assign(filter, buildScopeFilter(scope));

  const resolved = await resolveScopeFilters(filter);
  if (!resolved.ok) {
    return { totalInteractions: 0, totalMessages: 0, totalCalls: 0, totalRevenue: 0 };
  }

  await validateStationFilter(filter, query, scope);

  if (query.startDate || query.endDate) {
    const dateFilter: Record<string, Date> = {};
    if (query.startDate) dateFilter.$gte = new Date(query.startDate as string);
    if (query.endDate) dateFilter.$lte = new Date(query.endDate as string);
    filter.createdAt = dateFilter;
  }

  // isFree handled in aggregation $group stage — not as $match
  // so counts include all interactions, revenue only counts paid ones

  return ListenerStatementRepository.getAggregation(filter);
};

const exportStatements = async (
  query: Record<string, unknown>,
  scope?: Scope,
  format: string = "csv",
  callerRole?: string,
) => {
  const filter: Record<string, unknown> = {};

  Object.assign(filter, buildScopeFilter(scope));

  const resolved = await resolveScopeFilters(filter);
  if (!resolved.ok) return { format, data: [] };

  applyQueryFilters(filter, query);

  const statements = await ListenerStatementRepository.findAll(filter, { limit: 10000 });

  const shouldMask = callerRole ? shouldMaskMsisdn(callerRole) : false;

  if (format === "csv") {
    const header = "Type,MSISDN,Station,Show,Amount,Currency,Credit Source,Ticket,Status,Created\n";
    const csv = statements.map((s: any) =>
      `"${s.type}","${shouldMask ? maskMsisdn(s.msisdn || "") : s.msisdn}","${s.mediaStation}","${s.showName || ""}","${s.amount}","${s.currency}","${s.isFree ? "Free" : "Paid"}","${s.ticket}","${s.status}","${s.createdAt}"`
    ).join("\n");
    return { format: "csv", data: header + csv };
  }

  return { format: "json", data: statements };
};

const syncFreeListenerStatements = async () => {
  try {
    const { CreditTransaction } = await import("../creditTransaction/creditTransaction.model");
    const { CreditBalance } = await import("../creditBalance/creditBalance.model");
    const { default: ListenerStatement } = await import("./listenerStatement.model");

    // 1. Find all users who received admin grants (isFree: true)
    const adminGrantTxs = await CreditTransaction.find({
      type: "admin_grant",
      isFree: true,
    }).select("user").lean();

    const freeUserIds = Array.from(new Set(adminGrantTxs.map((t: any) => t.user?.toString()).filter(Boolean)));

    for (const userId of freeUserIds) {
      // Check if user has paid purchases
      const hasPaidPurchase = await CreditTransaction.exists({
        user: userId,
        type: "purchase",
        isFree: false,
      });

      if (!hasPaidPurchase) {
        // User only has free admin credits! Ensure freeBalance is set and paidBalance is reset to 0
        const balanceDoc = await CreditBalance.findOne({ user: userId }).lean();
        if (balanceDoc) {
          const currentBalance = balanceDoc.balance ?? 0;
          await CreditBalance.updateOne(
            { user: userId },
            { $set: { freeBalance: currentBalance, paidBalance: 0 } },
          );
        }

        // Update all deduction transactions for this user
        await CreditTransaction.updateMany(
          { user: userId, type: { $in: ["message_deduction", "call_deduction"] } },
          { $set: { isFree: true, localAmount: 0 } },
        );

        // Update all listener statements for this user
        const res = await ListenerStatement.updateMany(
          { user: userId },
          { $set: { isFree: true, amount: 0 } },
        );

        if (res.modifiedCount > 0) {
          console.log(`[syncFreeListenerStatements] Updated ${res.modifiedCount} statement(s) for free user ${userId} to isFree: true, amount: 0`);
        }
      }
    }
  } catch (err) {
    console.error("[syncFreeListenerStatements] Error syncing free listener statements:", err);
  }
};

export const ListenerStatementService = {
  createStatementFromMessage,
  createStatementFromCall,
  getAllStatements,
  getStatementById,
  getKPIs,
  exportStatements,
  syncFreeListenerStatements,
};
