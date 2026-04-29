import { TAuth } from "./auth.interface";
import { Auth } from "./auth.model";

type QueryOptions = {
  select?: Record<string, 0 | 1> | string;
  sort?: Record<string, 1 | -1> | string;
  limit?: number;
  skip?: number;
  populate?: string | string[];
};

type FindOneOptions = Pick<QueryOptions, "select" | "populate">;

export const AuthRepository = {
  create(payload: Partial<TAuth>) {
    return Auth.create(payload);
  },

  findById(id: string, options: FindOneOptions = {}) {
    let query = Auth.findById(id);

    if (options.select) {
      query = query.select(options.select);
    }

    return query;
  },

  findOne(filter: object, options: FindOneOptions = {}) {
    let query = Auth.findOne(filter);

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

  updateById(id: string, payload: object) {
    return Auth.findByIdAndUpdate(id, payload, {
      returnDocument: "after",
      runValidators: true,
    });
  },

  deleteById(id: string) {
    return Auth.findByIdAndDelete(id);
  },

  deleteMany(filter: object) {
    return Auth.deleteMany(filter);
  },

  async exists(filter: object) {
    const doc = await Auth.exists(filter);
    return Boolean(doc);
  },

  count(filter: object = {}) {
    return Auth.countDocuments(filter);
  },
};
