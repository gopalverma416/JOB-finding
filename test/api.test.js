"use strict";
/* Integration tests: spin up an in-memory MongoDB, mount the real Express app,
   and exercise every endpoint with supertest. Run with: npm test */

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");
const request = require("supertest");

const { buildApp } = require("../src/app");
const { seedDemo } = require("../src/seedData");

let mongod;
let app;

before(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  app = buildApp({ corsOrigin: "*" });
});

after(async () => {
  await mongoose.disconnect();
  if (mongod) await mongod.stop();
});

test("health endpoint reports connected db", async () => {
  const res = await request(app).get("/api/health");
  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.db, "connected");
});

test("seedDemo populates collections and GET /jobs returns them", async () => {
  await seedDemo();
  const res = await request(app).get("/api/jobs");
  assert.equal(res.status, 200);
  assert.equal(res.body.length, 3);
  // sorted by dateAdded desc → Nimbus (2 days ago) first
  assert.match(res.body[0].company, /Nimbus/);
  // each job carries an `id` (not `_id`) and a subStages object
  assert.ok(res.body[0].id);
  assert.equal(res.body[0]._id, undefined);
  assert.equal(typeof res.body[0].subStages, "object");
});

test("POST /jobs validates required company", async () => {
  const res = await request(app).post("/api/jobs").send({ role: "Backend" });
  assert.equal(res.status, 400);
  assert.match(res.body.error, /Company/);
});

test("POST /jobs creates a job and parses a comma-separated stack string", async () => {
  const res = await request(app).post("/api/jobs").send({
    company: "Acme", role: "Backend", stack: "Go, Rust, AWS", salary: 180000, status: "applied"
  });
  assert.equal(res.status, 201);
  assert.equal(res.body.company, "Acme");
  assert.deepEqual(res.body.stack, ["Go", "Rust", "AWS"]);
  assert.equal(res.body.salary, 180000);
  // creating directly into "applied" logs a history entry
  assert.equal(res.body.history.length, 1);
  assert.equal(res.body.history[0].to, "applied");
});

test("PATCH /jobs/:id/move records history and updates status", async () => {
  const created = await request(app).post("/api/jobs").send({ company: "MoveCo", status: "wishlist" });
  const id = created.body.id;
  const moved = await request(app).patch(`/api/jobs/${id}/move`).send({ status: "interviewing" });
  assert.equal(moved.status, 200);
  assert.equal(moved.body.status, "interviewing");
  assert.equal(moved.body.history.at(-1).from, "wishlist");
  assert.equal(moved.body.history.at(-1).to, "interviewing");
});

test("PATCH move rejects an invalid status", async () => {
  const created = await request(app).post("/api/jobs").send({ company: "BadMove" });
  const res = await request(app).patch(`/api/jobs/${created.body.id}/move`).send({ status: "nope" });
  assert.equal(res.status, 400);
});

test("PUT /jobs/:id updates fields and logs status change history", async () => {
  const created = await request(app).post("/api/jobs").send({ company: "PutCo", status: "wishlist" });
  const id = created.body.id;
  const res = await request(app).put(`/api/jobs/${id}`).send({ notes: "updated", status: "offer" });
  assert.equal(res.status, 200);
  assert.equal(res.body.notes, "updated");
  assert.equal(res.body.status, "offer");
  assert.equal(res.body.history.at(-1).to, "offer");
});

test("DELETE /jobs/:id unlinks its contacts", async () => {
  const job = (await request(app).post("/api/jobs").send({ company: "LinkCo" })).body;
  const contact = (await request(app).post("/api/contacts").send({ name: "Linked HR", jobId: job.id })).body;
  assert.equal(contact.jobId, job.id);
  const del = await request(app).delete(`/api/jobs/${job.id}`);
  assert.equal(del.status, 200);
  const after = (await request(app).get("/api/contacts?q=Linked HR")).body[0];
  assert.equal(after.jobId, null);
});

test("invalid ObjectId returns 400, missing returns 404", async () => {
  assert.equal((await request(app).get("/api/jobs/not-an-id")).status, 400);
  assert.equal((await request(app).get("/api/jobs/64b7f9a2c1234567890abcde")).status, 404);
});

test("POST /contacts requires a name and lowercases email", async () => {
  assert.equal((await request(app).post("/api/contacts").send({ title: "Recruiter" })).status, 400);
  const res = await request(app).post("/api/contacts").send({ name: "Jane Doe", email: "JANE@ACME.COM" });
  assert.equal(res.status, 201);
  assert.equal(res.body.email, "jane@acme.com");
});

test("POST /contacts/import dedupes by email and name+company", async () => {
  await request(app).post("/api/contacts").send({ name: "Existing One", email: "dup@x.io" });
  const res = await request(app).post("/api/contacts/import").send({
    contacts: [
      { name: "Existing One", email: "DUP@x.io" },            // dup by email (case-insensitive)
      { name: "Fresh Person", email: "fresh@x.io" },           // new
      { name: "Fresh Person", email: "fresh@x.io" }            // dup within same batch
    ]
  });
  assert.equal(res.status, 201);
  assert.equal(res.body.added, 1);
  assert.equal(res.body.skipped, 2);
  assert.equal(res.body.contacts[0].name, "Fresh Person");
});

test("contact search ?q matches name/company/email", async () => {
  await request(app).post("/api/contacts").send({ name: "Searchable Sam", company: "Globex", email: "sam@globex.io" });
  const byName = await request(app).get("/api/contacts?q=Searchable");
  assert.ok(byName.body.some((c) => c.name === "Searchable Sam"));
  const byCompany = await request(app).get("/api/contacts?q=globex");
  assert.ok(byCompany.body.some((c) => c.company === "Globex"));
});

