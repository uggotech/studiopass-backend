import { Request, Response } from "express";
import catchAsync from "../../shared/catchAsync";
import sendResponse from "../../shared/sendResponse";
import { StatusCodes } from "http-status-codes";
import { MessageTemplateService } from "./messageTemplate.service";

const getTemplates = catchAsync(async (req: Request, res: Response) => {
  const user = req.user as any;
  const stationId = user.stationId.toString();

  const result = await MessageTemplateService.getTemplates(stationId);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Templates fetched successfully",
    data: result,
  });
});

const createTemplate = catchAsync(async (req: Request, res: Response) => {
  const user = req.user as any;
  const stationId = user.stationId.toString();
  const { text } = req.body;
  const createdBy = user._id.toString();

  const result = await MessageTemplateService.createTemplate(
    stationId,
    text,
    createdBy,
  );

  sendResponse(res, {
    statusCode: StatusCodes.CREATED,
    success: true,
    message: "Template created successfully",
    data: result,
  });
});

const deleteTemplate = catchAsync(async (req: Request, res: Response) => {
  const user = req.user as any;
  const id = req.params.id as string;
  const stationId = user.stationId.toString();

  await MessageTemplateService.deleteTemplate(id, stationId);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Template deleted successfully",
  });
});

export const MessageTemplateController = {
  getTemplates,
  createTemplate,
  deleteTemplate,
};
