import { StatusCodes } from "http-status-codes";
import AppError from "../../errors/AppError";
import { ShowRepository } from "./show.repository";
import { StationRepository } from "../station/station.repository";

const getShowsByStation = async (stationId: string) => {
  const station = await StationRepository.findById(stationId);
  if (!station) {
    throw new AppError(StatusCodes.NOT_FOUND, "Station not found");
  }

  const shows = await ShowRepository.findByStation(stationId);

  return shows.map((s) => ({
    id: s._id,
    name: s.name,
    days: s.days,
    startTime: s.startTime,
    endTime: s.endTime,
  }));
};

export const ShowService = {
  getShowsByStation,
};
