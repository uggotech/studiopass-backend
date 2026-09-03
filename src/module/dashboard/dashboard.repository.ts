import mongoose from "mongoose";
import { Partner } from "../partner/partner.model";
import { Station } from "../station/station.model";
import { Show } from "../show/show.model";
import { User } from "../user/user.model";
import Message from "../message/message.model";
import Call from "../call/call.model";
import { Status } from "../status/status.model";
import { CreditTransaction } from "../creditTransaction/creditTransaction.model";
import ListenerStatement from "../listenerStatement/listenerStatement.model";

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
    const filter = isObjId
      ? { $or: [{ country: scope.country }, { countryName: scope.country }] }
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

const getStats = async (scope?: {
  partnerId?: string;
  stationId?: string;
  country?: string;
  role?: string;
  dateRange?: string;
  startDate?: string;
  endDate?: string;
}) => {
  const role = scope?.role;

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

  const [
    totalPartners,
    activePartners,
    totalStations,
    activeStations,
    totalUsers,
    totalMessages,
    totalCalls,
    activeShows,
    revenueResult,
  ] = await Promise.all([
    Partner.countDocuments(partnerFilter),
    Partner.countDocuments({ ...partnerFilter, isActive: true }),
    Station.countDocuments(stationFilter),
    Station.countDocuments({ ...stationFilter, isActive: true }),
    User.countDocuments(userFilter),
    Message.countDocuments({ ...messageFilter, senderType: "user", isDeleted: { $ne: true } }),
    Call.countDocuments(callFilter),
    Show.countDocuments(showFilter),
    ListenerStatement.aggregate([
      { $match: { ...messageFilter, isFree: { $ne: true } } },
      { $group: { _id: null, total: { $sum: "$amount" } } },
    ]),
  ]);

  return {
    totalPartners,
    activePartners,
    totalStations,
    activeStations,
    totalUsers,
    totalMessages,
    totalCalls,
    activeShows,
    totalRevenue: revenueResult.length > 0 ? revenueResult[0].total : 0,
  };
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
  scope?: { partnerId?: string; stationId?: string; country?: string; dateRange?: string },
  timezone?: string,
) => {
  const matchFilter: Record<string, unknown> = { isFree: { $ne: true } };
  const scopeFilter = await resolveScopeStationFilter(scope);
  Object.assign(matchFilter, scopeFilter);
  Object.assign(matchFilter, resolveDateRangeFilter(scope?.dateRange, "createdAt"));

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
    { $group: { _id: groupId, count: { $sum: "$amount" } } },
    { $sort: { _id: 1 } },
    { $limit: 30 },
  ]);

  return result.map((r) => ({ date: r._id, count: r.count }));
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
    filter.partner = scope.partnerId;
  } else if (scope?.country && mongoose.Types.ObjectId.isValid(scope.country)) {
    filter.country = new mongoose.Types.ObjectId(scope.country);
  }

  const dateMatchMsg = resolveDateRangeFilter(scope?.dateRange, "createdAt");
  const dateMatchCall = resolveDateRangeFilter(scope?.dateRange, "startedAt");
  const now = new Date();

  // Use aggregation to get stations + counts in a single pipeline (no N+1)
  const overview = await Station.aggregate([
    { $match: filter },
    { $limit: 20 },
    {
      $lookup: {
        from: "shows",
        let: { stationId: "$_id" },
        pipeline: [
          { $match: { $expr: { $eq: ["$station", "$$stationId"] }, isActive: true } },
          { $count: "count" },
        ],
        as: "showsResult",
      },
    },
    {
      $lookup: {
        from: "messages",
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
        from: "calls",
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
        from: "statuses",
        let: { stationId: "$_id" },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [
                  { $eq: ["$station", "$$stationId"] },
                  { $gt: ["$expiresAt", now] },
                ],
              },
            },
          },
          { $count: "count" },
        ],
        as: "campaignsResult",
      },
    },
    {
      $addFields: {
        msgStats: { $arrayElemAt: ["$messagesResult", 0] },
        callStats: { $arrayElemAt: ["$callsResult", 0] },
        campStats: { $arrayElemAt: ["$campaignsResult", 0] },
        activeShowsCount: { $ifNull: [{ $arrayElemAt: ["$showsResult.count", 0] }, 0] },
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
        activeCampaigns: { $ifNull: ["$campStats.count", 0] },
        status: { $cond: ["$isActive", "Active", "Inactive"] },
      },
    },
    {
      $project: {
        showsResult: 0,
        messagesResult: 0,
        callsResult: 0,
        campaignsResult: 0,
        msgStats: 0,
        callStats: 0,
        campStats: 0,
        activeShowsCount: 0,
        _id: 0,
        name: 0,
        isActive: 0,
      },
    },
  ]);

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

  return messages.map((m) => ({
    type: "message",
    description: `New message from ${(m as any).msisdn} at ${(m as any).station?.name || "Unknown"}`,
    timestamp: m.createdAt,
    user: (m as any).msisdn,
  }));
};

const getTopStations = async (
  limit: number,
  scope?: { partnerId?: string; stationId?: string },
) => {
  const matchFilter: Record<string, unknown> = { senderType: "user", isDeleted: { $ne: true } };
  if (scope?.stationId) {
    matchFilter.station = new mongoose.Types.ObjectId(scope.stationId);
  } else if (scope?.partnerId) {
    const stationIds = await resolvePartnerStationIds(scope.partnerId);
    matchFilter.station = { $in: stationIds };
  }

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
      userFilter.country = { $in: countryIds };
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
  if (scope?.country && mongoose.Types.ObjectId.isValid(scope.country)) {
    matchFilter.country = new mongoose.Types.ObjectId(scope.country);
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
          { $match: { $expr: { $eq: ["$country", "$$countryId"] }, isActive: true } },
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
  getRecentUsers,
  getCreditStats,
  getCountryRevenue,
};
