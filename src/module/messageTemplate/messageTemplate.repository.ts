import MessageTemplate from "./messageTemplate.model";
import { IMessageTemplate } from "./messageTemplate.model";

const findByStation = (stationId: string) => {
  return MessageTemplate.find({ station: stationId, isActive: true })
    .sort({ createdAt: -1 })
    .lean();
};

const create = (data: Partial<IMessageTemplate>) => {
  return MessageTemplate.create(data).then((doc) => doc.toObject());
};

const deleteById = (id: string, stationId: string) => {
  return MessageTemplate.findOneAndUpdate(
    { _id: id, station: stationId },
    { isActive: false },
    { new: true },
  ).lean();
};

const findById = (id: string) => {
  return MessageTemplate.findById(id).lean();
};

export const MessageTemplateRepository = {
  findByStation,
  create,
  deleteById,
  findById,
};
