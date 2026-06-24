import { Router } from "express";
import { CountryController } from "./country.controller";
import { CountryDto } from "./country.dto";
import { UserRole } from "shared/roles";
import auth from "../../middlewares/auth";
import validateRequest from "../../middlewares/validateRequest";

const router = Router();

// Public: list all active countries
router.get("/", CountryController.getAllCountries);

// Public: get single country
router.get("/:id", CountryController.getCountryById);

// Super admin: create country
router.post(
  "/",
  auth(UserRole.SUPER_ADMIN),
  validateRequest(CountryDto.createCountry),
  CountryController.createCountry,
);

// Super admin: update country
router.patch(
  "/:id",
  auth(UserRole.SUPER_ADMIN),
  validateRequest(CountryDto.updateCountry),
  CountryController.updateCountry,
);

// Super admin: deactivate country
router.patch(
  "/:id/deactivate",
  auth(UserRole.SUPER_ADMIN),
  CountryController.deactivateCountry,
);

export const CountryRoutes = router;
