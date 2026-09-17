import mongoose from "mongoose";
import { Partner } from "../partner/partner.model";
import { Station } from "../station/station.model";
import { Show } from "../show/show.model";
import { User } from "../user/user.model";
import { Auth } from "../auth/auth.model";
import Message from "../message/message.model";
import Call from "../call/call.model";
import { Follow } from "../follow/follow.model";
import { Status } from "../status/status.model";
import { CreditTransaction } from "../creditTransaction/creditTransaction.model";
import ListenerStatement from "../listenerStatement/listenerStatement.model";
import { ChallengeParticipation } from "../challengeParticipation/challengeParticipation.model";
import { Challenge } from "../challenge/challenge.model";
import { DashboardCache } from "./dashboard.cacheManage";

/**
 * Resolve station IDs or filter criteria based on scope (stationId, partnerId, country).
 */
const resolveScopeStationFilter = async (scope?: { partnerId?: string; stationId?: string; country?: string }) => {
  if (scope?.stationId && mongoose.Types.ObjectId.isValid(scope.stationId)) {
    return { station: new mongoose.Types.ObjectId(scope.stationId) };
  }
  if (scope?.partnerId && mongoose.Types.ObjectId.isValid(scope.partnerId)) {
    const stations = await Station.find({ partner: scope.partnerId }).select("_id").lean();
    return { station: { $in: stations.map((s) => s._id) } };
  }
  if (scope?.country) {
    const isObjId = mongoose.Types.ObjectId.isValid(scope.country);
    const filter: Record<string, unknown> = isObjId
      ? { country: new mongoose.Types.ObjectId(scope.country) }
      : { countryName: scope.country };
    const stations = await Station.find(filter).select("_id").lean();
    return { station: { $in: stations.map((s) => s._id) } };
  }
  return {};
};

const resolvePartnerStationIds = async (partnerId?: string): Promise<mongoose.Types.ObjectId[]> => {
  if (!partnerId) return [];
  const partnerStations = await Station.find({ partner: partnerId }).select("_id").lean();
  return partnerStations.map((s) => s._id);
};

/**
 * Resolve date range filter criteria based on preset strings.
 */
const resolveDateRangeFilter = (
  dateRange?: string,
  dateField: string = "createdAt",
  startDate?: string,
  endDate?: string,
) => {
  if (startDate || endDate) {
    const range: Record<string, unknown> = {};
    if (startDate) {
      range.$gte = new Date(startDate);
    }
    if (endDate) {
      const end = new Date(endDate);
      end.setHours(23, 59, 59, 999);
      range.$lte = end;
    }
    return { [dateField]: range };
  }
  if (!dateRange) return {};
  const now = new Date();
  let start: Date;
  if (dateRange === "today") {
    start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  } else if (dateRange === "7days") {
    start = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  } else if (dateRange === "30days") {
    start = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  } else if (dateRange === "90days") {
    start = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
  } else if (dateRange === "month") {
    start = new Date(now.getFullYear(), now.getMonth(), 1);
  } else if (dateRange === "quarter") {
    const currentQuarterMonth = Math.floor(now.getMonth() / 3) * 3;
    start = new Date(now.getFullYear(), currentQuarterMonth, 1);
  } else if (dateRange === "year") {
    start = new Date(now.getFullYear(), 0, 1);
  } else {
    return {};
  }
  return { [dateField]: { $gte: start, $lte: now } };
};

/**
 * Helper: safely get first element from aggregation result
 */
const aggFirst = <T = any>(result: any[]): T | null => {
  return result?.length > 0 ? (result[0] as T) : null;
};

/**
 * Helper: safely get a number from aggregation
 */
const aggNum = (result: any[], field: string, fallback = 0): number => {
  const first = aggFirst(result);
  return first && typeof first[field] === "number" ? first[field] : fallback;
};

/**
 * Helper: get period boundaries for cash flow
 */
const getPeriodBoundaries = () => {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfYesterday = new Date(startOfToday);
  startOfYesterday.setDate(startOfYesterday.getDate() - 1);

  // This week: Monday of current week
  const dayOfWeek = now.getDay();
  const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  const startOfThisWeek = new Date(startOfToday);
  startOfThisWeek.setDate(startOfThisWeek.getDate() + mondayOffset);

  const startOfLastWeek = new Date(startOfThisWeek);
  startOfLastWeek.setDate(startOfLastWeek.getDate() - 7);
  const endOfLastWeek = new Date(startOfThisWeek);
  endOfLastWeek.setMilliseconds(endOfLastWeek.getMilliseconds() - 1);

  const startOfThisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const endOfLastMonth = new Date(startOfThisMonth);
  endOfLastMonth.setMilliseconds(endOfLastMonth.getMilliseconds() - 1);

  return {
    today: { start: startOfToday, end: now },
    yesterday: { start: startOfYesterday, end: startOfToday },
    thisWeek: { start: startOfThisWeek, end: now },
    lastWeek: { start: startOfLastWeek, end: endOfLastWeek },
    thisMonth: { start: startOfThisMonth, end: now },
    lastMonth: { start: startOfLastMonth, end: endOfLastMonth },
  };
};

/**
 * Helper: sum credit transactions for a period, scoped
 */
const sumCreditsForPeriod = async (
  start: Date,
  end: Date,
  scope?: { partnerId?: string; stationId?: string; country?: string },
  type?: "collection" | "disbursement",
): Promise<number> => {
  try {
    const matchFilter: Record<string, any> = {
      createdAt: { $gte: start, $lte: end },
      status: "completed",
    };

    if (type === "collection") {
      matchFilter.type = { $in: ["purchase", "admin_grant"] };
    } else if (type === "disbursement") {
      matchFilter.type = { $in: ["message_deduction", "call_deduction"] };
    }

    if (scope?.stationId && mongoose.Types.ObjectId.isValid(scope.stationId)) {
      const stationUsers = await User.find({ stationId: scope.stationId }).select("_id").lean();
      matchFilter.user = { $in: stationUsers.map((u: any) => u._id) };
    } else if (scope?.partnerId && mongoose.Types.ObjectId.isValid(scope.partnerId)) {
      const partnerStations = await Station.find({ partner: scope.partnerId }).select("country").lean();
      const countryIds = [...new Set(partnerStations.map((s: any) => s.country?.toString()).filter(Boolean))];
      if (countryIds.length > 0) {
        matchFilter.country = { $in: countryIds.map((c) => new mongoose.Types.ObjectId(c)) };
      }
    }

    const result = await CreditTransaction.aggregate([
      { $match: matchFilter },
      { $group: { _id: null, total: { $sum: { $abs: "$localAmount" } } } },
    ]);
    return aggNum(result, "total");
  } catch (err) {
    console.error(`[Dashboard] Failed to sum credits for period ${start.toISOString()}-${end.toISOString()}:`, err);
    return 0;
  }
};

