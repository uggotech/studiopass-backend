import { OTP } from "./otp.model";
import { TOTP, OTPType } from "./otp.interface";

const create = (data: Partial<TOTP>): Promise<TOTP> => {
  return OTP.create(data);
};

const findLatestUnused = (userId: string, type: OTPType): Promise<TOTP | null> => {
  return OTP.findOne({ userId, type, isUsed: false })
    .sort({ createdAt: -1 })
    .select("+otp")
    .lean();
};

const incrementAttempts = async (id: string): Promise<void> => {
  await OTP.findByIdAndUpdate(id, { $inc: { attempts: 1 } });
};

const markUsed = async (id: string): Promise<void> => {
  await OTP.findByIdAndUpdate(id, { isUsed: true });
};

export const OtpRepository = {
  create,
  findLatestUnused,
  incrementAttempts,
  markUsed,
};
