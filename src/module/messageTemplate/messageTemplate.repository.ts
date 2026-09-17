import MessageTemplate from "./messageTemplate.model";
import { TMessageTemplate } from "./messageTemplate.interface";

const findByStation = (stationId: string) => {
  return MessageTemplate.find({ station: stationId, isActive: true })
    .sort({ createdAt: -1 })
    .lean();
};

const create = (data: Partial<TMessageTemplate>) => {
  return MessageTemplate.create(data).then((doc) => doc.toObject());
};

const deleteById = (id: string, stationId: string) => {
  return MessageTemplate.findOneAndUpdate(
    { _id: id, station: stationId },
    { isActive: false },
    { returnDocument: "after" },
  ).lean();
};

const findById = (id: string) => {
  return MessageTemplate.findById(id).lean();
};

const updateById = (id: string, stationId: string, text: string) => {
  return MessageTemplate.findOneAndUpdate(
    { _id: id, station: stationId, isActive: true },
    { text },
    { returnDocument: "after" },
  ).lean();
};

export const MessageTemplateRepository = {
  findByStation,
  create,
  deleteById,
  findById,
  updateById,
};