/**
 * Helper: calculate percent change between two values
 */
const pctChange = (current: number, previous: number): number => {
  if (previous === 0) return current > 0 ? 100 : 0;
  return Number(((current - previous) / previous * 100).toFixed(1));
};

const getStats = async (
  scope?: {
    partnerId?: string;
    stationId?: string;
    country?: string;
    role?: string;
    dateRange?: string;
    startDate?: string;
    endDate?: string;
  },
  period?: string,
  timezone?: string,
) => {
  const role = scope?.role;

  // ─── Cache check ───────────────────────────────────────────────
  const cacheScopeId =
    (role === "station_admin" || role === "media_station" || role === "presenter") ? scope?.stationId
    : (role === "partner_admin" || role === "customer_care") ? scope?.partnerId
    : "global";
  const cacheRole = role || "super_admin";

  const cached = await DashboardCache.getStats(cacheRole, cacheScopeId || "global");
  if (cached) return cached;

  // Build filters based on role scope
  const partnerFilter: Record<string, unknown> = {};
  const stationFilter: Record<string, unknown> = {};
  const userFilter: Record<string, unknown> = {};
  const messageFilter: Record<string, unknown> = {};
  const callFilter: Record<string, unknown> = {};

  if (role === "station_admin" || role === "media_station" || role === "presenter") {
    if (scope?.stationId) {
      const sid = new mongoose.Types.ObjectId(scope.stationId);
      stationFilter._id = sid;
      messageFilter.station = sid;
      callFilter.station = sid;
      userFilter.stationId = scope.stationId;
    }
  } else if (role === "partner_admin" || role === "customer_care") {
    if (scope?.partnerId) {
      partnerFilter._id = scope.partnerId;
      stationFilter.partner = scope.partnerId;
      const stationIds = await resolvePartnerStationIds(scope.partnerId);
      if (scope?.stationId && stationIds.some((id) => id.toString() === scope.stationId)) {
        const sid = new mongoose.Types.ObjectId(scope.stationId);
        stationFilter._id = sid;
        messageFilter.station = sid;
        callFilter.station = sid;
        userFilter.stationId = scope.stationId;
      } else {
        messageFilter.station = { $in: stationIds };
        callFilter.station = { $in: stationIds };
        userFilter.stationId = { $in: stationIds.map((id) => id.toString()) };
      }
    }
  } else if (scope?.stationId || scope?.partnerId || scope?.country) {
    const stationMatch = await resolveScopeStationFilter(scope);
    if (stationMatch.station) {
      messageFilter.station = stationMatch.station;
      callFilter.station = stationMatch.station;
    }

    if (scope?.country) {
      const isObjId = mongoose.Types.ObjectId.isValid(scope.country);
      if (isObjId) {
        const countryOid = new mongoose.Types.ObjectId(scope.country);
        stationFilter.country = countryOid;
        userFilter.countryId = countryOid;
        partnerFilter.country = countryOid;
      }
    }
    if (scope?.partnerId && mongoose.Types.ObjectId.isValid(scope.partnerId)) {
      const pid = new mongoose.Types.ObjectId(scope.partnerId);
      stationFilter.partner = pid;
      userFilter.partnerId = pid;
      partnerFilter._id = pid;
    }
    if (scope?.stationId && mongoose.Types.ObjectId.isValid(scope.stationId)) {
      const sid = new mongoose.Types.ObjectId(scope.stationId);
      stationFilter._id = sid;
      userFilter.stationId = scope.stationId;
    }
  }

  const dateFilterMsg = resolveDateRangeFilter(scope?.dateRange, "createdAt", scope?.startDate, scope?.endDate);
  const dateFilterCall = resolveDateRangeFilter(scope?.dateRange, "startedAt", scope?.startDate, scope?.endDate);
  Object.assign(messageFilter, dateFilterMsg);
  Object.assign(callFilter, dateFilterCall);

  // Build show filter
  const showFilter: Record<string, unknown> = { isActive: true };
  if (role === "station_admin" || role === "media_station" || role === "presenter") {
    if (scope?.stationId) {
      showFilter.station = new mongoose.Types.ObjectId(scope.stationId);
    }
  } else if (role === "partner_admin" || role === "customer_care") {
    if (scope?.partnerId) {
      const stationIds = await resolvePartnerStationIds(scope.partnerId);
      if (scope?.stationId && stationIds.some((id) => id.toString() === scope.stationId)) {
        showFilter.station = new mongoose.Types.ObjectId(scope.stationId);
      } else {
        showFilter.station = { $in: stationIds };
      }
    }
  } else if (scope?.stationId) {
    showFilter.station = new mongoose.Types.ObjectId(scope.stationId);
  }

  // ─── Build listener count promises (role-scoped) ───────────────
  const deductionTypes = ["message_deduction", "call_deduction", "poll_deduction", "challenge_deduction"];
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  // Shared partner country lookup (avoid duplicate queries)
  const partnerCountryPromise = (role === "partner_admin" || role === "customer_care") && scope?.partnerId
    ? Partner.findById(scope.partnerId).select("country").lean()
    : Promise.resolve(null);

  let listenerCountPromise: Promise<number>;
  let activeListenersPromise: Promise<number>;

  if ((role === "station_admin" || role === "media_station" || role === "presenter") && scope?.stationId) {
    // Station-scoped: count users from Message, Call, Follow, CreditTransaction
    const sid = new mongoose.Types.ObjectId(scope.stationId);

    listenerCountPromise = Promise.all([
      Message.distinct("user", { station: sid, senderType: "user", isDeleted: { $ne: true } }),
      Call.distinct("startedBy", { station: sid }),
      Follow.distinct("user", { station: sid }),
      CreditTransaction.distinct("user", { station: sid, type: { $in: deductionTypes } }),
    ]).then(([msg, call, follow, credit]) => {
      return new Set([...msg, ...call, ...follow, ...credit].filter(Boolean)).size;
    }).catch(() => 0);

    // Active: same sources but with 7-day time filter
    activeListenersPromise = Promise.all([
      Message.distinct("user", { station: sid, senderType: "user", isDeleted: { $ne: true }, createdAt: { $gte: sevenDaysAgo } }),
      Call.distinct("startedBy", { station: sid, startedAt: { $gte: sevenDaysAgo } }),
      Follow.distinct("user", { station: sid }),
      CreditTransaction.distinct("user", { station: sid, type: { $in: deductionTypes }, createdAt: { $gte: sevenDaysAgo } }),
    ]).then(([msg, call, follow, credit]) => {
      return new Set([...msg, ...call, ...follow, ...credit].filter(Boolean)).size;
    }).catch(() => 0);

  } else if ((role === "partner_admin" || role === "customer_care") && scope?.partnerId) {
    // Partner-country scoped
    listenerCountPromise = partnerCountryPromise.then(async (partner) => {
      if (!partner?.country) return 0;
      return User.countDocuments({ countryId: partner.country, role: "user" });
    }).catch(() => 0);

    activeListenersPromise = partnerCountryPromise.then(async (partner) => {
      if (!partner?.country) return 0;
      const countryUsers = await User.find({ countryId: partner.country, role: "user" }).select("_id").lean();
      if (countryUsers.length === 0) return 0;
      return Auth.countDocuments({
        _id: { $in: countryUsers.map((u) => u._id) },
        lastLogin: { $gte: sevenDaysAgo },
      });
    }).catch(() => 0);

  } else {
    // Super admin or unscoped: count all listeners
    listenerCountPromise = User.countDocuments({ role: "user" }).catch(() => 0);
    activeListenersPromise = Auth.countDocuments({ role: "user", lastLogin: { $gte: sevenDaysAgo } }).catch(() => 0);
  }

  // ─── Core stats queries ───────────────────────────────────────────────
  const [
    totalPartners,
    activePartners,
    totalStations,
    activeStations,
    totalUsers,
    totalListeners,
    totalMessages,
    totalCalls,
    activeShows,
    revenueResult,
    activeListeners,
  ] = await Promise.all([
    Partner.countDocuments(partnerFilter).catch(() => 0),
    Partner.countDocuments({ ...partnerFilter, isActive: true }).catch(() => 0),
    Station.countDocuments(stationFilter).catch(() => 0),
    Station.countDocuments({ ...stationFilter, isActive: true }).catch(() => 0),
    User.countDocuments(userFilter).catch(() => 0),
    listenerCountPromise,
    Message.countDocuments({ ...messageFilter, senderType: "user", isDeleted: { $ne: true } }).catch(() => 0),
    Call.countDocuments(callFilter).catch(() => 0),
    Show.countDocuments(showFilter).catch(() => 0),
    ListenerStatement.aggregate([
      { $match: { ...messageFilter, isFree: { $ne: true } } },
      { $group: { _id: null, total: { $sum: "$amount" } } },
    ]).catch(() => []),
    activeListenersPromise,
  ]);

  // ─── Hourly Transactions (today's credit transactions by hour) ──────
  let hourlyTransactions: { hour: number; collections: number; disbursements: number }[] = [];
  try {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const hourlyMatchFilter: Record<string, any> = {
      createdAt: { $gte: startOfToday, $lte: new Date() },
      status: "completed",
    };
    if (scope?.stationId && mongoose.Types.ObjectId.isValid(scope.stationId)) {
      const stationUsers = await User.find({ stationId: scope.stationId }).select("_id").lean();
      hourlyMatchFilter.user = { $in: stationUsers.map((u: any) => u._id) };
    } else if (scope?.partnerId && mongoose.Types.ObjectId.isValid(scope.partnerId)) {
      const partnerStations = await Station.find({ partner: scope.partnerId }).select("country").lean();
      const countryIds = [...new Set(partnerStations.map((s: any) => s.country?.toString()).filter(Boolean))];
      if (countryIds.length > 0) {
        hourlyMatchFilter.country = { $in: countryIds.map((c) => new mongoose.Types.ObjectId(c)) };
      }
    }

    const hourlyResult = await CreditTransaction.aggregate([
      { $match: hourlyMatchFilter },
      {
        $group: {
          _id: {
            hour: { $hour: { date: "$createdAt", timezone: timezone || "UTC" } },
            type: {
              $cond: [
                { $in: ["$type", ["purchase", "admin_grant"]] },
                "collection",
                "disbursement",
              ],
            },
          },
          total: { $sum: { $abs: "$localAmount" } },
        },
      },
    ]);

    // Build 24-hour map
    const hourMap = new Map<number, { collections: number; disbursements: number }>();
    for (let h = 0; h < 24; h++) {
      hourMap.set(h, { collections: 0, disbursements: 0 });
    }
    for (const row of hourlyResult) {
      const hour = row._id?.hour ?? 0;
      const existing = hourMap.get(hour) || { collections: 0, disbursements: 0 };
      if (row._id?.type === "collection") {
        existing.collections += row.total || 0;
      } else {
        existing.disbursements += row.total || 0;
      }
      hourMap.set(hour, existing);
    }
    hourlyTransactions = Array.from(hourMap.entries()).map(([hour, data]) => ({
      hour,
      collections: data.collections,
      disbursements: data.disbursements,
    }));
  } catch (err) {
    console.error("[Dashboard] Failed to calculate hourlyTransactions:", err);
  }

  // ─── Cash Flow Summary (6 periods) ──────────────────────────────────
  let cashFlow: Record<string, { amount: number; previousAmount: number; percentChange: number }> = {};
  try {
    const periods = getPeriodBoundaries();
    const periodEntries = await Promise.all(
      Object.entries(periods).map(async ([key, { start, end }]) => {
        const amount = await sumCreditsForPeriod(start, end, scope, "collection");
        // Previous period: same duration before start
        const duration = end.getTime() - start.getTime();
        const prevStart = new Date(start.getTime() - duration);
        const prevEnd = new Date(start.getTime() - 1);
        const previousAmount = await sumCreditsForPeriod(prevStart, prevEnd, scope, "collection");
        return {
          key,
          amount,
          previousAmount,
          percentChange: pctChange(amount, previousAmount),
        };
      }),
    );
    for (const entry of periodEntries) {
      cashFlow[entry.key] = {
        amount: entry.amount,
        previousAmount: entry.previousAmount,
        percentChange: entry.percentChange,
      };
    }
  } catch (err) {
    console.error("[Dashboard] Failed to calculate cashFlow:", err);
  }

  // ─── Daily Collections & Disbursements ──────────────────────────────
  let dailyCollections: { date: string; amount: number }[] = [];
  let dailyDisbursements: { date: string; amount: number }[] = [];
  try {
    const tz = timezone || "UTC";
    const dailyPeriod = period || "week";
    let daysBack = 7;
    if (dailyPeriod === "month") daysBack = 28;
    else if (dailyPeriod === "quarter") daysBack = 90;

    const startDate = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000);

    const dailyMatchFilter: Record<string, any> = {
      createdAt: { $gte: startDate, $lte: new Date() },
      status: "completed",
    };
    if (scope?.stationId && mongoose.Types.ObjectId.isValid(scope.stationId)) {
      const stationUsers = await User.find({ stationId: scope.stationId }).select("_id").lean();
      dailyMatchFilter.user = { $in: stationUsers.map((u: any) => u._id) };
    } else if (scope?.partnerId && mongoose.Types.ObjectId.isValid(scope.partnerId)) {
      const partnerStations = await Station.find({ partner: scope.partnerId }).select("country").lean();
      const countryIds = [...new Set(partnerStations.map((s: any) => s.country?.toString()).filter(Boolean))];
      if (countryIds.length > 0) {
        dailyMatchFilter.country = { $in: countryIds.map((c) => new mongoose.Types.ObjectId(c)) };
      }
    }

    const [collectionsResult, disbursementsResult] = await Promise.all([
      CreditTransaction.aggregate([
        { $match: { ...dailyMatchFilter, type: { $in: ["purchase", "admin_grant"] } } },
        {
          $group: {
            _id: { $dateToString: { format: "%d-%b-%Y", date: "$createdAt", timezone: tz } },
            amount: { $sum: { $abs: "$localAmount" } },
          },
        },
        { $sort: { _id: -1 } },
      ]).catch(() => []),
      CreditTransaction.aggregate([
        { $match: { ...dailyMatchFilter, type: { $in: ["message_deduction", "call_deduction"] } } },
        {
          $group: {
            _id: { $dateToString: { format: "%d-%b-%Y", date: "$createdAt", timezone: tz } },
            amount: { $sum: { $abs: "$localAmount" } },
          },
        },
        { $sort: { _id: -1 } },
      ]).catch(() => []),
    ]);

    dailyCollections = (collectionsResult || []).map((r: any) => ({
      date: r._id,
      amount: r.amount || 0,
    }));
    dailyDisbursements = (disbursementsResult || []).map((r: any) => ({
      date: r._id,
      amount: r.amount || 0,
    }));
  } catch (err) {
    console.error("[Dashboard] Failed to calculate dailyCollections/disbursements:", err);
  }

  const result = {
    totalPartners,
    activePartners,
    totalStations,
    activeStations,
    totalUsers,
    totalListeners,
    totalMessages,
    totalCalls,
    activeShows,
    totalRevenue: aggNum(revenueResult, "total"),
    activeListeners,
    hourlyTransactions,
    cashFlow,
    dailyCollections,
    dailyDisbursements,
  };

  // Cache the result (120s TTL)
  await DashboardCache.setStats(cacheRole, cacheScopeId || "global", result);

  return result;
};

