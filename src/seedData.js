"use strict";
/* Shared demo-seed routine, used by `npm run seed` and the POST /api/reset endpoint.
   Assumes a live mongoose connection. Clears the collections, then inserts the demo set. */

const { Job, Contact, Leetcode, Profile } = require("./models");

const DAY = 86400000;
const iso = (daysBack) => new Date(Date.now() - daysBack * DAY);

async function seedDemo() {
  await Promise.all([Job.deleteMany({}), Contact.deleteMany({}), Leetcode.deleteMany({}), Profile.deleteMany({})]);

  const google = await Job.create({
    company: "Google", role: "Backend", stack: ["Go", "Kubernetes", "Spanner", "gRPC"],
    salary: 210000, link: "https://careers.google.com", referral: "Have Referral",
    notes: "Referral from college senior on the Search Infra team. Emphasize distributed systems.",
    status: "interviewing", dateAdded: iso(9),
    subStages: { oa: true, phoneScreen: true, technical: false, systemDesign: false, behavioral: false },
    history: [
      { from: "wishlist", to: "applied", ts: iso(9) },
      { from: "applied", to: "interviewing", ts: iso(4) }
    ]
  });
  const stripe = await Job.create({
    company: "Stripe", role: "Frontend", stack: ["React", "TypeScript", "GraphQL", "Node"],
    salary: 195000, link: "https://stripe.com/jobs", referral: "Applied via Site",
    notes: "Payments dashboard team. Heavy on real-time data + design systems.",
    status: "applied", dateAdded: iso(5),
    history: [{ from: "wishlist", to: "applied", ts: iso(5) }]
  });
  await Job.create({
    company: "Nimbus (Tech Startup)", role: "Fullstack", stack: ["Next.js", "AWS", "Postgres", "Python"],
    salary: 160000, link: "https://nimbus.example.com/careers", referral: "None",
    notes: "Seed-stage, streaming analytics product. Wear many hats — full ownership expected.",
    status: "wishlist", dateAdded: iso(2)
  });

  await Contact.insertMany([
    {
      name: "Priya Nair", title: "Technical Recruiter", company: "Google",
      email: "priya.nair@example.com", phone: "+1 415 555 0142",
      linkedin: "https://linkedin.com/in/example-priya", source: "Apify / Claude connector",
      notes: "Owns backend infra pipeline reqs. Responsive on email.", jobId: google._id, dateAdded: iso(8)
    },
    {
      name: "Marcus Lee", title: "Talent Partner", company: "Stripe",
      email: "marcus.lee@example.com", linkedin: "https://linkedin.com/in/example-marcus",
      source: "Apify / Claude connector", notes: "Handles frontend + design system roles.", jobId: stripe._id, dateAdded: iso(4)
    }
  ]);

  await Leetcode.insertMany([
    { title: "Two Sum", difficulty: "Easy", topic: "Hashing", url: "https://leetcode.com/problems/two-sum" },
    { title: "LRU Cache", difficulty: "Medium", topic: "Linked List", url: "https://leetcode.com/problems/lru-cache" },
    { title: "Course Schedule", difficulty: "Medium", topic: "Graphs", url: "https://leetcode.com/problems/course-schedule" },
    { title: "Longest Substring Without Repeating Characters", difficulty: "Medium", topic: "Sliding Window", url: "" }
  ]);

  await Profile.create({
    key: "default",
    csChecklist: { scalability: true, caching: true, loadBalancers: false, sharding: false, messaging: false, os: true, networking: false, consistency: false },
    goals: { Easy: 50, Medium: 75, Hard: 30 },
    resumeStack: "React, TypeScript, Node.js, Go, AWS, PostgreSQL, Docker, GraphQL, Redis",
    aiCache: { jd: "", resume: "" },
    activeView: "board"
  });

  return { jobs: 3, contacts: 2, leetcode: 4 };
}

module.exports = { seedDemo };
