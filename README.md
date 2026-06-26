# DevHunt — SWE Job Hunting Companion & AI Application Tracker

A full-stack job-search command center for software engineers:

- **Kanban application tracker** (Wishlist → Applied → Interviewing → Offer → Rejected) with drag-and-drop, quick-move, interview sub-stages, and automatic history timestamps.
- **Recruiter CRM (HR)** — store HR/recruiter contacts found via your Claude + Apify connector flow (paste **JSON** or free-form text), de-duplicated and saved in MongoDB. One-click tailored outreach email per contact.
- **AI Prep & JD Matcher** — paste a job description + your stack; a deterministic rule-based engine generates a tailored cover-letter outline and an algorithmic / system-design cheat sheet, plus a stack-match score.
- **LeetCode & System Design tracker** — log problems by difficulty/topic with progress bars, and a CS-fundamentals checklist.
- **Analytics dashboard** — conversion rates, pipeline funnel, tech-stack breakdown, and a rolling 30-day velocity chart.

Data is stored in **MongoDB** via an Express + Mongoose REST API. The frontend is a single static page (Tailwind via CDN) that talks to the API and keeps a localStorage **offline cache** so it still renders the last-known data if the server is down.

---

## Architecture

```
job-hunt-companion/
├── server.js              # entry point: load .env, connect Mongo, start HTTP
├── src/
│   ├── app.js             # Express app + all REST routes (testable, no port)
│   ├── db.js              # mongoose connect/disconnect
│   ├── models.js          # Job, Contact, Leetcode, Profile schemas
│   └── seedData.js        # shared demo-seed routine (used by seed + /api/reset)
├── scripts/seed.js        # `npm run seed` — load demo data
├── public/index.html      # the single-page frontend (Tailwind + vanilla JS)
├── test/api.test.js       # integration tests (in-memory MongoDB + supertest)
├── .env.example           # copy to .env and fill in MONGODB_URI
└── package.json
```

---

## Prerequisites

- **Node.js 18+**
- **MongoDB** — either:
  - a local server (`mongod` on `mongodb://127.0.0.1:27017`), or
  - a free **MongoDB Atlas** cluster (cloud).

## Setup

```bash
# 1. install dependencies
npm install

# 2. configure your database connection
cp .env.example .env
#    then edit .env and set MONGODB_URI (see options below)

# 3. (optional) load the demo data — 3 jobs, 2 recruiters, sample LeetCode
npm run seed

# 4. start the server
npm start
```

Then open **http://localhost:4000**.

### MONGODB_URI options

```bash
# Local MongoDB
MONGODB_URI=mongodb://127.0.0.1:27017/devhunt

# MongoDB Atlas (Connect → Drivers → copy the string, fill in your password)
MONGODB_URI=mongodb+srv://USER:PASSWORD@cluster0.xxxxx.mongodb.net/devhunt?retryWrites=true&w=majority
```

> Your connection string (with credentials) lives only in `.env`, which is gitignored. It is never sent to the browser — the frontend only ever talks to `/api/*`. This is why MongoDB needs the server in the middle: a browser cannot (and must not) connect to a database directly.

---

## The HR / Apify workflow

1. Run your Claude + Apify connector to find recruiter/HR details.
2. Go to the **Recruiter CRM (HR)** tab → *Import HR Contacts*.
3. Paste either:
   - a **JSON array**: `[{"name":"Jane Doe","title":"Recruiter","company":"Acme","email":"jane@acme.com","linkedin":"https://...","phone":"+1..."}]`, or
   - **free-form text** with lines like `Name: …`, `E-mail: …`, `Company: …` (handles hyphens, underscores, mixed casing).
4. Click **Parse & Store Contacts** → the server de-duplicates (by email, else name+company) and stores them in MongoDB.
5. Each contact card has a one-click **Email** button that opens a pre-written, tailored outreach draft (merging the recruiter + linked job + your stack) in your mail client, with a copy-to-clipboard fallback for long emails.

---

## REST API

Base URL: `/api`

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/health` | server + DB status |
| GET | `/jobs` (`?status=`) | list applications |
| POST | `/jobs` | create application |
| GET | `/jobs/:id` | fetch one |
| PUT | `/jobs/:id` | update (logs status-change history) |
| PATCH | `/jobs/:id/move` | move column (logs history) |
| DELETE | `/jobs/:id` | delete (unlinks its contacts) |
| GET | `/contacts` (`?q=`) | list / search HR contacts |
| POST | `/contacts` | create contact |
| POST | `/contacts/import` | bulk import with server-side dedupe |
| PUT | `/contacts/:id` | update contact |
| DELETE | `/contacts/:id` | delete contact |
| GET | `/leetcode` | list problems |
| POST | `/leetcode` | log a problem |
| DELETE | `/leetcode/:id` | remove a problem |
| GET | `/profile` | prep checklist, goals, resume, AI scratchpad |
| PUT | `/profile` | update profile (partial) |
| POST | `/restore` | replace all data from an exported backup |
| POST | `/reset` | wipe & reseed demo data |

The sidebar **Export JSON** downloads a full backup; **Import JSON** restores it via `POST /restore`; **Reset Data** calls `POST /reset`.

---

## Testing

```bash
npm test
```

Runs the integration suite against an **in-memory MongoDB** (`mongodb-memory-server`, no external DB needed) — exercises every endpoint, validation rule, dedupe, history logging, and reset/restore. 18 tests.

---

## Scripts

| Command | What it does |
|---------|--------------|
| `npm start` | start the production server |
| `npm run dev` | start with `--watch` (auto-restart on file change) |
| `npm run seed` | wipe and load the demo dataset |
| `npm test` | run the integration test suite |