const getMessageActivity = async (
  period: "daily" | "weekly" | "monthly",
  scope?: { partnerId?: string; stationId?: string; country?: string; dateRange?: string; startDate?: string; endDate?: string },
  timezone?: string,
) => {
  const matchFilter: Record<string, unknown> = { senderType: "user", isDeleted: { $ne: true } };
  const scopeFilter = await resolveScopeStationFilter(scope);
  Object.assign(matchFilter, scopeFilter);
  Object.assign(matchFilter, resolveDateRangeFilter(scope?.dateRange, "createdAt", scope?.startDate, scope?.endDate));

  const tz = timezone || "UTC";
  let groupId: Record<string, unknown>;
  if (period === "daily") {
    groupId = { $dateToString: { format: "%Y-%m-%d", date: "$createdAt", timezone: tz } };
  } else if (period === "weekly") {
    groupId = { $dateToString: { format: "%Y-W%V", date: "$createdAt", timezone: tz } };
  } else {
    groupId = { $dateToString: { format: "%Y-%m", date: "$createdAt", timezone: tz } };
  }

  const result = await Message.aggregate([
    { $match: matchFilter },
    { $group: { _id: groupId, count: { $sum: 1 } } },
    { $sort: { _id: 1 } },
    { $limit: 30 },
  ]);

  return result.map((r) => ({ date: r._id, count: r.count }));
};

