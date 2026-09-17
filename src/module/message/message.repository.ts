import mongoose from "mongoose";
import Message from "./message.model";

const createMessage = (data: Record<string, unknown>, session?: mongoose.ClientSession) => {
  const doc = new Message(data);
  if (session) {
    return doc.save({ session }).then((d) => d.toObject());
  }
  return doc.save().then((d) => d.toObject());
};

const findMessageById = (id: string) => {
  return Message.findOne({ _id: id, isDeleted: { $ne: true } })
    .populate("show", "name")
    .populate("senderUser", "fullName")
    .populate("user", "fullName phone")
    .populate("station", "name stationCode")
    .populate("country", "name code")
    .lean();
};

const findThread = (
  stationId: string,
  msisdn: string,
  skip: number,
  limit: number,
  viewerUserId?: string,
  showId?: string,
) => {
  const filter: Record<string, unknown> = {
    station: stationId,
    msisdn,
    isDeleted: { $ne: true },
  };
  // Hide messages the viewer deleted for themselves only
  if (viewerUserId) {
    filter.deletedFor = { $ne: new mongoose.Types.ObjectId(viewerUserId) };
  }
  // Presenter (and similar): scope conversation to a single show when provided
  if (showId) {
    filter.show = new mongoose.Types.ObjectId(showId);
  }

  return Message.find(filter)
    .populate("show", "name")
    .populate("senderUser", "fullName")
    .populate("user", "fullName avatar")
    .sort({ createdAt: 1 })
    .skip(skip)
    .limit(limit)
    .lean();
};

