import { TNotification, TNotificationToken } from "./notification.interface";
import { Notification, NotificationToken } from "./notification.model";

type QueryOptions = {
  select?: Record<string, 0 | 1> | string;
  sort?: Record<string, 1 | -1> | string;
  limit?: number;
  skip?: number;
  populate?: string | string[];
};

type FindOneOptions = Pick<QueryOptions, "select" | "populate">;

const applyOptions = <TQuery>(query: TQuery, options: QueryOptions | FindOneOptions) => {
  let nextQuery: any = query;

  if (options.select) {
    nextQuery = nextQuery.select(options.select);
  }

  if ("sort" in options && options.sort) {
    nextQuery = nextQuery.sort(options.sort);
  }

  if ("skip" in options && typeof options.skip === "number") {
    nextQuery = nextQuery.skip(options.skip);
  }

  if ("limit" in options && typeof options.limit === "number") {
    nextQuery = nextQuery.limit(options.limit);
  }

  if (options.populate) {
    if (Array.isArray(options.populate)) {
      options.populate.forEach((path) => {
        nextQuery = nextQuery.populate(path);
      });
    } else {
      nextQuery = nextQuery.populate(options.populate);
    }
  }

  return nextQuery;
};

export const NotificationRepository = {
  create(payload: Partial<TNotification>) {
    return Notification.create(payload);
  },

  createMany(payload: Partial<TNotification>[]) {
    return Notification.insertMany(payload, { ordered: false });
  },

  findById(id: string, options: FindOneOptions = {}) {
    return applyOptions(Notification.findById(id), options);
  },

  findOne(filter: object, options: FindOneOptions = {}) {
    return applyOptions(Notification.findOne(filter), options);
  },

  findMany(filter: object = {}, options: QueryOptions = {}) {
    return applyOptions(Notification.find(filter), options);
  },

  findOneAndUpdate(filter: object, payload: any, options: any = {}) {
    return Notification.findOneAndUpdate(filter, payload, {
      returnDocument: "after",
      runValidators: true,
      updatePipeline: Array.isArray(payload),
      ...options,
    });
  },

  updateById(id: string, payload: any, options: any = {}) {
    return Notification.findByIdAndUpdate(id, payload, {
      returnDocument: "after",
      runValidators: true,
      updatePipeline: Array.isArray(payload),
      ...options,
    });
  },

  updateMany(filter: object, payload: any, options: any = {}) {
    return Notification.updateMany(filter, payload, {
      runValidators: true,
      updatePipeline: Array.isArray(payload),
      ...options,
    });
  },

  deleteById(id: string) {
    return Notification.findByIdAndDelete(id);
  },

  deleteMany(filter: object) {
    return Notification.deleteMany(filter);
  },

  count(filter: object = {}) {
    return Notification.countDocuments(filter);
  },
};

export const NotificationTokenRepository = {
  create(payload: Partial<TNotificationToken>) {
    return NotificationToken.create(payload);
  },

  findById(id: string, options: FindOneOptions = {}) {
    return applyOptions(NotificationToken.findById(id), options);
  },

  findOne(filter: object, options: FindOneOptions = {}) {
    return applyOptions(NotificationToken.findOne(filter), options);
  },

  findMany(filter: object = {}, options: QueryOptions = {}) {
    return applyOptions(NotificationToken.find(filter), options);
  },

  findOneAndUpdate(filter: object, payload: any, options: any = {}) {
    return NotificationToken.findOneAndUpdate(filter, payload, {
      returnDocument: "after",
      runValidators: true,
      upsert: false,
      updatePipeline: Array.isArray(payload),
      ...options,
    });
  },

  updateById(id: string, payload: any, options: any = {}) {
    return NotificationToken.findByIdAndUpdate(id, payload, {
      returnDocument: "after",
      runValidators: true,
      updatePipeline: Array.isArray(payload),
      ...options,
    });
  },

  deleteById(id: string) {
    return NotificationToken.findByIdAndDelete(id);
  },

  deleteMany(filter: object) {
    return NotificationToken.deleteMany(filter);
  },

  upsertByToken(token: string, payload: Partial<TNotificationToken>) {
    return NotificationToken.findOneAndUpdate(
      { token },
      { $set: { ...payload, token } },
      { new: true, upsert: true, runValidators: true },
    );
  },
};