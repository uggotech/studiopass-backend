import { Show } from "./show.model";
import { TShow } from "./show.interface";

const findByStation = (stationId: string): Promise<TShow[]> => {
  return Show.find({ station: stationId, isActive: true })
    .select("name days startTime endTime")
    .sort({ startTime: 1 })
    .lean();
};

const findById = (id: string): Promise<TShow | null> => {
  return Show.findById(id).lean();
};

const updatePresenter = (showId: string, presenterId: string | null): Promise<TShow | null> => {
  return Show.findByIdAndUpdate(showId, { presenter: presenterId }, { new: true }).lean();
};

export const ShowRepository = {
  findByStation,
  findById,
  updatePresenter,
};
