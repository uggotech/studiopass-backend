import mongoose from "mongoose";

const MAX_ATTEMPTS = 10;

const hasLabel = (error: any, label: string): boolean =>
  !!(error?.hasErrorLabel?.(label) || error?.errorLabelSet?.has?.(label) || error?.cause?.hasErrorLabel?.(label));

/**
 * True when the whole transaction can safely run again: MongoDB aborted it because two transactions
 * touched the same document (a write conflict). Busy rows hit this constantly: every vote increments
 * the same poll, every send of one listener decrements the same balance.
 */
export const isTransientTransactionError = (error: any): boolean =>
  !!error &&
  (error.code === 112 ||
    error.codeName === "WriteConflict" ||
    error.cause?.code === 112 ||
    hasLabel(error, "TransientTransactionError"));

const pause = (attempt: number) => new Promise((resolve) => setTimeout(resolve, 10 + Math.random() * 30 * attempt));

/**
 * Run `work` in a transaction and retry it (up to 10 times, with a short random pause) when MongoDB
 * reports a transient conflict, the same way the driver's `withTransaction` does:
 *  - a conflict while working  -> abort and run `work` again
 *  - an unknown commit result  -> retry only the commit (never run `work` twice for one commit)
 * Any other error aborts and is thrown unchanged. `work` must only write through the given session,
 * so an aborted attempt leaves nothing behind.
 */
export const runTransaction = async <T>(work: (session: mongoose.ClientSession) => Promise<T>): Promise<T> => {
  for (let attempt = 1; ; attempt++) {
    const session = await mongoose.startSession();
    try {
      session.startTransaction();
      let result: T;
      try {
        result = await work(session);
      } catch (error) {
        await session.abortTransaction().catch(() => undefined);
        if (attempt < MAX_ATTEMPTS && isTransientTransactionError(error)) {
          await pause(attempt);
          continue;
        }
        throw error;
      }

      for (let commitAttempt = 1; ; commitAttempt++) {
        try {
          await session.commitTransaction();
          return result;
        } catch (error) {
          if (commitAttempt < MAX_ATTEMPTS && hasLabel(error, "UnknownTransactionCommitResult")) {
            await pause(commitAttempt);
            continue;
          }
          throw error;
        }
      }
    } catch (error) {
      // A commit that failed with TransientTransactionError did not happen: the whole transaction may run again
      if (attempt < MAX_ATTEMPTS && hasLabel(error, "TransientTransactionError") && !hasLabel(error, "UnknownTransactionCommitResult")) {
        await pause(attempt);
        continue;
      }
      throw error;
    } finally {
      session.endSession();
    }
  }
};
