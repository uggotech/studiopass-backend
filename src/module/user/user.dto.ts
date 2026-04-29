import z from "zod";

/** PATCH /user/me — update full name and/or optional email */
const updateProfileDto = z.object({
  body: z
    .object({
      fullName: z.string().min(1, "Full name cannot be empty").trim().optional(),
      email: z.email("Invalid email address").toLowerCase().optional(),
      preferences: z
        .object({
          theme: z.enum(["default", "dark", "light"]).optional(),
          language: z.enum(["english", "swahili"]).optional(),
        })
        .optional(),
    })
    .strict(),
});

export const UserDto = {
  updateProfile: updateProfileDto,
};