const getRevenueActivity = async (
  period: "daily" | "weekly" | "monthly" = "monthly",
  scope?: { partnerId?: string; stationId?: string; country?: string; dateRange?: string; startDate?: string; endDate?: string },
  timezone?: string,
) => {
  const matchFilter: Record<string, unknown> = {};
  const scopeFilter = await resolveScopeStationFilter(scope);
  Object.assign(matchFilter, scopeFilter);
  Object.assign(matchFilter, resolveDateRangeFilter(scope?.dateRange, "createdAt", scope?.startDate, scope?.endDate));

  const tz = timezone || "UTC";
  let groupId: Record<string, unknown>;
  if (period === "daily") {
    groupId = { $dateToString: { format: "%Y-%m-%d", date: "$createdAt", timezone: tz } };
  } else if (period === "weekly") {
    groupId = { $dateToString: { format: "%Y-W%V", date: "$createdAt", timezone: tz } };
  } else {
    groupId = { $dateToString: { format: "%Y-%m", date: "$createdAt", timezone: tz } };
  }

  const result = await ListenerStatement.aggregate([
    { $match: matchFilter },
    {
      $group: {
        _id: groupId,
        revenue: {
          $sum: { $cond: [{ $eq: ["$isFree", false] }, { $ifNull: ["$amount", 0] }, 0] },
        },
        credits: {
          $sum: { $ifNull: ["$creditsUsed", 0] },
        },
      },
    },
    { $sort: { _id: 1 } },
    { $limit: 30 },
  ]);

  return result.map((r) => ({
    date: r._id,
    count: r.revenue || 0,
    revenue: r.revenue || 0,
    credits: r.credits || 0,
  }));
};

const getListenerActivity = async (
  period: "daily" | "weekly" | "monthly" = "monthly",
  scope?: { partnerId?: string; stationId?: string; country?: string; dateRange?: string },
  timezone?: string,
) => {
  const matchFilter: Record<string, unknown> = { senderType: "user", isDeleted: { $ne: true } };
  const scopeFilter = await resolveScopeStationFilter(scope);
  Object.assign(matchFilter, scopeFilter);
  Object.assign(matchFilter, resolveDateRangeFilter(scope?.dateRange, "createdAt"));

  const tz = timezone || "UTC";
  let dateFormat: string;
  if (period === "daily") {
    dateFormat = "%Y-%m-%d";
  } else if (period === "weekly") {
    dateFormat = "%Y-W%V";
  } else {
    dateFormat = "%Y-%m";
  }

  const result = await Message.aggregate([
    { $match: matchFilter },
    {
      $group: {
        _id: {
          dateStr: { $dateToString: { format: dateFormat, date: "$createdAt", timezone: tz } },
          sender: { $ifNull: ["$user", "$msisdn"] },
        },
      },
    },
    {
      $group: {
        _id: "$_id.dateStr",
        count: { $sum: 1 },
      },
    },
    { $sort: { _id: 1 } },
    { $limit: 30 },
  ]);

  return result.map((r) => ({ date: r._id, count: r.count }));
};

