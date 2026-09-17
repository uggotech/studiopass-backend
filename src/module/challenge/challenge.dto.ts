import { z } from "zod";

/** Same HH:mm format as Show — any minute 00–59 */
const timeRegex = /^([01]\d|2[0-3]):([0-5]\d)$/;

const createChallenge = z.object({
  body: z.object({
    title: z.string().min(1, "Title is required").max(200),
    type: z.enum(["quiz", "fastest_answer", "question_of_day"], {
      message: "Type must be quiz, fastest_answer, or question_of_day",
    }),
    description: z.string().min(1, "Description is required").max(2000),
    instructions: z.string().max(2000).optional(),
    startDate: z.string().min(1, "Start date is required"),
    startTime: z.string().regex(timeRegex, "Start time must be in HH:mm format"),
    endDate: z.string().min(1, "End date is required"),
    endTime: z.string().regex(timeRegex, "End time must be in HH:mm format"),
    questions: z
      .array(
        z.object({
          text: z.string().min(1, "Question text is required"),
          options: z
            .array(
              z.object({
                label: z.string().min(1, "Option label is required"),
                isCorrect: z.boolean(),
              }),
            )
            .min(2, "At least 2 options required")
            .max(10),
          timeLimit: z.number().int().min(5).max(300).optional(),
        }),
      )
      .min(1, "At least 1 question required"),
    billingMode: z.enum(["credits", "free"]).optional(),
    creditCost: z.number().min(0).optional(),
    rewardText: z.string().max(500).optional(),
    prizeType: z.string().optional(),
    prizeTypeKey: z.string().optional(),
    prizeLabel: z.string().optional(),
    prizeValue: z.string().optional(),
    currency: z.string().optional(),
    numberOfWinners: z.number().int().min(1).optional(),
    sponsorName: z.string().optional(),
    collectionInstructions: z.string().optional(),
  }),
});

const getStationChallenges = z.object({
  query: z.object({
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().positive().max(100).default(20),
    status: z.enum(["draft", "scheduled", "active", "completed", "cancelled"]).optional(),
  }),
});

const getAllChallenges = z.object({
  query: z.object({
    station: z.string().optional(),
    status: z.enum(["draft", "scheduled", "active", "completed", "cancelled"]).optional(),
    type: z.enum(["quiz", "fastest_answer", "question_of_day"]).optional(),
    search: z.string().optional(),
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().positive().max(100).default(20),
  }),
});

const getChallengeById = z.object({
  params: z.object({
    id: z.string().min(1, "Challenge ID is required"),
  }),
});

const participateInChallenge = z.object({
  params: z.object({
    id: z.string().min(1, "Challenge ID is required"),
  }),
  body: z.object({
    answers: z
      .array(
        z.object({
          questionIndex: z.number().int().min(0),
          selectedOption: z.number().int().min(0),
        }),
      )
      .min(1, "At least 1 answer required"),
    timeTaken: z.number().min(0).optional(),
  }),
});

const updateChallenge = z.object({
  params: z.object({
    id: z.string().min(1, "Challenge ID is required"),
  }),
  body: z.object({
    title: z.string().min(1).max(200).optional(),
    description: z.string().min(1).max(2000).optional(),
    instructions: z.string().max(2000).optional(),
    status: z.enum(["draft", "scheduled", "active", "completed"]).optional(),
    rewardText: z.string().max(500).optional(),
    startDate: z.string().optional(),
    startTime: z.string().regex(timeRegex, "Start time must be in HH:mm format").optional(),
    endDate: z.string().optional(),
    endTime: z.string().regex(timeRegex, "End time must be in HH:mm format").optional(),
    questions: z
      .array(
        z.object({
          text: z.string().min(1, "Question text is required"),
          options: z
            .array(
              z.object({
                label: z.string().min(1, "Option label is required"),
                isCorrect: z.boolean(),
              }),
            )
            .min(2, "At least 2 options required")
            .max(10),
          timeLimit: z.number().int().min(5).max(300).optional(),
        }),
      )
      .min(1, "At least 1 question required")
      .optional(),
    billingMode: z.enum(["credits", "free"]).optional(),
    creditCost: z.number().min(0).optional(),
    prizeType: z.string().optional(),
    prizeTypeKey: z.string().optional(),
    prizeLabel: z.string().optional(),
    prizeValue: z.string().optional(),
    currency: z.string().optional(),
    numberOfWinners: z.number().int().min(1).optional(),
    sponsorName: z.string().optional(),
    collectionInstructions: z.string().optional(),
  }),
});

const deleteChallenge = z.object({
  params: z.object({
    id: z.string().min(1, "Challenge ID is required"),
  }),
});

export const ChallengeDto = {
  createChallenge,
  getStationChallenges,
  getAllChallenges,
  getChallengeById,
  participateInChallenge,
  updateChallenge,
  deleteChallenge,
};
