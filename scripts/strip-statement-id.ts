import dotenv from "dotenv";
import mongoose from "mongoose";

dotenv.config({ path: ".env" });

async function main() {
  const uri = process.env.DATABASE_URL || "mongodb://localhost:27017/studiopass";
  await mongoose.connect(uri);
  console.log("Connected to MongoDB");

  const db = mongoose.connection.db!;

  // Drop the unique index on statementId if it exists
  try {
    await db.collection("listenerstatements").dropIndex("statementId_1");
    console.log("Dropped index on statementId");
  } catch {
    console.log("No index on statementId to drop");
  }

  // Remove statementId field from all documents
  const result = await db
    .collection("listenerstatements")
    .updateMany({}, { $unset: { statementId: "" } });

  console.log(`Modified ${result.modifiedCount} documents`);
  await mongoose.disconnect();
  console.log("Done");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
