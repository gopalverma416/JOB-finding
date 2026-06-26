"use strict";
/* Express application factory. Kept separate from server.js so tests can
   import the app and drive it with supertest without binding a port. */

const path = require("path");
const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");
const { Job, Contact, Leetcode, Profile, COLUMN_IDS, DIFFICULTIES } = require("./models");
const { seedDemo } = require("./seedData");

const PROFILE_KEY = "default";

/* small async wrapper so route handlers can throw and hit the error middleware */
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function isValidObjectId(id) {
  return mongoose.Types.ObjectId.isValid(String(id));
}

function buildApp(opts) {
  opts = opts || {};
  const app = express();

  app.use(cors({ origin: opts.corsOrigin || "*" }));
  app.use(express.json({ limit: "2mb" }));

  const api = express.Router();

  /* -------------------- health -------------------- */
  api.get("/health", (req, res) => {
    const states = ["disconnected", "connected", "connecting", "disconnecting"];
    res.json({
      ok: true,
      db: states[mongoose.connection.readyState] || "unknown",
      time: new Date().toISOString()
    });
  });

  /* ==================== JOBS ==================== */
  api.get("/jobs", wrap(async (req, res) => {
    const filter = {};
    if (req.query.status && COLUMN_IDS.includes(req.query.status)) filter.status = req.query.status;
    const jobs = await Job.find(filter).sort({ dateAdded: -1 });
    res.json(jobs);
  }));

  api.post("/jobs", wrap(async (req, res) => {
    const b = req.body || {};
    if (!b.company || !String(b.company).trim()) {
      return res.status(400).json({ error: "Company name is required." });
    }
    const status = COLUMN_IDS.includes(b.status) ? b.status : "wishlist";
    const job = await Job.create({
      company: String(b.company).trim(),
      role: b.role || "Fullstack",
      stack: normalizeStack(b.stack),
      salary: numOrNull(b.salary),
      link: (b.link || "").trim(),
      referral: b.referral || "None",
      notes: (b.notes || "").trim(),
      status,
      subStages: sanitizeSubStages(b.subStages),
      history: status !== "wishlist" ? [{ from: "wishlist", to: status, ts: new Date() }] : [],
      dateAdded: b.dateAdded ? new Date(b.dateAdded) : new Date()
    });
    res.status(201).json(job);
  }));

  api.get("/jobs/:id", wrap(async (req, res) => {
    if (!isValidObjectId(req.params.id)) return res.status(400).json({ error: "Invalid id." });
    const job = await Job.findById(req.params.id);
    if (!job) return res.status(404).json({ error: "Job not found." });
    res.json(job);
  }));

  api.put("/jobs/:id", wrap(async (req, res) => {
    if (!isValidObjectId(req.params.id)) return res.status(400).json({ error: "Invalid id." });
    const job = await Job.findById(req.params.id);
    if (!job) return res.status(404).json({ error: "Job not found." });
    const b = req.body || {};
    if (b.company !== undefined) {
      if (!String(b.company).trim()) return res.status(400).json({ error: "Company name is required." });
      job.company = String(b.company).trim();
    }
    if (b.role !== undefined) job.role = b.role;
    if (b.stack !== undefined) job.stack = normalizeStack(b.stack);
    if (b.salary !== undefined) job.salary = numOrNull(b.salary);
    if (b.link !== undefined) job.link = (b.link || "").trim();
    if (b.referral !== undefined) job.referral = b.referral;
    if (b.notes !== undefined) job.notes = (b.notes || "").trim();
    if (b.subStages !== undefined) job.subStages = sanitizeSubStages(b.subStages);
    if (b.status !== undefined && COLUMN_IDS.includes(b.status) && b.status !== job.status) {
      job.history.push({ from: job.status, to: b.status, ts: new Date() });
      job.status = b.status;
    }
    await job.save();
    res.json(job);
  }));

  /* dedicated move endpoint — records history automatically */
  api.patch("/jobs/:id/move", wrap(async (req, res) => {
    if (!isValidObjectId(req.params.id)) return res.status(400).json({ error: "Invalid id." });
    const to = (req.body || {}).status;
    if (!COLUMN_IDS.includes(to)) return res.status(400).json({ error: "Invalid status." });
    const job = await Job.findById(req.params.id);
    if (!job) return res.status(404).json({ error: "Job not found." });
    if (job.status !== to) {
      job.history.push({ from: job.status, to, ts: new Date() });
      job.status = to;
      await job.save();
    }
    res.json(job);
  }));

  api.delete("/jobs/:id", wrap(async (req, res) => {
    if (!isValidObjectId(req.params.id)) return res.status(400).json({ error: "Invalid id." });
    const job = await Job.findByIdAndDelete(req.params.id);
    if (!job) return res.status(404).json({ error: "Job not found." });
    // unlink any contacts that pointed at this job
    await Contact.updateMany({ jobId: job._id }, { $set: { jobId: null } });
    res.json({ ok: true, id: req.params.id });
  }));

  /* ==================== CONTACTS (HR) ==================== */
  api.get("/contacts", wrap(async (req, res) => {
    const q = (req.query.q || "").trim();
    let filter = {};
    if (q) {
      const rx = new RegExp(escapeRegex(q), "i");
      filter = { $or: [{ name: rx }, { company: rx }, { title: rx }, { email: rx }, { source: rx }] };
    }
    const contacts = await Contact.find(filter).sort({ dateAdded: -1 });
    res.json(contacts);
  }));

  api.post("/contacts", wrap(async (req, res) => {
    const b = req.body || {};
    if (!b.name || !String(b.name).trim()) return res.status(400).json({ error: "Name is required." });
    if (b.email && String(b.email).trim() && !isValidEmailServer(b.email)) {
      return res.status(400).json({ error: "Invalid email address." });
    }
    const doc = await Contact.create(cleanContactInput(b));
    res.status(201).json(doc);
  }));

  /* bulk import (from the Claude + Apify paste) with server-side dedupe */
  api.post("/contacts/import", wrap(async (req, res) => {
    const items = Array.isArray((req.body || {}).contacts) ? req.body.contacts : [];
    if (!items.length) return res.status(400).json({ error: "No contacts provided." });

    const existing = await Contact.find({}, { email: 1, name: 1, company: 1 });
    const lc = (s) => String(s || "").trim().toLowerCase();
    const seenEmail = new Set(existing.filter(c => c.email).map(c => lc(c.email)));
    const seenNameCo = new Set(existing.map(c => lc(c.name) + "|" + lc(c.company)));

    const toInsert = [];
    let skipped = 0;
    for (const raw of items) {
      const c = cleanContactInput(raw);
      if (!c.name && !c.email) { skipped++; continue; }
      const emailKey = lc(c.email);
      const nameKey = lc(c.name) + "|" + lc(c.company);
      const isDup = (emailKey && seenEmail.has(emailKey)) || (!emailKey && seenNameCo.has(nameKey));
      if (isDup) { skipped++; continue; }
      if (emailKey) seenEmail.add(emailKey);
      seenNameCo.add(nameKey);
      toInsert.push(c);
    }
    const inserted = toInsert.length ? await Contact.insertMany(toInsert) : [];
    res.status(201).json({ added: inserted.length, skipped, contacts: inserted });
  }));

  api.put("/contacts/:id", wrap(async (req, res) => {
    if (!isValidObjectId(req.params.id)) return res.status(400).json({ error: "Invalid id." });
    const b = req.body || {};
    if (b.name !== undefined && !String(b.name).trim()) return res.status(400).json({ error: "Name is required." });
    if (b.email !== undefined && String(b.email).trim() && !isValidEmailServer(b.email)) {
      return res.status(400).json({ error: "Invalid email address." });
    }
    const update = cleanContactInput(b, /*partial*/ true);
    const doc = await Contact.findByIdAndUpdate(req.params.id, { $set: update }, { new: true, runValidators: true });
    if (!doc) return res.status(404).json({ error: "Contact not found." });
    res.json(doc);
  }));

  api.delete("/contacts/:id", wrap(async (req, res) => {
    if (!isValidObjectId(req.params.id)) return res.status(400).json({ error: "Invalid id." });
    const doc = await Contact.findByIdAndDelete(req.params.id);
    if (!doc) return res.status(404).json({ error: "Contact not found." });
    res.json({ ok: true, id: req.params.id });
  }));

  /* ==================== LEETCODE ==================== */
  api.get("/leetcode", wrap(async (req, res) => {
    const items = await Leetcode.find({}).sort({ createdAt: 1 });
    res.json(items);
  }));

  api.post("/leetcode", wrap(async (req, res) => {
    const b = req.body || {};
    if (!b.title || !String(b.title).trim()) return res.status(400).json({ error: "Problem title is required." });
    const item = await Leetcode.create({
      title: String(b.title).trim(),
      difficulty: DIFFICULTIES.includes(b.difficulty) ? b.difficulty : "Easy",
      topic: b.topic || "Arrays",
      url: (b.url || "").trim(),
      date: b.date || new Date().toISOString().slice(0, 10)
    });
    res.status(201).json(item);
  }));

  api.delete("/leetcode/:id", wrap(async (req, res) => {
    if (!isValidObjectId(req.params.id)) return res.status(400).json({ error: "Invalid id." });
    const item = await Leetcode.findByIdAndDelete(req.params.id);
    if (!item) return res.status(404).json({ error: "Entry not found." });
    res.json({ ok: true, id: req.params.id });
  }));

  /* ==================== PROFILE (singleton) ==================== */
  api.get("/profile", wrap(async (req, res) => {
    const profile = await getOrCreateProfile();
    res.json(profile);
  }));

  api.put("/profile", wrap(async (req, res) => {
    const update = sanitizeProfileInput(req.body || {});
    const profile = await Profile.findOneAndUpdate(
      { key: PROFILE_KEY },
      { $set: update },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );
    res.json(profile);
  }));

  /* sendBeacon target for last-moment profile saves on tab close. Beacons are
     POST + can't read the response, so just persist and ack with 204. */
  api.post("/profile/beacon", wrap(async (req, res) => {
    const update = sanitizeProfileInput(req.body || {});
    if (Object.keys(update).length) {
      await Profile.findOneAndUpdate({ key: PROFILE_KEY }, { $set: update }, { upsert: true, setDefaultsOnInsert: true });
    }
    res.status(204).end();
  }));

  /* ==================== BACKUP / RESTORE / RESET ==================== */
  /* Replace the entire dataset from an exported backup ({jobs,contacts,leetcode,...}). */
  api.post("/restore", wrap(async (req, res) => {
    const b = req.body || {};
    const jobs = Array.isArray(b.jobs) ? b.jobs : [];
    const contacts = Array.isArray(b.contacts) ? b.contacts : [];
    const leetcode = Array.isArray(b.leetcode) ? b.leetcode : [];

    await Promise.all([Job.deleteMany({}), Contact.deleteMany({}), Leetcode.deleteMany({})]);

    // recreate jobs, mapping old id -> new id so contact links survive
    const idMap = {};
    for (const j of jobs) {
      const created = await Job.create({
        company: String(j.company || "Untitled").trim() || "Untitled",
        role: j.role || "Fullstack",
        stack: normalizeStack(j.stack),
        salary: numOrNull(j.salary),
        link: (j.link || "").trim(),
        referral: j.referral || "None",
        notes: (j.notes || "").trim(),
        status: COLUMN_IDS.includes(j.status) ? j.status : "wishlist",
        subStages: sanitizeSubStages(j.subStages),
        history: sanitizeHistory(j.history),
        dateAdded: j.dateAdded ? new Date(j.dateAdded) : new Date()
      });
      if (j.id) idMap[j.id] = created._id;
    }
    for (const c of contacts) {
      const doc = cleanContactInput(c);
      doc.jobId = (c.jobId && idMap[c.jobId]) ? idMap[c.jobId] : null;
      if (doc.name || doc.email) await Contact.create(doc);
    }
    for (const p of leetcode) {
      if (!p || !String(p.title || "").trim()) continue;
      await Leetcode.create({
        title: String(p.title).trim(),
        difficulty: DIFFICULTIES.includes(p.difficulty) ? p.difficulty : "Easy",
        topic: p.topic || "Arrays",
        url: (p.url || "").trim(),
        date: p.date || new Date().toISOString().slice(0, 10)
      });
    }
    // restore profile fields if present (whitelisted + type-checked)
    const profUpdate = sanitizeProfileInput(b);
    if (Object.keys(profUpdate).length) {
      await Profile.findOneAndUpdate({ key: PROFILE_KEY }, { $set: profUpdate }, { upsert: true, setDefaultsOnInsert: true });
    }
    res.json({ ok: true, jobs: jobs.length, contacts: contacts.length, leetcode: leetcode.length });
  }));

  /* Wipe everything and reseed the demo dataset. */
  api.post("/reset", wrap(async (req, res) => {
    await seedDemo();
    res.json({ ok: true });
  }));

  app.use("/api", api);

  /* -------------------- static frontend -------------------- */
  const publicDir = opts.publicDir || path.join(__dirname, "..", "public");
  app.use(express.static(publicDir));
  // SPA fallback for any non-API GET
  app.get(/^(?!\/api).*/, (req, res) => {
    res.sendFile(path.join(publicDir, "index.html"));
  });

  /* -------------------- error handler -------------------- */
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err && err.name === "ValidationError") {
      return res.status(400).json({ error: err.message });
    }
    if (err && err.type === "entity.parse.failed") {
      return res.status(400).json({ error: "Malformed JSON body." });
    }
    console.error("Unhandled error:", err);
    res.status(500).json({ error: "Internal server error." });
  });

  return app;
}

