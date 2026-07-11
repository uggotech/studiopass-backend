import mongoose from "mongoose";
import { Partner } from "../partner/partner.model";
import { Station } from "../station/station.model";
import { User } from "../user/user.model";
import Message from "../message/message.model";
import { CreditTransaction } from "../creditTransaction/creditTransaction.model";
import ListenerStatement from "../listenerStatement/listenerStatement.model";

/**
 * Resolve partner station IDs once, reused across all dashboard queries.
 */
const resolvePartnerStationIds = async (partnerId?: string): Promise<mongoose.Types.ObjectId[]> => {
  if (!partnerId) return [];
  const partnerStations = await Station.find({ partner: partnerId }).select("_id").lean();
  return partnerStations.map((s) => s._id);
};

const getStats = async (scope?: { partnerId?: string; stationId?: string; role?: string }) => {
  const role = scope?.role;

  // Build filters based on role scope
  const partnerFilter: Record<string, unknown> = {};
  const stationFilter: Record<string, unknown> = {};
  const userFilter: Record<string, unknown> = {};
  const messageFilter: Record<string, unknown> = {};

  if (role === "station_admin" || role === "media_station" || role === "presenter") {
    // Station-scoped roles: only their station
    if (scope?.stationId) {
      const sid = new mongoose.Types.ObjectId(scope.stationId);
      stationFilter._id = sid;
      messageFilter.station = sid;
      // Users at this station (media_station, presenter, station_admin)
      userFilter.stationId = scope.stationId;
    }
  } else if (role === "partner_admin" || role === "customer_care") {
    // Partner-scoped roles: their partner's stations
    if (scope?.partnerId) {
      partnerFilter._id = scope.partnerId;
      stationFilter.partner = scope.partnerId;
      const stationIds = await resolvePartnerStationIds(scope.partnerId);
      messageFilter.station = { $in: stationIds };
      userFilter.stationId = { $in: stationIds.map((id) => id.toString()) };
    }
  }
  // super_admin: no filters — sees everything

  const [
    totalPartners,
    activePartners,
    totalStations,
    activeStations,
    totalUsers,
    totalMessages,
    revenueResult,
  ] = await Promise.all([
    Partner.countDocuments(partnerFilter),
    Partner.countDocuments({ ...partnerFilter, isActive: true }),
    Station.countDocuments(stationFilter),
    Station.countDocuments({ ...stationFilter, isActive: true }),
    User.countDocuments(userFilter),
    Message.countDocuments({ ...messageFilter, senderType: "user", isDeleted: { $ne: true } }),
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
    totalCalls: 0,
    totalRevenue: revenueResult.length > 0 ? revenueResult[0].total : 0,
  };
};

const getMessageActivity = async (
  period: "daily" | "weekly" | "monthly",
  scope?: { partnerId?: string; stationId?: string },
) => {
  const matchFilter: Record<string, unknown> = { senderType: "user", isDeleted: { $ne: true } };
  if (scope?.stationId) {
    matchFilter.station = new mongoose.Types.ObjectId(scope.stationId);
  } else if (scope?.partnerId) {
    const stationIds = await resolvePartnerStationIds(scope.partnerId);
    matchFilter.station = { $in: stationIds };
  }

  let groupId: Record<string, unknown>;
  if (period === "daily") {
    groupId = { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } };
  } else if (period === "weekly") {
    groupId = { $dateToString: { format: "%Y-W%V", date: "$createdAt" } };
  } else {
    groupId = { $dateToString: { format: "%Y-%m", date: "$createdAt" } };
  }

  const result = await Message.aggregate([
    { $match: matchFilter },
    { $group: { _id: groupId, count: { $sum: 1 } } },
    { $sort: { _id: 1 } },
    { $limit: 30 },
  ]);

  return result.map((r) => ({ date: r._id, count: r.count }));
};

const getStationOverview = async (scope?: { partnerId?: string; stationId?: string }) => {
  const filter: Record<string, unknown> = {};
  if (scope?.stationId) {
    filter._id = new mongoose.Types.ObjectId(scope.stationId);
  } else if (scope?.partnerId) {
    filter.partner = scope.partnerId;
  }

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

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
                  { $gte: ["$createdAt", todayStart] },
                ],
              },
            },
          },
          { $count: "count" },
        ],
        as: "messagesResult",
      },
    },
    {
      $addFields: {
        stationId: { $toString: "$_id" },
        stationName: "$name",
        country: "",
        activeShows: { $ifNull: [{ $arrayElemAt: ["$showsResult.count", 0] }, 0] },
        messagesToday: { $ifNull: [{ $arrayElemAt: ["$messagesResult.count", 0] }, 0] },
        status: { $cond: ["$isActive", "Active", "Inactive"] },
      },
    },
    {
      $project: {
        showsResult: 0,
        messagesResult: 0,
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
    messageCount: r.count,
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

  return users.map((u) => ({
    userId: u._id.toString(),
    fullName: u.fullName || "",
    email: "",
    role: u.role,
    station: "",
    status: "Active",
    createdAt: u.createdAt,
  }));
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

const getCountryRevenue = async () => {
  const result = await ListenerStatement.aggregate([
    { $match: { isFree: { $ne: true } } },
    {
      $group: {
        _id: "$country",
        messages: { $sum: 1 },
        revenue: { $sum: "$amount" },
      },
    },
    { $lookup: { from: "countries", localField: "_id", foreignField: "_id", as: "countryDoc" } },
    { $unwind: { path: "$countryDoc", preserveNullAndEmptyArrays: true } },
    { $sort: { revenue: -1 } },
  ]);

  return result.map((r: any) => ({
    countryId: r._id?.toString() || "",
    countryName: r.countryDoc?.name || "Unknown",
    stations: 0,
    messages: r.messages,
    revenue: r.revenue,
  }));
};

export const DashboardRepository = {
  getStats,
  getMessageActivity,
  getStationOverview,
  getRecentActivity,
  getTopStations,
  getRecentUsers,
  getCreditStats,
  getCountryRevenue,
};