const getCampaignActivity = async (
  period: "daily" | "weekly" | "monthly" = "monthly",
  scope?: { partnerId?: string; stationId?: string; country?: string; dateRange?: string },
  timezone?: string,
) => {
  const matchFilter: Record<string, unknown> = {};
  const scopeFilter = await resolveScopeStationFilter(scope);
  Object.assign(matchFilter, scopeFilter);
  Object.assign(matchFilter, resolveDateRangeFilter(scope?.dateRange, "createdAt"));

  const tz = timezone || "UTC";
  let dateFormat: string;
  if (period === "daily") {
    dateFormat = "%Y-%m-%d";
  } else if (period === "weekly") {
    dateFormat = "%Y-W%V";
  } else {
    dateFormat = "%Y-%m";
  }

  const result = await Status.aggregate([
    { $match: matchFilter },
    {
      $group: {
        _id: { $dateToString: { format: dateFormat, date: "$createdAt", timezone: tz } },
        count: { $sum: "$viewCount" },
      },
    },
    { $sort: { _id: 1 } },
    { $limit: 30 },
  ]);

  return result.map((r) => ({ date: r._id, count: r.count }));
};

const getStationOverview = async (scope?: { partnerId?: string; stationId?: string; country?: string; dateRange?: string }) => {
  const filter: Record<string, unknown> = {};
  if (scope?.stationId && mongoose.Types.ObjectId.isValid(scope.stationId)) {
    filter._id = new mongoose.Types.ObjectId(scope.stationId);
  } else if (scope?.partnerId && mongoose.Types.ObjectId.isValid(scope.partnerId)) {
    filter.partner = new mongoose.Types.ObjectId(scope.partnerId);
  } else if (scope?.country && mongoose.Types.ObjectId.isValid(scope.country)) {
    filter.country = new mongoose.Types.ObjectId(scope.country);
  }

  const dateMatchMsg = resolveDateRangeFilter(scope?.dateRange, "createdAt");
  const dateMatchCall = resolveDateRangeFilter(scope?.dateRange, "startedAt");
  const now = new Date();

  // Diagnostic logging
  try {
    const rawStatuses = await Status.find({}).select("_id station content viewCount expiresAt createdAt").lean();
    console.log("================== [DASHBOARD DIAGNOSTIC] ==================");
    console.log("[getStationOverview] Scope:", JSON.stringify(scope));
    console.log("[getStationOverview] Station Filter:", JSON.stringify(filter));
    console.log("[getStationOverview] Status.collection.name:", Status.collection.name);
    console.log("[getStationOverview] Total Statuses in DB:", rawStatuses.length);
    rawStatuses.forEach((st, i) => {
      console.log(`  [Status #${i + 1}] ID: ${st._id}, Station: ${st.station} (Type: ${typeof st.station}, IsObjectId: ${st.station instanceof mongoose.Types.ObjectId}), ViewCount: ${st.viewCount}, ExpiresAt: ${st.expiresAt}, IsExpired: ${st.expiresAt ? new Date(st.expiresAt) <= now : 'N/A'}`);
    });
  } catch (err) {
    console.error("[getStationOverview] Diagnostic error:", err);
  }

  // Use aggregation to get stations + counts in a single pipeline (no N+1)
  const overview = await Station.aggregate([
    { $match: filter },
    { $limit: 20 },
    {
      $lookup: {
        from: Show.collection.name,
        localField: "_id",
        foreignField: "station",
        as: "showsDocs",
      },
    },
    {
      $lookup: {
        from: Message.collection.name,
        let: { stationId: "$_id" },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [
                  { $eq: ["$station", "$$stationId"] },
                  { $eq: ["$senderType", "user"] },
                  { $ne: ["$isDeleted", true] },
                ],
              },
              ...dateMatchMsg,
            },
          },
          {
            $group: {
              _id: null,
              total: { $sum: 1 },
              delivered: { $sum: { $cond: [{ $ne: ["$status", "failed"] }, 1, 0] } },
              pending: { $sum: { $cond: [{ $eq: ["$status", "pending"] }, 1, 0] } },
              uniqueSenders: { $addToSet: { $ifNull: ["$user", "$msisdn"] } },
            },
          },
        ],
        as: "messagesResult",
      },
    },
    {
      $lookup: {
        from: Call.collection.name,
        let: { stationId: "$_id" },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [
                  { $eq: ["$station", "$$stationId"] },
                ],
              },
              ...dateMatchCall,
            },
          },
          {
            $group: {
              _id: null,
              total: { $sum: 1 },
              answered: { $sum: { $cond: [{ $in: ["$status", ["answered", "completed"]] }, 1, 0] } },
              missed: { $sum: { $cond: [{ $eq: ["$status", "missed"] }, 1, 0] } },
            },
          },
        ],
        as: "callsResult",
      },
    },
    {
      $lookup: {
        from: Status.collection.name,
        localField: "_id",
        foreignField: "station",
        as: "campaignsDocs",
      },
    },
    {
      $addFields: {
        msgStats: { $arrayElemAt: ["$messagesResult", 0] },
        callStats: { $arrayElemAt: ["$callsResult", 0] },
        activeShowsCount: {
          $size: {
            $filter: {
              input: { $ifNull: ["$showsDocs", []] },
              as: "sh",
              cond: { $eq: ["$$sh.isActive", true] },
            },
          },
        },
        activeCampaigns: {
          $size: {
            $filter: {
              input: { $ifNull: ["$campaignsDocs", []] },
              as: "c",
              cond: { $gt: ["$$c.expiresAt", now] },
            },
          },
        },
        totalCampaignViews: {
          $sum: "$campaignsDocs.viewCount",
        },
      },
    },
    {
      $addFields: {
        stationId: { $toString: "$_id" },
        stationName: "$name",
        country: "",
        activeShows: "$activeShowsCount",
        messagesToday: { $ifNull: ["$msgStats.total", 0] },
        deliveredMessages: { $ifNull: ["$msgStats.delivered", 0] },
        pendingMessages: { $ifNull: ["$msgStats.pending", 0] },
        callsToday: { $ifNull: ["$callStats.total", 0] },
        answeredCalls: { $ifNull: ["$callStats.answered", 0] },
        missedCalls: { $ifNull: ["$callStats.missed", 0] },
        activeListeners: { $size: { $ifNull: ["$msgStats.uniqueSenders", []] } },
        campaignViews: "$totalCampaignViews",
        status: { $cond: ["$isActive", "Active", "Inactive"] },
      },
    },
    {
      $project: {
        showsDocs: 0,
        messagesResult: 0,
        callsResult: 0,
        campaignsDocs: 0,
        msgStats: 0,
        callStats: 0,
        _id: 0,
        name: 0,
        isActive: 0,
      },
    },
  ]);

  console.log("[getStationOverview] Overview Result Stations Count:", overview.length);
  overview.forEach((s: any) => {
    console.log(`  -> Station: ${s.stationName} (ID: ${s.stationId}), ActiveCampaigns: ${s.activeCampaigns}, TotalCampaignViews: ${s.totalCampaignViews}`);
  });
  console.log("============================================================");

  return overview;
};