const findThreadsByStation = (
  stationId: string | undefined,
  skip: number,
  limit: number,
  showId?: string,
  sinceDate?: Date,
) => {
  const matchStage: Record<string, unknown> = { senderType: "user", isDeleted: { $ne: true } };
  if (stationId) {
    matchStage.station = new mongoose.Types.ObjectId(stationId);
  }
  if (showId) {
    matchStage.show = new mongoose.Types.ObjectId(showId);
  }
  if (sinceDate) {
    matchStage.createdAt = { $gte: sinceDate };
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
        lastImageUrl: { $first: "$imageUrl" },
        lastAudioUrl: { $first: "$audioUrl" },
        lastStickerUrl: { $first: "$stickerUrl" },
        lastMediaType: { $first: "$mediaType" },
        lastTime: { $first: "$createdAt" },
        count: { $sum: 1 },
        unrepliedCount: {
          $sum: {
            $cond: [
              { $and: [{ $eq: ["$isReplied", false] }, { $eq: ["$senderType", "user"] }] },
              1,
              0,
            ],
          },
        },
        showName: { $first: "$show" },
        stationId: { $first: "$station" },
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
      $lookup: {
        from: "stations",
        localField: "stationId",
        foreignField: "_id",
        as: "stationDoc",
      },
    },
    // Lookup user by phone number to get listener name and avatar
    {
      $lookup: {
        from: "users",
        let: { phone: "$_id" },
        pipeline: [
          {
            $match: {
              $expr: { $eq: ["$phone", "$$phone"] },
              isDeleted: { $ne: true },
            },
          },
          { $project: { fullName: 1, avatar: 1 } },
          { $limit: 1 },
        ],
        as: "userDoc",
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
        stationName: {
          $let: {
            vars: { first: { $arrayElemAt: ["$stationDoc", 0] } },
            in: "$$first.name",
          },
        },
        stationLogo: {
          $let: {
            vars: { first: { $arrayElemAt: ["$stationDoc", 0] } },
            in: "$$first.logo",
          },
        },
        isActive: {
          $let: {
            vars: { first: { $arrayElemAt: ["$stationDoc", 0] } },
            in: "$$first.isActive",
          },
        },
        listenerName: {
          $let: {
            vars: { first: { $arrayElemAt: ["$userDoc", 0] } },
            in: "$$first.fullName",
          },
        },
        listenerAvatar: {
          $let: {
            vars: { first: { $arrayElemAt: ["$userDoc", 0] } },
            in: "$$first.avatar",
          },
        },
        lastMessage: {
          $cond: [
            {
              $and: [
                { $ne: ["$lastMessage", ""] },
                { $ne: ["$lastMessage", null] },
              ],
            },
            "$lastMessage",
            {
              $cond: [
                {
                  $or: [
                    { $eq: ["$lastMediaType", "audio"] },
                    { $and: [{ $ne: ["$lastAudioUrl", null] }, { $ne: ["$lastAudioUrl", ""] }] },
                  ],
                },
                "🎤 Voice note",
                {
                  $cond: [
                    {
                      $or: [
                        { $eq: ["$lastMediaType", "image"] },
                        { $and: [{ $ne: ["$lastImageUrl", null] }, { $ne: ["$lastImageUrl", ""] }] },
                      ],
                    },
                    "📷 Photo",
                    {
                      $cond: [
                        {
                          $or: [
                            { $eq: ["$lastMediaType", "sticker"] },
                            { $and: [{ $ne: ["$lastStickerUrl", null] }, { $ne: ["$lastStickerUrl", ""] }] },
                          ],
                        },
                        "Sticker",
                        "",
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
        msisdn: "$_id",
      },
    },
    { $project: { showDoc: 0, stationDoc: 0, userDoc: 0 } },
    { $sort: { lastTime: -1 } },
    { $skip: skip },
    { $limit: limit },
  ]);
};

const countThreadsByStation = (
  stationId: string | undefined,
  showId?: string,
  sinceDate?: Date,
) => {
  const filter: Record<string, unknown> = { senderType: "user", isDeleted: { $ne: true } };
  if (stationId) {
    filter.station = stationId;
  }
  if (showId) {
    filter.show = showId;
  }
  if (sinceDate) {
    filter.createdAt = { $gte: sinceDate };
  }
  return Message.distinct("msisdn", filter).then((res) => res.length);
};

const markAsReplied = (
  stationId: string,
  msisdn: string,
  showId?: string | null,
  session?: mongoose.ClientSession,
) => {
  const opts = session ? { session } : {};
  const filter: Record<string, unknown> = {
    station: stationId,
    msisdn,
    senderType: "user",
    isReplied: false,
  };
  // Only filter by show if showId is provided
  if (showId) {
    filter.show = showId;
  }
  return Message.updateMany(
    filter,
    { $set: { isReplied: true } },
    opts,
  );
};

const countByStationAndFilter = (
  stationId: string,
  filter: Record<string, unknown>,
) => {
  return Message.countDocuments({ station: stationId, ...filter });
};

const getListenerPhoneNumbersByStation = (stationId: string): Promise<string[]> => {
  return Message.distinct("msisdn", { station: stationId, senderType: "user", isDeleted: { $ne: true } });
};

const findThreadsByPresenter = (
  stationId: string,
  presenterId: string,
  skip: number,
  limit: number,
  showId?: string,
) => {
  return Message.aggregate([
    {
      $match: {
        station: new mongoose.Types.ObjectId(stationId),
        senderType: "user",
        isDeleted: { $ne: true },
        // Strict running-show isolation: only messages tagged with the active show
        ...(showId ? { show: new mongoose.Types.ObjectId(showId) } : {}),
      },
    },
    // Lookup show to filter by presenter
    {
      $lookup: {
        from: "shows",
        localField: "show",
        foreignField: "_id",
        as: "showDoc",
      },
    },
    {
      $unwind: { preserveNullAndEmptyArrays: false, path: "$showDoc" },
    },
    {
      $match: {
        "showDoc.presenter": new mongoose.Types.ObjectId(presenterId),
        ...(showId
          ? { "showDoc._id": new mongoose.Types.ObjectId(showId) }
          : {}),
      },
    },
    { $sort: { createdAt: -1 } },
    {
      $group: {
        _id: "$msisdn",
        lastMessage: { $first: "$content" },
        lastImageUrl: { $first: "$imageUrl" },
        lastAudioUrl: { $first: "$audioUrl" },
        lastStickerUrl: { $first: "$stickerUrl" },
        lastMediaType: { $first: "$mediaType" },
        lastTime: { $first: "$createdAt" },
        count: { $sum: 1 },
        unrepliedCount: {
          $sum: { $cond: [{ $eq: ["$isReplied", false] }, 1, 0] },
        },
        showName: { $first: "$showDoc.name" },
        showId: { $first: "$show" },
      },
    },
    // Lookup user by phone number to get listener name and avatar
    {
      $lookup: {
        from: "users",
        let: { phone: "$_id" },
        pipeline: [
          {
            $match: {
              $expr: { $eq: ["$phone", "$$phone"] },
              isDeleted: { $ne: true },
            },
          },
          { $project: { fullName: 1, avatar: 1 } },
          { $limit: 1 },
        ],
        as: "userDoc",
      },
    },
    {
      $addFields: {
        listenerName: {
          $let: {
            vars: { first: { $arrayElemAt: ["$userDoc", 0] } },
            in: "$$first.fullName",
          },
        },
        listenerAvatar: {
          $let: {
            vars: { first: { $arrayElemAt: ["$userDoc", 0] } },
            in: "$$first.avatar",
          },
        },
        lastMessage: {
          $cond: [
            {
              $and: [
                { $ne: ["$lastMessage", ""] },
                { $ne: ["$lastMessage", null] },
              ],
            },
            "$lastMessage",
            {
              $cond: [
                {
                  $or: [
                    { $eq: ["$lastMediaType", "audio"] },
                    { $and: [{ $ne: ["$lastAudioUrl", null] }, { $ne: ["$lastAudioUrl", ""] }] },
                  ],
                },
                "🎤 Voice note",
                {
                  $cond: [
                    {
                      $or: [
                        { $eq: ["$lastMediaType", "image"] },
                        { $and: [{ $ne: ["$lastImageUrl", null] }, { $ne: ["$lastImageUrl", ""] }] },
                      ],
                    },
                    "📷 Photo",
                    {
                      $cond: [
                        {
                          $or: [
                            { $eq: ["$lastMediaType", "sticker"] },
                            { $and: [{ $ne: ["$lastStickerUrl", null] }, { $ne: ["$lastStickerUrl", ""] }] },
                          ],
                        },
                        "Sticker",
                        "",
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
        msisdn: "$_id",
      },
    },
    { $project: { showDoc: 0, userDoc: 0 } },
    { $sort: { lastTime: -1 } },
    { $skip: skip },
    { $limit: limit },
  ]);
};

const countThreadsByPresenter = (
  stationId: string,
  presenterId: string,
  showId?: string,
) => {
  return Message.aggregate([
    {
      $match: {
        station: new mongoose.Types.ObjectId(stationId),
        senderType: "user",
        isDeleted: { $ne: true },
        ...(showId ? { show: new mongoose.Types.ObjectId(showId) } : {}),
      },
    },
    {
      $lookup: {
        from: "shows",
        localField: "show",
        foreignField: "_id",
        as: "showDoc",
      },
    },
    {
      $unwind: { preserveNullAndEmptyArrays: false, path: "$showDoc" },
    },
    {
      $match: {
        "showDoc.presenter": new mongoose.Types.ObjectId(presenterId),
        ...(showId
          ? { "showDoc._id": new mongoose.Types.ObjectId(showId) }
          : {}),
      },
    },
    { $group: { _id: "$msisdn" } },
    { $count: "total" },
  ]).then((result) => (result.length > 0 ? result[0].total : 0));
};

const approveMessage = (messageId: string, approvedBy: string) => {
  return Message.findByIdAndUpdate(
    messageId,
    { status: "approved", approvedBy, approvedAt: new Date() },
    { returnDocument: "after" },
  ).lean();
};

const rejectMessage = (messageId: string, rejectionReason: string) => {
  return Message.findByIdAndUpdate(
    messageId,
    { status: "rejected", rejectionReason },
    { returnDocument: "after" },
  ).lean();
};

const sendToOutput = (messageId: string) => {
  return Message.findByIdAndUpdate(
    messageId,
    { status: "sent_to_output", sentToOutputAt: new Date() },
    { returnDocument: "after" },
  ).lean();
};

const deleteMessage = (messageId: string) => {
  return Message.findByIdAndUpdate(
    messageId,
    { isDeleted: true },
    { returnDocument: "after" },
  );
};

const editMessageContent = (messageId: string, content: string) => {
  return Message.findByIdAndUpdate(
    messageId,
    {
      content,
      isEdited: true,
      editedAt: new Date(),
    },
    { returnDocument: "after" },
  )
    .populate("show", "name")
    .populate("senderUser", "fullName")
    .populate("user", "fullName phone avatar")
    .populate("station", "name stationCode")
    .populate("country", "name code")
    .lean();
};

const deleteMessageForUser = (messageId: string, userId: string) => {
  return Message.findByIdAndUpdate(
    messageId,
    { $addToSet: { deletedFor: new mongoose.Types.ObjectId(userId) } },
    { returnDocument: "after" },
  ).lean();
};

const deleteMessageForEveryone = (messageId: string) => {
  return Message.findByIdAndUpdate(
    messageId,
    { deletedForEveryone: true },
    { returnDocument: "after" },
  )
    .populate("show", "name")
    .populate("senderUser", "fullName")
    .populate("user", "fullName phone avatar")
    .populate("station", "name stationCode")
    .populate("country", "name code")
    .lean();
};

const markAsRead = (messageId: string) => {
  return Message.findByIdAndUpdate(
    messageId,
    { isRead: true, readAt: new Date() },
    { returnDocument: "after" },
  ).lean();
};

const findThreadsByUserPhone = (
  phone: string,
  userId: string,
  skip: number,
  limit: number,
) => {
  const userObjectId = new mongoose.Types.ObjectId(userId);
  return Message.aggregate([
    { $match: { msisdn: phone, isDeleted: { $ne: true } } },
    { $sort: { createdAt: -1 } },
    {
      $group: {
        _id: "$station",
        lastMessage: { $first: "$content" },
        lastImageUrl: { $first: "$imageUrl" },
        lastAudioUrl: { $first: "$audioUrl" },
        lastMediaType: { $first: "$mediaType" },
        lastMessageTime: { $first: "$createdAt" },
        lastSenderType: { $first: "$senderType" },
        count: { $sum: 1 },
        unrepliedCount: {
          $sum: {
            $cond: [
              { $and: [{ $eq: ["$senderType", "user"] }, { $eq: ["$isReplied", false] }] },
              1,
              0,
            ],
          },
        },
        showName: { $first: "$show" },
      },
    },
    {
      $lookup: {
        from: "stations",
        localField: "_id",
        foreignField: "_id",
        as: "stationDoc",
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
      $lookup: {
        from: "follows",
        let: { stationId: "$_id" },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [
                  { $eq: ["$station", "$$stationId"] },
                  { $eq: ["$user", userObjectId] },
                ],
              },
            },
          },
          { $limit: 1 },
        ],
        as: "followDoc",
      },
    },
    {
      $addFields: {
        stationName: {
          $let: {
            vars: { first: { $arrayElemAt: ["$stationDoc", 0] } },
            in: "$$first.name",
          },
        },
        stationLogo: {
          $let: {
            vars: { first: { $arrayElemAt: ["$stationDoc", 0] } },
            in: "$$first.logo",
          },
        },
        isActive: {
          $let: {
            vars: { first: { $arrayElemAt: ["$stationDoc", 0] } },
            in: "$$first.isActive",
          },
        },
        showName: {
          $let: {
            vars: { first: { $arrayElemAt: ["$showDoc", 0] } },
            in: "$$first.name",
          },
        },
        isFollowed: { $gt: [{ $size: "$followDoc" }, 0] },
        lastMessage: {
          $cond: [
            {
              $and: [
                { $ne: ["$lastMessage", ""] },
                { $ne: ["$lastMessage", null] },
              ],
            },
            "$lastMessage",
            {
              $cond: [
                {
                  $or: [
                    { $eq: ["$lastMediaType", "audio"] },
                    { $and: [{ $ne: ["$lastAudioUrl", null] }, { $ne: ["$lastAudioUrl", ""] }] },
                  ],
                },
                "🎤 Voice note",
                {
                  $cond: [
                    {
                      $or: [
                        { $eq: ["$lastMediaType", "image"] },
                        { $and: [{ $ne: ["$lastImageUrl", null] }, { $ne: ["$lastImageUrl", ""] }] },
                      ],
                    },
                    "📷 Photo",
                    "",
                  ],
                },
              ],
            },
          ],
        },
        msisdn: phone,
      },
    },
    { $project: { stationDoc: 0, showDoc: 0, followDoc: 0 } },
    { $sort: { lastMessageTime: -1 } },
    { $skip: skip },
    { $limit: limit },
  ]);
};

const countThreadsByUserPhone = (phone: string) => {
  return Message.distinct("station", { msisdn: phone, senderType: "user", isDeleted: { $ne: true } }).then(
    (res) => res.length,
  );
};

const findAllMessages = (
  filter: Record<string, unknown>,
  skip: number,
  limit: number,
) => {
  return Message.find({ ...filter, senderType: "user", isDeleted: { $ne: true } })
    .populate("show", "name")
    .populate("station", "name stationCode")
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit)
    .lean();
};

const countAllMessages = (filter: Record<string, unknown>) => {
  return Message.countDocuments({ ...filter, senderType: "user", isDeleted: { $ne: true } });
};

export const MessageRepository = {
  createMessage,
  findMessageById,
  findThread,
  findThreadsByStation,
  countThreadsByStation,
  findThreadsByPresenter,
  countThreadsByPresenter,
  findThreadsByUserPhone,
  countThreadsByUserPhone,
  markAsReplied,
  countByStationAndFilter,
  getListenerPhoneNumbersByStation,
  approveMessage,
  rejectMessage,
  sendToOutput,
  deleteMessage,
  editMessageContent,
  deleteMessageForUser,
  deleteMessageForEveryone,
  markAsRead,
  findAllMessages,
  countAllMessages,
};