/* -------------------- helpers -------------------- */
async function getOrCreateProfile() {
  // atomic upsert — safe under concurrent requests (no check-then-create race)
  return Profile.findOneAndUpdate(
    { key: PROFILE_KEY },
    { $setOnInsert: { key: PROFILE_KEY } },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );
}

function numOrNull(v) {
  if (v === "" || v === null || v === undefined) return null;
  const n = Number(v);
  return isFinite(n) && n >= 0 ? n : null;
}

function normalizeStack(raw) {
  if (Array.isArray(raw)) return raw.map((s) => String(s).trim()).filter(Boolean);
  if (typeof raw === "string") return raw.split(/[,;\n|/]+/).map((s) => s.trim()).filter(Boolean);
  return [];
}

function sanitizeSubStages(s) {
  s = s || {};
  return {
    oa: !!s.oa,
    phoneScreen: !!s.phoneScreen,
    technical: !!s.technical,
    systemDesign: !!s.systemDesign,
    behavioral: !!s.behavioral
  };
}

function cleanContactInput(b, partial) {
  const out = {};
  const set = (k, v) => { if (!partial || b[k] !== undefined) out[k] = v; };
  set("name", String(b.name || "").trim());
  set("title", String(b.title || "").trim());
  set("company", String(b.company || "").trim());
  set("email", String(b.email || "").trim().toLowerCase());
  set("phone", String(b.phone || "").trim());
  set("linkedin", String(b.linkedin || "").trim());
  set("source", String(b.source || "Apify / Claude connector").trim());
  set("notes", String(b.notes || "").trim());
  if (!partial || b.jobId !== undefined) {
    out.jobId = b.jobId && isValidObjectId(b.jobId) ? b.jobId : null;
  }
  return out;
}