const getRecentActivity = async (
  limit: number,
  scope?: { partnerId?: string; stationId?: string },
) => {
  const filter: Record<string, unknown> = { senderType: "user", isDeleted: { $ne: true } };
  if (scope?.stationId) {
    filter.station = new mongoose.Types.ObjectId(scope.stationId);
  } else if (scope?.partnerId) {
    const stationIds = await resolvePartnerStationIds(scope.partnerId);
    filter.station = { $in: stationIds };
  }

  const messages = await Message.find(filter)
    .populate("station", "name")
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();

  const messageRows = messages.map((m) => ({
    type: "message",
    description: `New message from ${(m as any).msisdn} at ${(m as any).station?.name || "Unknown"}`,
    timestamp: m.createdAt,
    user: (m as any).msisdn,
  }));

  // Challenge joins (station/partner scoped via challenge.station)
  const challengeFilter: Record<string, unknown> = {};
  if (scope?.stationId && mongoose.Types.ObjectId.isValid(scope.stationId)) {
    challengeFilter.station = new mongoose.Types.ObjectId(scope.stationId);
  } else if (scope?.partnerId) {
    const stationIds = await resolvePartnerStationIds(scope.partnerId);
    challengeFilter.station = { $in: stationIds };
  }

  let challengeRows: {
    type: string;
    description: string;
    timestamp: unknown;
    user: string;
  }[] = [];
  try {
    const challengeIds = Object.keys(challengeFilter).length
      ? (await Challenge.find(challengeFilter).select("_id title station").lean()).map((c: any) => c._id)
      : null;

    const partFilter: Record<string, unknown> = {};
    if (challengeIds !== null) {
      if (challengeIds.length === 0) {
        challengeRows = [];
      } else {
        partFilter.challenge = { $in: challengeIds };
      }
    }

    if (challengeIds === null || challengeIds.length > 0) {
      const parts = await ChallengeParticipation.find(partFilter)
        .populate("challenge", "title station")
        .populate({
          path: "challenge",
          populate: { path: "station", select: "name" },
        })
        .populate("user", "phone msisdn fullName")
        .sort({ submittedAt: -1 })
        .limit(limit)
        .lean();

      challengeRows = parts.map((p: any) => {
        const userLabel = p.user?.phone || p.user?.msisdn || p.user?.fullName || "Listener";
        const stationName = p.challenge?.station?.name || "Unknown";
        return {
          type: "challenge",
          description: `${userLabel} joined challenge "${p.challenge?.title || "Challenge"}" at ${stationName}`,
          timestamp: p.submittedAt || p.createdAt,
          user: userLabel,
        };
      });
    }
  } catch {
    challengeRows = [];
  }

  return [...messageRows, ...challengeRows]
    .sort((a, b) => {
      const ta = a.timestamp ? new Date(a.timestamp as any).getTime() : 0;
      const tb = b.timestamp ? new Date(b.timestamp as any).getTime() : 0;
      return tb - ta;
    })
    .slice(0, limit);
};

const getTopStations = async (
  limit: number,
  scope?: { partnerId?: string; stationId?: string; country?: string; dateRange?: string; startDate?: string; endDate?: string },
) => {
  const matchFilter: Record<string, unknown> = { senderType: "user", isDeleted: { $ne: true } };
  const scopeFilter = await resolveScopeStationFilter(scope);
  Object.assign(matchFilter, scopeFilter);
  Object.assign(matchFilter, resolveDateRangeFilter(scope?.dateRange, "createdAt", scope?.startDate, scope?.endDate));

  const result = await Message.aggregate([
    { $match: matchFilter },
    { $group: { _id: "$station", count: { $sum: 1 } } },
    { $sort: { count: -1 } },
    { $limit: limit },
    { $lookup: { from: "stations", localField: "_id", foreignField: "_id", as: "stationDoc" } },
    { $unwind: { path: "$stationDoc", preserveNullAndEmptyArrays: true } },
  ]);

  return result.map((r) => ({
    stationId: r._id?.toString() || "",
    stationName: r.stationDoc?.name || "Unknown",
    name: r.stationDoc?.name || "Unknown",
    messageCount: r.count,
    messages: r.count,
    score: r.count,
  }));
};

