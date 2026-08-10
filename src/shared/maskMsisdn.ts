import Message from "../module/message/message.model";

/**
 * Mask a phone number for display to restricted roles.
 * "+8801815635091" → "+8801****091"
 */
export const maskMsisdn = (phone: string): string => {
  if (!phone || phone.length < 8) return phone;
  const hasPlus = phone.startsWith("+");
  const clean = hasPlus ? phone.substring(1) : phone;
  if (clean.length < 8) return phone;
  const prefix = clean.substring(0, 4);
  const suffix = clean.substring(clean.length - 3);
  return `${hasPlus ? "+" : ""}${prefix}****${suffix}`;
};

/**
 * Check if a role should see masked msisdn.
 */
export const shouldMaskMsisdn = (role: string): boolean => {
  return ["presenter", "media_station"].includes(role);
};

/**
 * Resolve a masked msisdn back to the real phone number by querying the Message collection.
 * "+8801****091" → "+8801815635091"
 *
 * @param maskedMsisdn - The masked phone string containing "****"
 * @param stationId - Station scope to narrow the search
 * @returns The real msisdn, or the original string if not masked / not found
 */
export const resolveMsisdn = async (
  maskedMsisdn: string,
  stationId: string,
): Promise<string> => {
  if (!maskedMsisdn.includes("****")) return maskedMsisdn;

  const starIdx = maskedMsisdn.indexOf("****");
  const prefix = maskedMsisdn.substring(0, starIdx).replace("+", "");
  const suffix = maskedMsisdn.substring(starIdx + 4);
  const regex = new RegExp(`^\\+?${prefix}.*${suffix}$`);

  const userMsg = await Message.findOne({
    station: stationId,
    senderType: "user",
    msisdn: regex,
  })
    .sort({ createdAt: -1 })
    .lean();

  return userMsg ? (userMsg as any).msisdn : maskedMsisdn;
};

/**
 * Recursively walk a value and mask any msisdn string fields.
 */
const maskNested = (value: any): any => {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(maskNested);
  if (value && typeof value === "object" && value.constructor !== Object) return value;
  if (value && typeof value === "object") {
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(value)) {
      if (k === "msisdn" && typeof v === "string") {
        out[k] = maskMsisdn(v);
      } else {
        out[k] = maskNested(v);
      }
    }
    return out;
  }
  return value;
};

/**
 * Express middleware that intercepts res.json() and masks msisdn fields
 * for presenter and media_station roles.
 *
 * Usage: app.use("/api/v1/message", msisdnMasker, MessageRoutes);
 *    or: router.get("/", auth(...), msisdnMasker, controller);
 */
export const msisdnMasker = (req: any, res: any, next: any) => {
  const originalJson = res.json.bind(res);
  res.json = (body: any) => {
    const role = req.user?.role;
    if (role && shouldMaskMsisdn(role) && body && typeof body === "object" && "data" in body) {
      body.data = maskNested(body.data);
    }
    return originalJson(body);
  };
  next();
};
