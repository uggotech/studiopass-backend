import mongoose from "mongoose";
import { StatusCodes } from "http-status-codes";
import AppError from "../../errors/AppError";
import { CreditPackage, TCreditPackage } from "./payment.package.model";

/** What the app sees: only active packages, only the fields it needs. */
export interface CreditPackageView {
  id: string;
  amountUgx: number;
  credits: number;
  label: string;
}

/** What the Super Admin dashboard sees. */
export interface CreditPackageAdminView extends CreditPackageView {
  isActive: boolean;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
}

const toView = (p: Pick<TCreditPackage, "_id" | "amountUgx" | "credits" | "label">): CreditPackageView => ({
  id: String(p._id),
  amountUgx: p.amountUgx,
  credits: p.credits,
  label: p.label,
});

const toAdminView = (p: TCreditPackage): CreditPackageAdminView => ({
  ...toView(p),
  isActive: p.isActive,
  sortOrder: p.sortOrder,
  createdAt: p.createdAt,
  updatedAt: p.updatedAt,
});

/** Active packages for the app, cheapest first within the same sort order. */
export async function getCreditPackages(): Promise<CreditPackageView[]> {
  const rows = await CreditPackage.find({ isActive: true }).sort({ sortOrder: 1, amountUgx: 1 }).lean();
  return rows.map(toView);
}

/** An ACTIVE package by id (the id sent by the app). Inactive or unknown ids return undefined. */
export async function findCreditPackage(packageId: string): Promise<CreditPackageView | undefined> {
  if (!mongoose.isValidObjectId(packageId)) return undefined;
  const row = await CreditPackage.findOne({ _id: packageId, isActive: true }).lean();
  return row ? toView(row) : undefined;
}

// ── Super Admin management ──────────────────────────────────────────────────

export async function listAllCreditPackages(): Promise<CreditPackageAdminView[]> {
  const rows = await CreditPackage.find({}).sort({ isActive: -1, sortOrder: 1, amountUgx: 1 }).lean();
  return rows.map(toAdminView);
}

export type CreditPackageInput = {
  label: string;
  amountUgx: number;
  credits: number;
  isActive?: boolean;
  sortOrder?: number;
};

export async function createCreditPackage(input: CreditPackageInput): Promise<CreditPackageAdminView> {
  const created = await CreditPackage.create(input);
  return toAdminView(created.toObject());
}

export async function updateCreditPackage(
  packageId: string,
  patch: Partial<CreditPackageInput>,
): Promise<CreditPackageAdminView> {
  if (!mongoose.isValidObjectId(packageId)) {
    throw new AppError(StatusCodes.NOT_FOUND, "Credit package not found");
  }
  const updated = await CreditPackage.findByIdAndUpdate(
    packageId,
    { $set: patch },
    { returnDocument: "after", runValidators: true },
  ).lean();
  if (!updated) throw new AppError(StatusCodes.NOT_FOUND, "Credit package not found");
  return toAdminView(updated);
}
