import Stripe from "stripe";
import config from "../config";
import AppError from "../errors/AppError";
import { StatusCodes } from "http-status-codes";

let stripeClient: InstanceType<typeof Stripe> | null = null;

export const getStripeClient = (): InstanceType<typeof Stripe> => {
  if (stripeClient) return stripeClient;

  const secretKey = config.stripe?.secret_key;

  if (!secretKey) {
    throw new AppError(
      StatusCodes.INTERNAL_SERVER_ERROR,
      "Stripe secret key is not configured",
    );
  }

  stripeClient = new Stripe(secretKey);

  return stripeClient;
};
