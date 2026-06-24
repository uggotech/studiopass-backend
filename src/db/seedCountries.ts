import { Country } from "module/country/country.model";
import { logger } from "../logger/logger";

const countries = [
  {
    name: "Bangladesh",
    code: "BD",
    phoneCode: "+880",
    currency: "BDT",
    currencySymbol: "\u09f3",
    timezone: "Asia/Dhaka",
    messageCreditPrice: 2,
    callCreditPrice: 5,
    smsProviders: ["twilio"],
    isActive: true,
  },
  {
    name: "India",
    code: "IN",
    phoneCode: "+91",
    currency: "INR",
    currencySymbol: "\u20b9",
    timezone: "Asia/Kolkata",
    messageCreditPrice: 1,
    callCreditPrice: 3,
    smsProviders: ["twilio"],
    isActive: true,
  },
  {
    name: "Kenya",
    code: "KE",
    phoneCode: "+254",
    currency: "KES",
    currencySymbol: "KSh",
    timezone: "Africa/Nairobi",
    messageCreditPrice: 500,
    callCreditPrice: 500,
    smsProviders: ["africas_talking"],
    isActive: true,
  },
  {
    name: "Uganda",
    code: "UG",
    phoneCode: "+256",
    currency: "UGX",
    currencySymbol: "USh",
    timezone: "Africa/Kampala",
    messageCreditPrice: 500,
    callCreditPrice: 500,
    smsProviders: ["africas_talking"],
    isActive: true,
  },
  {
    name: "Nigeria",
    code: "NG",
    phoneCode: "+234",
    currency: "NGN",
    currencySymbol: "\u20a6",
    timezone: "Africa/Lagos",
    messageCreditPrice: 100,
    callCreditPrice: 100,
    smsProviders: ["africas_talking"],
    isActive: true,
  },
  {
    name: "Tanzania",
    code: "TZ",
    phoneCode: "+255",
    currency: "TZS",
    currencySymbol: "TSh",
    timezone: "Africa/Dar_es_Salaam",
    messageCreditPrice: 500,
    callCreditPrice: 500,
    smsProviders: ["africas_talking"],
    isActive: true,
  },
  {
    name: "Ghana",
    code: "GH",
    phoneCode: "+233",
    currency: "GHS",
    currencySymbol: "GH\u20b5",
    timezone: "Africa/Accra",
    messageCreditPrice: 5,
    callCreditPrice: 10,
    smsProviders: ["africas_talking"],
    isActive: true,
  },
  {
    name: "Pakistan",
    code: "PK",
    phoneCode: "+92",
    currency: "PKR",
    currencySymbol: "Rs",
    timezone: "Asia/Karachi",
    messageCreditPrice: 5,
    callCreditPrice: 10,
    smsProviders: ["twilio"],
    isActive: true,
  },
  {
    name: "South Africa",
    code: "ZA",
    phoneCode: "+27",
    currency: "ZAR",
    currencySymbol: "R",
    timezone: "Africa/Johannesburg",
    messageCreditPrice: 10,
    callCreditPrice: 20,
    smsProviders: ["twilio"],
    isActive: true,
  },
  {
    name: "Egypt",
    code: "EG",
    phoneCode: "+20",
    currency: "EGP",
    currencySymbol: "E\u00a3",
    timezone: "Africa/Cairo",
    messageCreditPrice: 10,
    callCreditPrice: 20,
    smsProviders: ["twilio"],
    isActive: true,
  },
];

const seedCountries = async () => {
  const count = await Country.countDocuments();
  if (count > 0) {
    logger.info(`[seed] Countries already seeded (${count} found) — skipping`);
    return;
  }

  await Country.insertMany(countries);
  logger.info(`[seed] Seeded ${countries.length} countries`);
};

export default seedCountries;
