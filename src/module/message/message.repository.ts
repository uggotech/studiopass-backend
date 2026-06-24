import mongoose from "mongoose";
import Message from "./message.model";

const createMessage = (data: Record<string, unknown>) => {
  const doc = new Message(data);
  return doc.save().then((d) => d.toObject());
};

const findMessageById = (id: string) => {
  return Message.findById(id).lean();
};

const findThread = (
  stationId: string,
  msisdn: string,
  skip: number,
  limit: number,
) => {
  return Message.find({
    station: stationId,
    msisdn,
  })
    .populate("show", "name")
    .populate("senderUser", "fullName")
    .sort({ createdAt: 1 })
    .skip(skip)
    .limit(limit)
    .lean();
};

const findThreadsByStation = (
  stationId: string | undefined,
  skip: number,
  limit: number,
) => {
  const matchStage: Record<string, unknown> = { senderType: "user" };
  if (stationId) {
    matchStage.station = new mongoose.Types.ObjectId(stationId);
  }

  return Message.aggregate([
    { $match: matchStage },
    {
      $sort: { createdAt: -1 },
    },
    {
      $group: {
        _id: "$msisdn",
        lastMessage: { $first: "$content" },
        lastTime: { $first: "$createdAt" },
        count: { $sum: 1 },
        unrepliedCount: {
          $sum: { $cond: [{ $eq: ["$isReplied", false] }, 1, 0] },
        },
        showName: { $first: "$show" },
      },
    },
    {
      $lookup: {
        from: "shows",
        localField: "showName",
        foreignField: "_id",
        as: "showDoc",
      },
    },
    {
      $addFields: {
        showName: {
          $let: {
            vars: { first: { $arrayElemAt: ["$showDoc", 0] } },
            in: "$$first.name",
          },
        },
      },
    },
    { $project: { showDoc: 0 } },
    { $sort: { lastTime: -1 } },
    { $skip: skip },
    { $limit: limit },
  ]);
};

const countThreadsByStation = (stationId: string | undefined) => {
  const filter: Record<string, unknown> = { senderType: "user" };
  if (stationId) {
    filter.station = stationId;
  }
  return Message.distinct("msisdn", filter).then((res) => res.length);
};

const markAsReplied = (
  stationId: string,
  msisdn: string,
  showId: string,
) => {
  return Message.updateMany(
    {
      station: stationId,
      msisdn,
      show: showId,
      senderType: "user",
      isReplied: false,
    },
    { $set: { isReplied: true } },
  );
};

const countByStationAndFilter = (
  stationId: string,
  filter: Record<string, unknown>,
) => {
  return Message.countDocuments({ station: stationId, ...filter });
};

const getListenerPhoneNumbersByStation = (stationId: string): Promise<string[]> => {
  return Message.distinct("msisdn", { station: stationId, senderType: "user" });
};

export const MessageRepository = {
  createMessage,
  findMessageById,
  findThread,
  findThreadsByStation,
  countThreadsByStation,
  markAsReplied,
  countByStationAndFilter,
  getListenerPhoneNumbersByStation,
};
