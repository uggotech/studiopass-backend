import { Request, Response } from "express";
import catchAsync from "../../shared/catchAsync";
import sendResponse from "../../shared/sendResponse";
import { PartnerService } from "./partner.service";
import { StatusCodes } from "http-status-codes";

const getAllPartners = catchAsync(async (req: Request, res: Response) => {
  const result = await PartnerService.getAllPartners(req.query);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Partners fetched successfully",
    data: result.partners,
    meta: result.meta,
  });
});

const getPartnerById = catchAsync(async (req: Request, res: Response) => {
  const result = await PartnerService.getPartnerById(String(req.params.id));

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Partner fetched successfully",
    data: result,
  });
});

const createPartnerWithAdmin = catchAsync(async (req: Request, res: Response) => {
  const result = await PartnerService.createPartnerWithAdmin(req.body);

  sendResponse(res, {
    statusCode: StatusCodes.CREATED,
    success: true,
    message: "Partner and admin created successfully",
    data: result,
  });
});

const updatePartner = catchAsync(async (req: Request, res: Response) => {
  const result = await PartnerService.updatePartner(String(req.params.id), req.body);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Partner updated successfully",
    data: result,
  });
});

const deactivatePartner = catchAsync(async (req: Request, res: Response) => {
  const result = await PartnerService.deactivatePartner(String(req.params.id));

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Partner deactivated successfully",
    data: result,
  });
});

const reactivatePartner = catchAsync(async (req: Request, res: Response) => {
  const result = await PartnerService.reactivatePartner(String(req.params.id));

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Partner reactivated successfully",
    data: result,
  });
});

export const PartnerController = {
  getAllPartners,
  getPartnerById,
  createPartnerWithAdmin,
  updatePartner,
  deactivatePartner,
  reactivatePartner,
};
