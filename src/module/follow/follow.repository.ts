import { TFollow } from "./follow.interface";
import { Follow } from "./follow.model";

type QueryOptions = {
  select?: Record<string, 0 | 1> | string;
  sort?: Record<string, 1 | -1> | string;
  limit?: number;
  skip?: number;
  populate?: string | string[];
};

type FindOneOptions = Pick<QueryOptions, "select" | "populate">;

export const FollowRepository = {
  create(payload: Partial<TFollow>) {
    return Follow.create(payload);
  },

  findById(id: string, options: FindOneOptions = {}) {
    let query = Follow.findById(id);

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
    let query = Follow.findOne(filter);

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
    let query = Follow.find(filter);

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

  findOneAndUpdate(filter: object, payload: any, options: any = {}) {
    return Follow.findOneAndUpdate(filter, payload, {
      returnDocument: "after",
      runValidators: true,
      updatePipeline: Array.isArray(payload),
      ...options,
    });
  },

  updateById(id: string, payload: any, options: any = {}) {
    return Follow.findByIdAndUpdate(id, payload, {
      returnDocument: "after",
      runValidators: true,
      updatePipeline: Array.isArray(payload),
      ...options,
    });
  },

  updateMany(filter: object, payload: any, options: any = {}) {
    return Follow.updateMany(filter, payload, {
      runValidators: true,
      updatePipeline: Array.isArray(payload),
      ...options,
    });
  },

  deleteById(id: string) {
    return Follow.findByIdAndDelete(id);
  },

  deleteMany(filter: object) {
    return Follow.deleteMany(filter);
  },

  async exists(filter: object) {
    const doc = await Follow.exists(filter);
    return Boolean(doc);
  },

  count(filter: object = {}) {
    return Follow.countDocuments(filter);
  },
};