const getTopShows = async (
  limit: number,
  scope?: { partnerId?: string; stationId?: string; country?: string; dateRange?: string; startDate?: string; endDate?: string },
) => {
  const matchFilter: Record<string, unknown> = { senderType: "user", isDeleted: { $ne: true } };
  const scopeFilter = await resolveScopeStationFilter(scope);
  Object.assign(matchFilter, scopeFilter);
  Object.assign(matchFilter, resolveDateRangeFilter(scope?.dateRange, "createdAt", scope?.startDate, scope?.endDate));

  // 1. Group messages by show
  const msgResult = await Message.aggregate([
    { $match: { ...matchFilter, show: { $exists: true, $ne: null } } },
    { $group: { _id: "$show", count: { $sum: 1 } } },
    { $sort: { count: -1 } },
    { $limit: limit },
    { $lookup: { from: "shows", localField: "_id", foreignField: "_id", as: "showDoc" } },
    { $unwind: { path: "$showDoc", preserveNullAndEmptyArrays: true } },
    { $lookup: { from: "users", localField: "showDoc.presenter", foreignField: "_id", as: "presenterDoc" } },
    { $unwind: { path: "$presenterDoc", preserveNullAndEmptyArrays: true } },
  ]);

  if (msgResult.length > 0) {
    return msgResult.map((r) => ({
      showId: r._id?.toString() || "",
      name: r.showDoc?.name || "Live Show",
      showName: r.showDoc?.name || "Live Show",
      presenterName: r.presenterDoc?.fullName || "Unassigned",
      startTime: r.showDoc?.startTime || "",
      endTime: r.showDoc?.endTime || "",
      interactionCount: r.count,
      messages: r.count,
      score: r.count,
    }));
  }

  // Fallback: If no messages tied to specific shows yet, list the station's configured active shows
  const showFilter: Record<string, unknown> = { isActive: true };
  if (scope?.stationId && mongoose.Types.ObjectId.isValid(scope.stationId)) {
    showFilter.station = new mongoose.Types.ObjectId(scope.stationId);
  } else if (scope?.partnerId && mongoose.Types.ObjectId.isValid(scope.partnerId)) {
    const partnerStations = await resolvePartnerStationIds(scope.partnerId);
    showFilter.station = { $in: partnerStations };
  }
  const fallbackShows = await Show.find(showFilter)
    .populate("presenter", "fullName")
    .limit(limit)
    .lean();

  return fallbackShows.map((s: any) => ({
    showId: s._id.toString(),
    name: s.name,
    showName: s.name,
    presenterName: s.presenter?.fullName || "Unassigned",
    startTime: s.startTime || "",
    endTime: s.endTime || "",
    interactionCount: 0,
    messages: 0,
    score: 0,
  }));
};

const getRecentUsers = async (
  limit: number,
  scope?: { partnerId?: string; stationId?: string },
) => {
  const filter: Record<string, unknown> = {};
  if (scope?.stationId) {
    filter.stationId = scope.stationId;
  }

  const users = await User.find(filter)
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();

  const stationIds = [...new Set(users.map((u) => u.stationId?.toString()).filter((id): id is string => Boolean(id)))];
  const stations = await Station.find({ _id: { $in: stationIds } }).select("name").lean();
  const stationMap = new Map(stations.map((s) => [s._id.toString(), s.name]));

  return users.map((u) => {
    const stationName = u.stationId ? stationMap.get(u.stationId.toString()) || "" : "";
    return {
      userId: u._id.toString(),
      id: u._id.toString(),
      name: u.fullName || "",
      fullName: u.fullName || "",
      email: u.email || "",
      role: u.role,
      station: stationName,
      stationName,
      status: u.isBlocked ? "Inactive" : "Active",
      createdAt: u.createdAt,
    };
  });
};

const getCreditStats = async (scope?: { partnerId?: string; stationId?: string }) => {
  // Build user filter based on scope (not station filter, since purchases/admin_grants have no station field)
  const userFilter: Record<string, unknown> = {};
  if (scope?.stationId) {
    const stationUsers = await User.find({ stationId: scope.stationId }).select("_id").lean();
    userFilter.user = { $in: stationUsers.map((u) => u._id) };
  } else if (scope?.partnerId) {
    const partnerStations = await Station.find({ partner: scope.partnerId }).select("country").lean();
    const countryIds = [...new Set(partnerStations.map((s) => s.country?.toString()).filter(Boolean))];
    if (countryIds.length > 0) {
      userFilter.country = { $in: countryIds.map((c) => new mongoose.Types.ObjectId(c)) };
    }
  }

  const result = await CreditTransaction.aggregate([
    { $match: userFilter },
    {
      $group: {
        _id: null,
        creditsPurchased: {
          $sum: { $cond: [{ $eq: ["$type", "purchase"] }, { $abs: "$amount" }, 0] },
        },
        creditsUsed: {
          $sum: {
            $cond: [
              { $in: ["$type", ["message_deduction", "call_deduction"]] },
              { $abs: "$amount" },
              0,
            ],
          },
        },
        successfulTxns: { $sum: { $cond: [{ $eq: ["$status", "completed"] }, 1, 0] } },
        failedTxns: { $sum: { $cond: [{ $eq: ["$status", "failed"] }, 1, 0] } },
        totalRevenue: {
          $sum: {
            $cond: [
              { $and: [{ $eq: ["$type", "message_deduction"] }, { $eq: ["$isFree", false] }] },
              { $abs: "$amount" },
              0,
            ],
          },
        },
      },
    },
  ]);

  if (result.length === 0) {
    return { creditsPurchased: 0, creditsUsed: 0, successfulTxns: 0, failedTxns: 0, totalRevenue: 0 };
  }

  const { creditsPurchased, creditsUsed, successfulTxns, failedTxns, totalRevenue } = result[0];
  return { creditsPurchased, creditsUsed, successfulTxns, failedTxns, totalRevenue };
};

const getCountryRevenue = async (scope?: { partnerId?: string; stationId?: string; country?: string }) => {
  const matchFilter: Record<string, unknown> = { isFree: { $ne: true } };
  const scopeFilter = await resolveScopeStationFilter(scope);
  Object.assign(matchFilter, scopeFilter);

  if (scope?.country && mongoose.Types.ObjectId.isValid(scope.country)) {
    matchFilter.country = new mongoose.Types.ObjectId(scope.country);
  }

  const stationMatch: Record<string, unknown> = {
    $expr: { $eq: ["$country", "$$countryId"] },
    isActive: true,
  };
  if (scope?.partnerId && mongoose.Types.ObjectId.isValid(scope.partnerId)) {
    stationMatch.partner = new mongoose.Types.ObjectId(scope.partnerId);
  }
  if (scope?.stationId && mongoose.Types.ObjectId.isValid(scope.stationId)) {
    stationMatch._id = new mongoose.Types.ObjectId(scope.stationId);
  }

  const result = await ListenerStatement.aggregate([
    { $match: matchFilter },
    {
      $group: {
        _id: "$country",
        messages: { $sum: 1 },
        revenue: { $sum: "$amount" },
      },
    },
    { $lookup: { from: "countries", localField: "_id", foreignField: "_id", as: "countryDoc" } },
    { $unwind: { path: "$countryDoc", preserveNullAndEmptyArrays: true } },
    {
      $lookup: {
        from: "stations",
        let: { countryId: "$_id" },
        pipeline: [
          { $match: stationMatch },
          { $count: "count" },
        ],
        as: "stationsResult",
      },
    },
    { $sort: { revenue: -1 } },
  ]);

  return result.map((r: any) => ({
    countryId: r._id?.toString() || "",
    countryName: r.countryDoc?.name || "Unknown",
    name: r.countryDoc?.name || "Unknown",
    stations: r.stationsResult?.[0]?.count || 0,
    messages: r.messages,
    revenue: r.revenue,
  }));
};

