import { Request, Response } from "express";
import catchAsync from "../../shared/catchAsync";
import sendResponse from "../../shared/sendResponse";
import { CountryService } from "./country.service";
import { StatusCodes } from "http-status-codes";

const getAllCountries = catchAsync(async (req: Request, res: Response) => {
  const result = await CountryService.getAllCountries(req.query);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Countries fetched successfully",
    data: result.countries,
    meta: result.meta,
  });
});

const getCountryById = catchAsync(async (req: Request, res: Response) => {
  const result = await CountryService.getCountryById(String(req.params.id));

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Country fetched successfully",
    data: result,
  });
});

const createCountry = catchAsync(async (req: Request, res: Response) => {
  const result = await CountryService.createCountry(req.body);

  sendResponse(res, {
    statusCode: StatusCodes.CREATED,
    success: true,
    message: "Country created successfully",
    data: result,
  });
});

const updateCountry = catchAsync(async (req: Request, res: Response) => {
  const result = await CountryService.updateCountry(String(req.params.id), req.body);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Country updated successfully",
    data: result,
  });
});

const deactivateCountry = catchAsync(async (req: Request, res: Response) => {
  const result = await CountryService.deactivateCountry(String(req.params.id));

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Country deactivated successfully",
    data: result,
  });
});

export const CountryController = {
  getAllCountries,
  getCountryById,
  createCountry,
  updateCountry,
  deactivateCountry,
};
