/**
 * Telecom Carrier Prefix Registry
 * Multi-country mobile network operator (MNO) prefix registry.
 * Maps normalized national prefixes (without leading 0 or dial code) to carrier names.
 */

export interface CarrierRule {
  name: string; // e.g. "Airtel", "MTN", "Safaricom"
  prefixes: RegExp; // Regex matching national significant prefixes
}

export interface CountryCarriers {
  countryIso: string;
  dialCode: string;
  dialDigits: string;
  carriers: CarrierRule[];
}

export const CARRIER_REGISTRY: Record<string, CountryCarriers> = {
  // Uganda (+256)
  // Airtel: 070, 074, 075, 020
  // MTN: 076, 077, 078, 079, 031, 039
  UG: {
    countryIso: "UG",
    dialCode: "+256",
    dialDigits: "256",
    carriers: [
      {
        name: "Airtel",
        prefixes: /^(?:70|74|75|20)\d{7}$/,
      },
      {
        name: "MTN",
        prefixes: /^(?:76|77|78|79|31|39)\d{7}$/,
      },
      {
        name: "UTL",
        prefixes: /^(?:71|41)\d{7}$/,
      },
      {
        name: "Lycamobile",
        prefixes: /^(?:72)\d{7}$/,
      },
    ],
  },

  // Kenya (+254)
  KE: {
    countryIso: "KE",
    dialCode: "+254",
    dialDigits: "254",
    carriers: [
      {
        name: "Safaricom",
        prefixes: /^(?:7(?:0[0-9]|1[0-9]|2[0-9]|4[0-35-68]|5[7-9]|6[8-9]|9[0-9])|1(?:1[0-5]))\d{6}$/,
      },
      {
        name: "Airtel",
        prefixes: /^(?:7(?:3[0-9]|5[0-6]|8[0-9])|1(?:0[0-6]))\d{6}$/,
      },
      {
        name: "Telkom",
        prefixes: /^(?:77[0-9])\d{6}$/,
      },
    ],
  },

  // Nigeria (+234)
  NG: {
    countryIso: "NG",
    dialCode: "+234",
    dialDigits: "234",
    carriers: [
      {
        name: "MTN",
        prefixes: /^(?:80[36]|70[36]|81[0346]|90[36]|91[36])\d{7}$/,
      },
      {
        name: "Airtel",
        prefixes: /^(?:80[28]|70[18]|812|90[1247]|912)\d{7}$/,
      },
      {
        name: "Glo",
        prefixes: /^(?:80[57]|705|81[15]|905|915)\d{7}$/,
      },
      {
        name: "9Mobile",
        prefixes: /^(?:809|81[78]|90[89])\d{7}$/,
      },
    ],
  },

  // Tanzania (+255)
  TZ: {
    countryIso: "TZ",
    dialCode: "+255",
    dialDigits: "255",
    carriers: [
      {
        name: "Vodacom",
        prefixes: /^(?:74|75|76)\d{7}$/,
      },
      {
        name: "Airtel",
        prefixes: /^(?:68|69|78)\d{7}$/,
      },
      {
        name: "Tigo",
        prefixes: /^(?:65|67|71)\d{7}$/,
      },
      {
        name: "Halotel",
        prefixes: /^(?:61|62)\d{7}$/,
      },
    ],
  },

  // Ghana (+233)
  GH: {
    countryIso: "GH",
    dialCode: "+233",
    dialDigits: "233",
    carriers: [
      {
        name: "MTN",
        prefixes: /^(?:24|54|55|59)\d{7}$/,
      },
      {
        name: "Telecel",
        prefixes: /^(?:20|50)\d{7}$/,
      },
      {
        name: "AirtelTigo",
        prefixes: /^(?:26|56|27|57)\d{7}$/,
      },
    ],
  },

  // Bangladesh (+880)
  BD: {
    countryIso: "BD",
    dialCode: "+880",
    dialDigits: "880",
    carriers: [
      {
        name: "Grameenphone",
        prefixes: /^(?:17|13)\d{8}$/,
      },
      {
        name: "Banglalink",
        prefixes: /^(?:19|14)\d{8}$/,
      },
      {
        name: "Robi",
        prefixes: /^(?:18)\d{8}$/,
      },
      {
        name: "Airtel",
        prefixes: /^(?:16)\d{8}$/,
      },
      {
        name: "Teletalk",
        prefixes: /^(?:15)\d{8}$/,
      },
    ],
  },
};