function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const CS_KEYS = ["scalability", "caching", "loadBalancers", "sharding", "messaging", "os", "networking", "consistency"];
/* Whitelist + type-check the Mixed-typed profile fields so callers can't inject
   arbitrary nested keys via PUT /profile or POST /restore (mass-assignment). */
function sanitizeProfileInput(b) {
  const out = {};
  if (b.csChecklist && typeof b.csChecklist === "object") {
    const safe = {};
    CS_KEYS.forEach((k) => { if (typeof b.csChecklist[k] === "boolean") safe[k] = b.csChecklist[k]; });
    out.csChecklist = safe;
  }
  if (b.goals && typeof b.goals === "object") {
    const safe = {};
    DIFFICULTIES.forEach((d) => { if (typeof b.goals[d] === "number" && isFinite(b.goals[d])) safe[d] = Math.max(0, b.goals[d]); });
    if (Object.keys(safe).length) out.goals = safe;
  }
  if (b.resumeStack !== undefined) out.resumeStack = String(b.resumeStack);
  if (b.aiCache && typeof b.aiCache === "object") {
    const safe = {};
    if (typeof b.aiCache.jd === "string") safe.jd = b.aiCache.jd;
    if (typeof b.aiCache.resume === "string") safe.resume = b.aiCache.resume;
    out.aiCache = safe;
  }
  if (b.activeView !== undefined) out.activeView = String(b.activeView);
  return out;
}

function isValidEmailServer(e) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(e || "").trim());
}

/* Keep only history entries whose from/to are valid columns (used on restore). */
function sanitizeHistory(history) {
  if (!Array.isArray(history)) return [];
  return history
    .filter((h) => h && COLUMN_IDS.includes(h.to))
    .map((h) => ({
      from: COLUMN_IDS.includes(h.from) ? h.from : "",
      to: h.to,
      ts: h.ts ? new Date(h.ts) : new Date()
    }));
}

module.exports = { buildApp, getOrCreateProfile };
