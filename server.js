"use strict";
/* Entry point: load config, connect to MongoDB, start the HTTP server. */

require("dotenv").config();

const { buildApp } = require("./src/app");
const { connect } = require("./src/db");

const PORT = process.env.PORT || 4000;
const MONGODB_URI = process.env.MONGODB_URI;
const CORS_ORIGIN = process.env.CORS_ORIGIN || "*";

async function main() {
  try {
    await connect(MONGODB_URI);
    console.log("✓ Connected to MongoDB");
  } catch (err) {
    console.error("✗ Could not connect to MongoDB:", err.message);
    console.error("  Check MONGODB_URI in your .env file (see .env.example).");
    process.exit(1);
  }

  const corsOrigin = CORS_ORIGIN === "*" ? "*" : CORS_ORIGIN.split(",").map((s) => s.trim());
  const app = buildApp({ corsOrigin });

  const server = app.listen(PORT, () => {
    console.log(`✓ DevHunt running at http://localhost:${PORT}`);
    console.log(`  API base:  http://localhost:${PORT}/api`);
  });

  const shutdown = (sig) => {
    console.log(`\n${sig} received — shutting down…`);
    server.close(() => process.exit(0));
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main();
