"use strict";
/* Mongoose schemas for DevHunt. One file so the data model is easy to scan. */

const mongoose = require("mongoose");
const { Schema } = mongoose;

const COLUMN_IDS = ["wishlist", "applied", "interviewing", "offer", "rejected"];
const DIFFICULTIES = ["Easy", "Medium", "Hard"];

/* ---- Job (one application = one document) ---- */
const HistorySchema = new Schema(
  {
    from: { type: String, default: "" },
    to: { type: String, default: "" },
    ts: { type: Date, default: Date.now }
  },
  { _id: false }
);

const SubStagesSchema = new Schema(
  {
    oa: { type: Boolean, default: false },
    phoneScreen: { type: Boolean, default: false },
    technical: { type: Boolean, default: false },
    systemDesign: { type: Boolean, default: false },
    behavioral: { type: Boolean, default: false }
  },
  { _id: false }
);

const JobSchema = new Schema(
  {
    company: { type: String, required: true, trim: true, maxlength: 200 },
    role: { type: String, default: "Fullstack", trim: true },
    stack: { type: [String], default: [] },
    salary: { type: Number, default: null, min: 0 },
    link: { type: String, default: "", trim: true },
    referral: { type: String, default: "None", trim: true },
    notes: { type: String, default: "", maxlength: 5000 },
    status: { type: String, enum: COLUMN_IDS, default: "wishlist", index: true },
    subStages: { type: SubStagesSchema, default: () => ({}) },
    history: { type: [HistorySchema], default: [] },
    dateAdded: { type: Date, default: Date.now }
  },
  { timestamps: true }
);

/* ---- HR / recruiter contact ---- */
const ContactSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 200 },
    title: { type: String, default: "", trim: true },
    company: { type: String, default: "", trim: true, index: true },
    email: { type: String, default: "", trim: true, lowercase: true, index: true },
    phone: { type: String, default: "", trim: true },
    linkedin: { type: String, default: "", trim: true },
    source: { type: String, default: "Apify / Claude connector", trim: true },
    notes: { type: String, default: "", maxlength: 5000 },
    jobId: { type: Schema.Types.ObjectId, ref: "Job", default: null },
    dateAdded: { type: Date, default: Date.now }
  },
  { timestamps: true }
);

/* ---- LeetCode log entry ---- */
const LeetcodeSchema = new Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 300 },
    difficulty: { type: String, enum: DIFFICULTIES, default: "Easy" },
    topic: { type: String, default: "Arrays", trim: true },
    url: { type: String, default: "", trim: true },
    date: { type: String, default: () => new Date().toISOString().slice(0, 10) }
  },
  { timestamps: true }
);

/* ---- Singleton profile: prep checklist, goals, resume, AI scratchpad ---- */
const ProfileSchema = new Schema(
  {
    key: { type: String, default: "default", unique: true, index: true },
    csChecklist: { type: Schema.Types.Mixed, default: {} },
    goals: { type: Schema.Types.Mixed, default: { Easy: 50, Medium: 75, Hard: 30 } },
    resumeStack: { type: String, default: "" },
    aiCache: { type: Schema.Types.Mixed, default: { jd: "", resume: "" } },
    activeView: { type: String, default: "board" }
  },
  { timestamps: true }
);

/* Transform _id -> id and strip __v on every JSON serialization so the
   frontend gets clean objects regardless of which collection they came from. */
function cleanJSON(schema) {
  schema.set("toJSON", {
    virtuals: true,
    versionKey: false,
    transform(doc, ret) {
      ret.id = ret._id ? String(ret._id) : ret.id;
      delete ret._id;
      return ret;
    }
  });
}
[JobSchema, ContactSchema, LeetcodeSchema, ProfileSchema].forEach(cleanJSON);

const Job = mongoose.model("Job", JobSchema);
const Contact = mongoose.model("Contact", ContactSchema);
const Leetcode = mongoose.model("Leetcode", LeetcodeSchema);
const Profile = mongoose.model("Profile", ProfileSchema);

module.exports = { Job, Contact, Leetcode, Profile, COLUMN_IDS, DIFFICULTIES };
