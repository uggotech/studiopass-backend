import { NextFunction, Request, Response } from "express";
import { ZodObject } from "zod";
import AppError from "../errors/AppError";

const validateRequest =
  (schema: ZodObject) =>
  async (req: Request, _res: Response, next: NextFunction) => {
    // Parse req.body.data if it's a string
    if (req.body?.data && typeof req.body.data === "string") {
      try {
        req.body.data = JSON.parse(req.body.data);
      } catch {
        return next(new AppError(400, "Invalid JSON in data field"));
      }
    }

    try {
      await schema.parseAsync({
        body: req.body,
        params: req.params,
        query: req.query,
        cookies: req.cookies,
        data: req.body?.data,
      });
      next();
    } catch (error) {
      next(error);
    }
  };
export default validateRequest;
