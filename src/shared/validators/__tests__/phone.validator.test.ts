import {
  validatePhoneNumber,
  validateOptionalPhone,
  COUNTRY_PHONE_RULES,
} from "../phone.validator";

let passedTests = 0;
let totalTests = 0;

function assert(condition: boolean, testName: string, details?: any) {
  totalTests++;
  if (condition) {
    passedTests++;
    console.log(`  ✓ ${testName}`);
  } else {
    console.error(`  ✗ FAIL: ${testName}`, details || "");
    throw new Error(`Test failed: ${testName}`);
  }
}

console.log("Starting Phone Validator Test Suite...\n");

// 1. Bangladesh (+880, BD) Tests
console.log("Testing Bangladesh (BD, +880):");
{
  // Valid with leading 0
  const r1 = validatePhoneNumber("01712345678", { iso: "BD", dialCode: "+880" });
  assert(r1.isValid === true, "Valid with leading 0 (01712345678)");
  assert(r1.cleanNational === "1712345678", "Clean national is 1712345678");
  assert(r1.fullPhone === "+8801712345678", "E.164 is +8801712345678");

  // Valid without leading 0
  const r2 = validatePhoneNumber("1812345678", { iso: "BD", dialCode: "+880" });
  assert(r2.isValid === true, "Valid without leading 0 (1812345678)");
  assert(r2.fullPhone === "+8801812345678", "E.164 is +8801812345678");

  // Pasted full number with dial code (+8801712345678)
  const r3 = validatePhoneNumber("+8801712345678", { iso: "BD", dialCode: "+880" });
  assert(r3.isValid === true, "Pasted full number (+8801712345678)");
  assert(r3.fullPhone === "+8801712345678", "E.164 is +8801712345678");

  // Pasted full number with dial code AND trunk 0 (+88001712345678)
  const r4 = validatePhoneNumber("+880 017 1234 5678", { iso: "BD", dialCode: "+880" });
  assert(r4.isValid === true, "Pasted with dial code and trunk 0 (+880 017 1234 5678)");
  assert(r4.fullPhone === "+8801712345678", "E.164 is +8801712345678");

  // Invalid length (too short)
  const r5 = validatePhoneNumber("0171234", { iso: "BD", dialCode: "+880" });
  assert(r5.isValid === false, "Too short rejected");

  // Invalid length (too long)
  const r6 = validatePhoneNumber("0171234567899", { iso: "BD", dialCode: "+880" });
  assert(r6.isValid === false, "Too long rejected");

  // Invalid prefix (starts with 02 - not a valid BD mobile operator)
  const r7 = validatePhoneNumber("0212345678", { iso: "BD", dialCode: "+880" });
  assert(r7.isValid === false, "Invalid prefix rejected (02...)");
}

// 2. Kenya (+254, KE) Tests
console.log("\nTesting Kenya (KE, +254):");
{
  // Valid with leading 0 (07...)
  const r1 = validatePhoneNumber("0712345678", { iso: "KE" });
  assert(r1.isValid === true, "Valid with leading 0 (0712345678)");
  assert(r1.fullPhone === "+254712345678", "E.164 is +254712345678");

  // Valid 01... Safaricom prefix (0110123456)
  const r2 = validatePhoneNumber("0110123456", { iso: "KE" });
  assert(r2.isValid === true, "Valid Safaricom 0110 series (0110123456)");
  assert(r2.fullPhone === "+254110123456", "E.164 is +254110123456");

  // Pasted full number
  const r3 = validatePhoneNumber("+254 712 345 678", { dialCode: "+254" });
  assert(r3.isValid === true, "Pasted full number (+254 712 345 678)");
  assert(r3.fullPhone === "+254712345678", "E.164 is +254712345678");

  // Invalid prefix (08...)
  const r4 = validatePhoneNumber("0812345678", { iso: "KE" });
  assert(r4.isValid === false, "Invalid prefix rejected (08...)");
}

// 3. Uganda (+256, UG) Tests
console.log("\nTesting Uganda (UG, +256):");
{
  const r1 = validatePhoneNumber("0771234567", { iso: "UG" });
  assert(r1.isValid === true, "Valid MTN Uganda (0771234567)");
  assert(r1.fullPhone === "+256771234567", "E.164 is +256771234567");

  const r2 = validatePhoneNumber("701234567", { iso: "UG" });
  assert(r2.isValid === true, "Valid Airtel Uganda without 0 (701234567)");
  assert(r2.fullPhone === "+256701234567", "E.164 is +256701234567");
}

// 4. Nigeria (+234, NG) Tests
console.log("\nTesting Nigeria (NG, +234):");
{
  const r1 = validatePhoneNumber("08012345678", { iso: "NG" });
  assert(r1.isValid === true, "Valid Nigeria with 0 (08012345678)");
  assert(r1.fullPhone === "+2348012345678", "E.164 is +2348012345678");

  const r2 = validatePhoneNumber("+234 901 234 5678", { dialCode: "+234" });
  assert(r2.isValid === true, "Pasted Nigeria full number (+234 901 234 5678)");
  assert(r2.fullPhone === "+2349012345678", "E.164 is +2349012345678");
}

// 5. Ghana (+233, GH) Tests
console.log("\nTesting Ghana (GH, +233):");
{
  const r1 = validatePhoneNumber("0241234567", { iso: "GH" });
  assert(r1.isValid === true, "Valid MTN Ghana (0241234567)");
  assert(r1.fullPhone === "+233241234567", "E.164 is +233241234567");

  const r2 = validatePhoneNumber("0541234567", { iso: "GH" });
  assert(r2.isValid === true, "Valid Telecel Ghana (0541234567)");
  assert(r2.fullPhone === "+233541234567", "E.164 is +233541234567");
}

// 6. Optional Phone Validation (Dashboard) Tests
console.log("\nTesting Optional Phone Validation (Dashboard forms):");
{
  const o1 = validateOptionalPhone("", { iso: "BD" });
  assert(o1.isValid === true && o1.fullPhone === undefined, "Empty string is valid");

  const o2 = validateOptionalPhone(null, { iso: "BD" });
  assert(o2.isValid === true && o2.fullPhone === undefined, "Null is valid");

  const o3 = validateOptionalPhone("01712345678", { iso: "BD" });
  assert(o3.isValid === true && o3.fullPhone === "+8801712345678", "Provided valid phone is formatted");

  const o4 = validateOptionalPhone("123", { iso: "BD" });
  assert(o4.isValid === false, "Provided invalid phone is rejected");
}

// 7. Fallback / Unlisted Country Tests
console.log("\nTesting Fallback / Unlisted Country:");
{
  const f1 = validatePhoneNumber("1234567890", { dialCode: "+33" });
  assert(f1.isValid === true, "Valid fallback 10 digits");
  assert(f1.fullPhone === "+331234567890", "E.164 is +331234567890");

  const f2 = validatePhoneNumber("+33 1234567890", { dialCode: "+33" });
  assert(f2.isValid === true, "Pasted fallback full number");
  assert(f2.fullPhone === "+331234567890", "E.164 is +331234567890");

  const f3 = validatePhoneNumber("123", { dialCode: "+33" });
  assert(f3.isValid === false, "Fallback too short (<7 digits) rejected");
}

console.log(`\nAll ${passedTests}/${totalTests} Tests Passed Successfully!`);