const getCallActivity = async (
  period: "daily" | "weekly" | "monthly",
  scope?: { partnerId?: string; stationId?: string; country?: string; dateRange?: string; startDate?: string; endDate?: string },
  timezone?: string,
) => {
  const matchFilter: Record<string, unknown> = {};
  const scopeFilter = await resolveScopeStationFilter(scope);
  Object.assign(matchFilter, scopeFilter);
  Object.assign(matchFilter, resolveDateRangeFilter(scope?.dateRange, "startedAt", scope?.startDate, scope?.endDate));

  const tz = timezone || "UTC";
  let groupId: Record<string, unknown>;
  if (period === "daily") {
    groupId = { $dateToString: { format: "%Y-%m-%d", date: "$startedAt", timezone: tz } };
  } else if (period === "weekly") {
    groupId = { $dateToString: { format: "%Y-W%V", date: "$startedAt", timezone: tz } };
  } else {
    groupId = { $dateToString: { format: "%Y-%m", date: "$startedAt", timezone: tz } };
  }

  const result = await Call.aggregate([
    { $match: matchFilter },
    { $group: { _id: groupId, count: { $sum: 1 } } },
    { $sort: { _id: 1 } },
    { $limit: 30 },
  ]);

  return result.map((r) => ({ date: r._id, count: r.count }));
};

const getCampaignStats = async (scope?: { partnerId?: string; stationId?: string; country?: string; dateRange?: string }) => {
  const filter: Record<string, unknown> = {};
  const scopeFilter = await resolveScopeStationFilter(scope);
  Object.assign(filter, scopeFilter);
  Object.assign(filter, resolveDateRangeFilter(scope?.dateRange, "createdAt"));

  const now = new Date();
  const [activeCampaigns, expiredCampaigns, viewsResult, topCampaignDoc] = await Promise.all([
    Status.countDocuments({ ...filter, expiresAt: { $gt: now } }),
    Status.countDocuments({ ...filter, expiresAt: { $lte: now } }),
    Status.aggregate([
      { $match: filter },
      { $group: { _id: null, totalViews: { $sum: "$viewCount" } } },
    ]),
    Status.find(filter).sort({ viewCount: -1 }).limit(1).lean(),
  ]);

  const campaignViews = viewsResult.length > 0 ? viewsResult[0].totalViews : 0;
  const firstTop = topCampaignDoc[0];
  const topCampaign = firstTop ? {
    title: firstTop.content || "",
    views: firstTop.viewCount || 0,
    type: firstTop.type === "auto_weekly_top_fans" ? "Auto" : "Manual",
  } : null;

  return {
    activeCampaigns,
    expiredCampaigns,
    campaignViews,
    topCampaign,
  };
};

const getCallOperationsStats = async (scope?: {
  partnerId?: string;
  stationId?: string;
  country?: string;
  dateRange?: string;
  startDate?: string;
  endDate?: string;
}) => {
  const matchFilter: Record<string, unknown> = {};
  const scopeFilter = await resolveScopeStationFilter(scope);
  Object.assign(matchFilter, scopeFilter);
  Object.assign(matchFilter, resolveDateRangeFilter(scope?.dateRange, "startedAt", scope?.startDate, scope?.endDate));

  const result = await Call.aggregate([
    { $match: matchFilter },
    {
      $group: {
        _id: null,
        totalCalls: { $sum: 1 },
        answeredCalls: {
          $sum: { $cond: [{ $in: ["$status", ["answered", "completed"]] }, 1, 0] },
        },
        queuedCalls: {
          $sum: { $cond: [{ $eq: ["$status", "queued"] }, 1, 0] },
        },
        missedCalls: {
          $sum: { $cond: [{ $eq: ["$status", "missed"] }, 1, 0] },
        },
        rejectedCalls: {
          $sum: { $cond: [{ $eq: ["$status", "rejected"] }, 1, 0] },
        },
      },
    },
  ]);

  if (result.length === 0) {
    return {
      incomingCalls: 0,
      totalCalls: 0,
      completed: 0,
      answeredCalls: 0,
      queued: 0,
      queuedCalls: 0,
      rejected: 0,
      rejectedCalls: 0,
      missedCalls: 0,
      callSuccessRate: 0,
      callResponseRate: 0,
    };
  }

  const { totalCalls, answeredCalls, queuedCalls, missedCalls, rejectedCalls } = result[0];
  const callSuccessRate = totalCalls > 0 ? Number(((answeredCalls / totalCalls) * 100).toFixed(1)) : 0;
  const callResponseRate = totalCalls > 0 ? Number((((answeredCalls + rejectedCalls) / totalCalls) * 100).toFixed(1)) : 0;

  return {
    incomingCalls: totalCalls,
    totalCalls,
    completed: answeredCalls,
    answeredCalls,
    queued: queuedCalls || 0,
    queuedCalls: queuedCalls || 0,
    rejected: rejectedCalls,
    rejectedCalls,
    missedCalls,
    callSuccessRate,
    callResponseRate,
  };
};

const getRoleDistribution = async () => {
  const result = await User.aggregate([
    { $group: { _id: "$role", count: { $sum: 1 } } },
  ]);

  const totalUsers = result.reduce((sum, r) => sum + r.count, 0);

  const ROLE_CONFIG: Record<string, { label: string; color: string }> = {
    partner_admin: { label: "Partner Admins", color: "bg-[#02B2FF]" },
    station_admin: { label: "Station Admins", color: "bg-violet-500" },
    media_station: { label: "Media Stations", color: "bg-amber-500" },
    presenter: { label: "Presenters", color: "bg-emerald-500" },
    customer_care: { label: "Customer Care", color: "bg-rose-500" },
  };

  const roleMap = new Map(result.map((r) => [r._id, r.count]));

  return Object.entries(ROLE_CONFIG).map(([roleKey, config]) => {
    const count = roleMap.get(roleKey) || 0;
    const pct = totalUsers > 0 ? Number(((count / totalUsers) * 100).toFixed(1)) : 0;
    return {
      role: config.label,
      roleKey,
      count,
      pct,
      color: config.color,
    };
  });
};

export const DashboardRepository = {
  getStats,
  getMessageActivity,
  getRevenueActivity,
  getListenerActivity,
  getCampaignActivity,
  getCallActivity,
  getCampaignStats,
  getCallOperationsStats,
  getRoleDistribution,
  getStationOverview,
  getRecentActivity,
  getTopStations,
  getTopShows,
  getRecentUsers,
  getCreditStats,
  getCountryRevenue,
};
