import { ChallengeParticipation } from "./challengeParticipation.model";

const create = (data: Record<string, unknown>) => {
  const doc = new ChallengeParticipation(data);
  return doc.save().then((d) => d.toObject());
};

const findById = (id: string) => {
  return ChallengeParticipation.findById(id).lean();
};

const findByChallengeAndUser = (challengeId: string, userId: string) => {
  return ChallengeParticipation.findOne({
    challenge: challengeId,
    user: userId,
  }).lean();
};

const findByUserAndChallenges = (userId: string, challengeIds: Array<string | unknown>) => {
  return ChallengeParticipation.find({
    user: userId,
    challenge: { $in: challengeIds as never[] },
  })
    .select("challenge score timeTaken submittedAt")
    .lean();
};

const findByUser = (userId: string, skip: number, limit: number) => {
  return ChallengeParticipation.find({ user: userId })
    .populate({
      path: "challenge",
      select:
        "title type description instructions status prizeLabel prizeValue prizeTypeKey currency numberOfWinners rewardText billingMode creditCost station startsAt endsAt startDate endDate startTime endTime createdAt",
      populate: { path: "station", select: "name category logo" },
    })
    .sort({ submittedAt: -1 })
    .skip(skip)
    .limit(limit)
    .lean();
};

const countByUser = (userId: string) => {
  return ChallengeParticipation.countDocuments({ user: userId });
};

const findByChallenge = (challengeId: string, skip: number, limit: number) => {
  return ChallengeParticipation.find({ challenge: challengeId })
    .populate("user", "fullName avatar")
    .sort({ score: -1, timeTaken: 1 })
    .skip(skip)
    .limit(limit)
    .lean();
};

const countByChallenge = (challengeId: string) => {
  return ChallengeParticipation.countDocuments({ challenge: challengeId });
};

const findByChallengeIdSorted = (challengeId: string) => {
  return ChallengeParticipation.find({ challenge: challengeId })
    .sort({ score: -1, timeTaken: 1, createdAt: 1 })
    .lean();
};

const getLeaderboard = (challengeId: string, limit: number = 10) => {
  return ChallengeParticipation.find({ challenge: challengeId })
    .populate("user", "fullName avatar")
    .sort({ score: -1, timeTaken: 1 })
    .limit(limit)
    .lean();
};

/** Count participations strictly better than (score, timeTaken) for rank. */
const countBetterThan = (challengeId: string, score: number, timeTaken: number) => {
  return ChallengeParticipation.countDocuments({
    challenge: challengeId,
    $or: [
      { score: { $gt: score } },
      { score, timeTaken: { $lt: timeTaken } },
    ],
  });
};

const getAdminLeaderboard = (challengeId: string, skip: number = 0, limit: number = 50) => {
  return ChallengeParticipation.find({ challenge: challengeId })
    .populate("user", "fullName phone avatar msisdn")
    .sort({ score: -1, timeTaken: 1, createdAt: 1 })
    .skip(skip)
    .limit(limit)
    .lean();
};

const deleteByChallenge = (challengeId: string) => {
  return ChallengeParticipation.deleteMany({ challenge: challengeId });
};

export const ChallengeParticipationRepository = {
  create,
  findById,
  findByChallengeAndUser,
  findByUserAndChallenges,
  findByUser,
  countByUser,
  findByChallenge,
  findByChallengeIdSorted,
  countByChallenge,
  getLeaderboard,
  countBetterThan,
  getAdminLeaderboard,
  deleteByChallenge,
};
