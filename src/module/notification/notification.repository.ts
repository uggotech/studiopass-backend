import { Notification } from "./notification.model";

const findByUser = (
  userId: string,
  filter: Record<string, unknown> = {},
  options: { skip?: number; limit?: number } = {},
) => {
  const query = Notification.find({ user: userId, ...filter })
    .sort({ createdAt: -1 });

  if (options.skip) query.skip(options.skip);
  if (options.limit) query.limit(options.limit);

  return query.lean();
};

const countByUser = (userId: string, filter: Record<string, unknown> = {}) => {
  return Notification.countDocuments({ user: userId, ...filter });
};

const findById = (id: string) => {
  return Notification.findById(id).lean();
};

const markAsRead = (id: string, userId: string) => {
  return Notification.findOneAndUpdate(
    { _id: id, user: userId },
    { isRead: true, readAt: new Date() },
    { new: true },
  ).lean();
};

const markAllAsRead = (userId: string) => {
  return Notification.updateMany(
    { user: userId, isRead: false },
    { isRead: true, readAt: new Date() },
  );
};

const deleteById = (id: string, userId: string) => {
  return Notification.findOneAndDelete({ _id: id, user: userId });
};

export const NotificationRepository = {
  findByUser,
  countByUser,
  findById,
  markAsRead,
  markAllAsRead,
  deleteById,
};
