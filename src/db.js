"use strict";
/* MongoDB connection helper. */

const mongoose = require("mongoose");

async function connect(uri) {
  if (!uri) throw new Error("MONGODB_URI is not set. Copy .env.example to .env and fill it in.");
  mongoose.set("strictQuery", true);
  await mongoose.connect(uri, {
    serverSelectionTimeoutMS: 8000
  });
  return mongoose.connection;
}

async function disconnect() {
  await mongoose.connection.close();
}

module.exports = { connect, disconnect };