test("leetcode CRUD: create, list, delete", async () => {
  const before = (await request(app).get("/api/leetcode")).body.length;
  const created = await request(app).post("/api/leetcode").send({ title: "Valid Parentheses", difficulty: "Easy", topic: "Stack" });
  assert.equal(created.status, 201);
  assert.equal(created.body.title, "Valid Parentheses");
  const mid = (await request(app).get("/api/leetcode")).body.length;
  assert.equal(mid, before + 1);
  const del = await request(app).delete(`/api/leetcode/${created.body.id}`);
  assert.equal(del.status, 200);
  const after = (await request(app).get("/api/leetcode")).body.length;
  assert.equal(after, before);
});

test("leetcode rejects bad difficulty by coercing to Easy", async () => {
  const res = await request(app).post("/api/leetcode").send({ title: "X", difficulty: "Impossible" });
  assert.equal(res.status, 201);
  assert.equal(res.body.difficulty, "Easy");
});

test("profile GET creates singleton, PUT persists partial updates", async () => {
  const got = await request(app).get("/api/profile");
  assert.equal(got.status, 200);
  const put = await request(app).put("/api/profile").send({ resumeStack: "Go, k8s", goals: { Easy: 10, Medium: 20, Hard: 5 } });
  assert.equal(put.status, 200);
  assert.equal(put.body.resumeStack, "Go, k8s");
  assert.equal(put.body.goals.Medium, 20);
  // second GET reflects the change (singleton, not a new doc)
  const again = await request(app).get("/api/profile");
  assert.equal(again.body.resumeStack, "Go, k8s");
});

test("POST /reset reseeds the demo dataset", async () => {
  await request(app).post("/api/jobs").send({ company: "WillBeWiped" });
  const res = await request(app).post("/api/reset");
  assert.equal(res.status, 200);
  const jobs = (await request(app).get("/api/jobs")).body;
  assert.equal(jobs.length, 3);
  assert.ok(!jobs.some((j) => j.company === "WillBeWiped"));
});

test("POST /restore replaces data and remaps contact jobId links", async () => {
  const backup = {
    jobs: [{ id: "old123", company: "RestoreCo", status: "applied", stack: ["Go"], history: [{ from: "wishlist", to: "applied", ts: new Date().toISOString() }] }],
    contacts: [{ id: "c1", name: "Restored HR", email: "hr@restore.io", jobId: "old123" }],
    leetcode: [{ title: "Restored Problem", difficulty: "Hard", topic: "DP" }],
    goals: { Easy: 1, Medium: 2, Hard: 3 },
    resumeStack: "restored stack"
  };
  const res = await request(app).post("/api/restore").send(backup);
  assert.equal(res.status, 200);
  const jobs = (await request(app).get("/api/jobs")).body;
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].company, "RestoreCo");
  const contacts = (await request(app).get("/api/contacts")).body;
  assert.equal(contacts.length, 1);
  // the contact's jobId should now point at the NEW job _id, not "old123"
  assert.equal(contacts[0].jobId, jobs[0].id);
  const profile = (await request(app).get("/api/profile")).body;
  assert.equal(profile.resumeStack, "restored stack");
});

test("POST /contacts rejects an invalid email", async () => {
  const res = await request(app).post("/api/contacts").send({ name: "Bad Email", email: "not-an-email" });
  assert.equal(res.status, 400);
  assert.match(res.body.error, /email/i);
});

test("PUT /profile strips unknown/mass-assignment keys from Mixed fields", async () => {
  const res = await request(app).put("/api/profile").send({
    csChecklist: { caching: true, hackerInjected: true },
    goals: { Easy: 9, Bogus: 999 },
    aiCache: { jd: "x", resume: "y", evil: "z" },
    isAdmin: true
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.csChecklist.caching, true);
  assert.equal(res.body.csChecklist.hackerInjected, undefined);
  assert.equal(res.body.goals.Easy, 9);
  assert.equal(res.body.goals.Bogus, undefined);
  assert.equal(res.body.aiCache.jd, "x");
  assert.equal(res.body.aiCache.evil, undefined);
  assert.equal(res.body.isAdmin, undefined);
});

test("POST /profile/beacon persists a sanitized patch and returns 204", async () => {
  const res = await request(app).post("/api/profile/beacon").send({ resumeStack: "beacon stack", nope: 1 });
  assert.equal(res.status, 204);
  const prof = (await request(app).get("/api/profile")).body;
  assert.equal(prof.resumeStack, "beacon stack");
  assert.equal(prof.nope, undefined);
});

test("POST /restore drops history entries with invalid columns", async () => {
  const res = await request(app).post("/api/restore").send({
    jobs: [{ id: "j1", company: "HistCo", status: "applied", history: [
      { from: "wishlist", to: "applied", ts: new Date().toISOString() },
      { from: "garbage", to: "alsoBad", ts: new Date().toISOString() }
    ] }],
    contacts: [], leetcode: []
  });
  assert.equal(res.status, 200);
  const job = (await request(app).get("/api/jobs")).body.find((j) => j.company === "HistCo");
  assert.equal(job.history.length, 1);
  assert.equal(job.history[0].to, "applied");
});

test("malformed JSON body returns 400", async () => {
  const res = await request(app)
    .post("/api/jobs")
    .set("Content-Type", "application/json")
    .send('{"company": "broken"');
  assert.equal(res.status, 400);
});
