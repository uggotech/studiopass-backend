import { CarrierService } from "../carrier.service";

let passed = 0;
let total = 0;

function assert(condition: boolean, name: string) {
  total++;
  if (condition) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    console.error(`  ✗ FAIL: ${name}`);
    throw new Error(`Assertion failed: ${name}`);
  }
}

console.log("Starting Carrier Service Test Suite...\n");

// Uganda Tests
console.log("Testing Uganda Operators:");
assert(CarrierService.detectOperator("0701234567") === "Airtel", "070 is Airtel Uganda");
assert(CarrierService.detectOperator("0741234567") === "Airtel", "074 is Airtel Uganda");
assert(CarrierService.detectOperator("0751234567") === "Airtel", "075 is Airtel Uganda");
assert(CarrierService.detectOperator("0201234567") === "Airtel", "020 is Airtel Uganda");
assert(CarrierService.detectOperator("+256201234567") === "Airtel", "+25620 is Airtel Uganda");

assert(CarrierService.detectOperator("0771234567") === "MTN", "077 is MTN Uganda");
assert(CarrierService.detectOperator("0781234567") === "MTN", "078 is MTN Uganda");
assert(CarrierService.detectOperator("0761234567") === "MTN", "076 is MTN Uganda");
assert(CarrierService.detectOperator("0791234567") === "MTN", "079 is MTN Uganda");
assert(CarrierService.detectOperator("0311234567") === "MTN", "031 is MTN Uganda");
assert(CarrierService.detectOperator("0391234567") === "MTN", "039 is MTN Uganda");
assert(CarrierService.detectOperator("+256391234567") === "MTN", "+25639 is MTN Uganda");

assert(CarrierService.detectOperator("0711234567") === "UTL", "071 is UTL Uganda");
assert(CarrierService.detectOperator("0721234567") === "Lycamobile", "072 is Lycamobile Uganda");

// Multi-Country Tests
console.log("\nTesting Multi-Country Operators:");
assert(CarrierService.detectOperator("+254712345678", "KE") === "Safaricom", "+25471... is Safaricom Kenya");
assert(CarrierService.detectOperator("+254733123456", "KE") === "Airtel", "+25473... is Airtel Kenya");
assert(CarrierService.detectOperator("+2348031234567", "NG") === "MTN", "+234803... is MTN Nigeria");
assert(CarrierService.detectOperator("+2348021234567", "NG") === "Airtel", "+234802... is Airtel Nigeria");
assert(CarrierService.detectOperator("+2348051234567", "NG") === "Glo", "+234805... is Glo Nigeria");
assert(CarrierService.detectOperator("+2348091234567", "NG") === "9Mobile", "+234809... is 9Mobile Nigeria");
assert(CarrierService.detectOperator("+8801712345678", "BD") === "Grameenphone", "+88017... is Grameenphone BD");
assert(CarrierService.detectOperator("+8801912345678", "BD") === "Banglalink", "+88019... is Banglalink BD");

console.log(`\nAll ${passed}/${total} Carrier Service Tests Passed Successfully!`);
