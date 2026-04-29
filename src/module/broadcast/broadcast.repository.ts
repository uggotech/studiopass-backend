import { TBroadcast } from "./broadcast.interface";
import { Broadcast } from "./broadcast.model";

type QueryOptions = {
  select?: Record<string, 0 | 1> | string;
  sort?: Record<string, 1 | -1> | string;
  limit?: number;
  skip?: number;
  populate?: string | string[];
};

type FindOneOptions = Pick<QueryOptions, "select" | "populate">;

export const BroadcastRepository = {
  create(payload: Partial<TBroadcast>) {
    return Broadcast.create(payload);
  },

  findById(id: string, options: FindOneOptions = {}) {
    let query = Broadcast.findById(id);

    if (options.select) {
      query = query.select(options.select);
    }

    if (options.populate) {
      if (Array.isArray(options.populate)) {
        options.populate.forEach((path) => {
          query = query.populate(path);
        });
      } else {
        query = query.populate(options.populate);
      }
    }

    return query;
  },

  findOne(filter: object, options: FindOneOptions = {}) {
    let query = Broadcast.findOne(filter);

    if (options.select) {
      query = query.select(options.select);
    }

    if (options.populate) {
      if (Array.isArray(options.populate)) {
        options.populate.forEach((path) => {
          query = query.populate(path);
        });
      } else {
        query = query.populate(options.populate);
      }
    }

    return query;
  },

  findMany(filter: object = {}, options: QueryOptions = {}) {
    let query = Broadcast.find(filter);

    if (options.select) {
      query = query.select(options.select);
    }

    if (options.sort) {
      query = query.sort(options.sort);
    }

    if (typeof options.skip === "number") {
      query = query.skip(options.skip);
    }

    if (typeof options.limit === "number") {
      query = query.limit(options.limit);
    }

    if (options.populate) {
      if (Array.isArray(options.populate)) {
        options.populate.forEach((path) => {
          query = query.populate(path);
        });
      } else {
        query = query.populate(options.populate);
      }
    }

    return query;
  },

  updateById(id: string, payload: object) {
    return Broadcast.findByIdAndUpdate(id, payload, {
      returnDocument: "after",
      runValidators: true,
    });
  },

  updateMany(filter: object, payload: object) {
    return Broadcast.updateMany(filter, payload, { runValidators: true });
  },

  deleteById(id: string) {
    return Broadcast.findByIdAndDelete(id);
  },

  deleteMany(filter: object) {
    return Broadcast.deleteMany(filter);
  },

  async exists(filter: object) {
    const doc = await Broadcast.exists(filter);
    return Boolean(doc);
  },

  count(filter: object = {}) {
    return Broadcast.countDocuments(filter);
  },
};