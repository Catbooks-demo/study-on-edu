import { PrismaClient } from "@prisma/client";
import { runSeed } from "./seed-lib";

const db = new PrismaClient();

runSeed(db, {
  staffEmail: process.env.SEED_STAFF_EMAIL,
  staffPassword: process.env.SEED_STAFF_PASSWORD,
  instructorPassword: process.env.SEED_INSTRUCTOR_PASSWORD,
})
  .then((r) => {
    console.log(JSON.stringify({ msg: "시드 완료", ...r }));
  })
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
