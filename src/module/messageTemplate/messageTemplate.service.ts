import { StatusCodes } from "http-status-codes";
import AppError from "../../errors/AppError";
import { MessageTemplateRepository } from "./messageTemplate.repository";

const getTemplates = async (stationId: string) => {
  return MessageTemplateRepository.findByStation(stationId);
};

const createTemplate = async (
  stationId: string,
  text: string,
  createdBy: string,
) => {
  return MessageTemplateRepository.create({
    station: stationId as any,
    text,
    createdBy: createdBy as any,
    isActive: true,
  });
};

const deleteTemplate = async (id: string, stationId: string) => {
  const template = await MessageTemplateRepository.findById(id);

  if (!template || template.station.toString() !== stationId) {
    throw new AppError(StatusCodes.NOT_FOUND, "Template not found");
  }

  return MessageTemplateRepository.deleteById(id, stationId);
};

export const MessageTemplateService = {
  getTemplates,
  createTemplate,
  deleteTemplate,
};
