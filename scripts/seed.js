"use strict";
/* Populate MongoDB with the demo data. Safe to re-run: clears collections first.
   Usage: npm run seed */

require("dotenv").config();

const { connect, disconnect } = require("../src/db");
const { seedDemo } = require("../src/seedData");

async function main() {
  await connect(process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/devhunt");
  console.log("Connected. Reseeding demo data…");
  const r = await seedDemo();
  console.log(`✓ Seeded ${r.jobs} jobs, ${r.contacts} contacts, ${r.leetcode} leetcode entries, 1 profile.`);
  await disconnect();
}

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
