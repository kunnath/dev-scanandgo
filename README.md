# Poyaloo ScanAndGo

Multi-zone bus tracking, digital ticketing, and QR validation system for Kerala.

- **Version:** 1.3.0 (Production Release — June 2026)
- **Runtime:** Node.js 18+
- **Database:** MongoDB
- **App:** Netlify (static SPA) — `https://poyaloo.com`
- **Team / About:** `https://team.poyaloo.com`
- **News:** `https://news.poyaloo.com`
- **Backend API:** Render — `https://scanandgo-api-s4y4.onrender.com`
- **Status:** Live — production traffic enabled

---

## Founders

| Name | Role |
|------|------|
| **Sreelesh Kunnath** | Founder & CEO |
| **Praan Vijay** | Co-Founder & Chief Operating Officer |

Contact: [team@poyaloo.com](mailto:team@poyaloo.com)

---

## Features

### Core Platform
- Real-time bus GPS tracking on Leaflet maps (Socket.IO live updates)
- QR-code digital ticket booking and conductor scan-to-validate flow
- Multi-zone support (Trivandrum, Kannur — extensible to any district)
- Passenger wallet: top-up via Razorpay, auto-debit on booking, auto-refund on expiry
- HTTPS auto-enabled when TLS certificates are present (`certs/cert.pem` + `certs/key.pem`)

### Passenger Features
- Live bus map with ETA per route
- Ticket booking with multi-ticket count (up to 6) and fare preview
- QR ticket with expiry timer; auto-refunded if not scanned
- Wallet transaction history
- **Membership tier badge** on profile — automatically calculated from monthly travel activity:
  - 🥇 **Gold** — 25+ travel days this month
  - 🥈 **Silver** — 11–24 travel days this month
  - 🥉 **Bronze** — 1–10 travel days this month
- Privacy toggle: hide phone number from conductors
- **Forgot password** via email reset link (SMTP required)
- Community group chat (General, Movies, Dating, Politics rooms)

### Conductor Features
- Camera QR scanner + photo/gallery fallback (works without HTTPS)
- **EM1630 hardware scanner** — HID keyboard-wedge support; scans continuously without camera access
- **Validation queue** — all scans (EM1630 + camera) queue for sequential approve/reject with live counter
- Manual QR paste fallback
- Today's earnings card with total earnings summary
- UPI ID settings — receive ticket payments directly
- Validated tickets list with overtime detection
- Recent settlements history

### Owner Features
- Subscription billing (30-day / Monthly / Yearly) via Razorpay or simulation mode
- Bus assignment dashboard: assign bus + route + conductor in one form
- Live buses & conductors list per zone
- Analytics dashboard: revenue (daily/monthly/hourly), route-wise and bus-wise performance
- Recent tickets table with full details

### Admin Features
- Full fleet oversight dashboard
- Subscription payment tracking (total, last 30 days, today)
- Owner active/expired subscription breakdown
- Advertisement management: create, toggle, delete sponsored ads shown to passengers
- Hyper-local ads displayed on passenger profile page

---

## Project Structure

```
src/
  server.js          – Express + Socket.IO entry point
  config.js          – Environment variable mapping
  db.js              – MongoDB connection bootstrap
  zones.js           – Zone definitions (single source of truth)
  models/            – Mongoose models
  routes/            – REST API modules
  services/          – Socket, GPS simulation, route verification
  middleware/        – JWT auth middleware
public/              – Static frontend SPA
  js/app.js          – Main frontend application
  css/               – Stylesheets
  index.html         – Shell page (app.poyaloo.com / poyaloo.com)
  team/
    index.html       – About Us / Team page (team.poyaloo.com)
    team.css         – Team page styles
    hero.jpg         – Hero illustration
  news/
    index.html       – News & updates page (news.poyaloo.com)
  sree.jpg           – Founder photo (Sreelesh Kunnath)
  pran.jpg           – Co-Founder photo (Praan Vijay)
data/                – Seed JSON files
seed-zone-fleet.js   – Import fleet data per zone from Excel
clear-zone.js        – Wipe and optionally re-seed a zone
generate-template.js – Generate blank fleet-template.xlsx
import-fleet.js      – Legacy import (zone-unaware)
netlify.toml         – Netlify build config + subdomain routing (team/news)
```

---

## Environment Variables

Create a `.env` file at the project root:

```env
NODE_ENV=production
PORT=3000
MONGODB_URI=mongodb+srv://<user>:<pass>@<cluster>/<db>
JWT_SECRET=<strong-random-secret>

APP_NAME=ScanAndGo
APP_CITY=Kerala

GPS_SIMULATION=false
GPS_UPDATE_INTERVAL_MS=5000
QR_TICKET_EXPIRY_MINUTES=120

RAZORPAY_KEY_ID=rzp_live_xxxxx
RAZORPAY_KEY_SECRET=xxxxxxxx

OWNER_SUB_30_DAYS_AMOUNT=299
OWNER_SUB_MONTHLY_AMOUNT=499
OWNER_SUB_YEARLY_AMOUNT=4999
OWNER_SUB_RECEIVER_UPI=<upi-id>
```

---

## Install, Build, Start

```bash
npm install          # install dependencies
npm test             # run test suite
npm run build        # copy public/ → dist/ for Netlify
npm run start        # start production server
npm run dev          # start with nodemon (development)
```

Health check:

```
GET /api/health
→ { status: "ok", app, city, db, timestamp }
```

---

## Zones

Zones are defined in a single file: `src/zones.js`

To **add a new zone**:

1. Add an entry to `src/zones.js` (key, name, center coordinates, zoom)
2. Add the zone key to the `enum` in `src/models/Stop.js`, `Route.js`, and `Bus.js`
3. Seed fleet data for the zone (see Fleet Data Management below)

The frontend zone selector populates **dynamically** from `GET /api/zones` — no HTML edits needed.

---

## Fleet Data Management

### Generate a blank template

```bash
node generate-template.js                        # → fleet-template.xlsx
node generate-template.js my-template.xlsx       # custom output name
```

Sheets: `Instructions`, `Stops`, `Routes`, `Route_Stops`, `Buses`, `Conductors`

### Seed a zone from Excel

```bash
node seed-zone-fleet.js <file.xlsx> --zone <zone>             # import
node seed-zone-fleet.js <file.xlsx> --zone <zone> --dry-run   # validate only
node seed-zone-fleet.js <file.xlsx> --zone <zone> --update    # upsert existing
```

Examples:

```bash
node seed-zone-fleet.js fleet-export_Trivandrum.xlsx --zone trivandrum
node seed-zone-fleet.js fleet-export_Kannur.xlsx     --zone kannur
node seed-zone-fleet.js fleet-export_Kozhikode.xlsx  --zone kozhikode
```

- All records are stamped with the zone automatically.
- Conductors without a password default to their phone number as password.
- Duplicate registrations/phones are skipped (use `--update` to overwrite).

### Clear a zone (wipe + optional re-seed)

```bash
node clear-zone.js --zone <zone> --dry-run                        # preview only
node clear-zone.js --zone <zone>                                   # wipe (typed confirmation required)
node clear-zone.js --zone <zone> --reseed <file.xlsx>             # wipe then re-seed
```

**What gets deleted:** Stops, Routes, Buses, Tickets, GPS Logs, Arrival Predictions
**What is kept:** Passengers, Admins, Owners, Wallet transactions, other zones
**Conductors:** Unlinked only — login accounts are preserved, assignments cleared

### Export current DB to Excel

```bash
node import-fleet.js --export fleet-export_<Zone>.xlsx
```

---

## Deployment

### Backend (Render / Railway / VPS)

- Build command: `npm install`
- Start command: `npm run start`
- Set all `.env` variables in the platform dashboard
- HTTPS: place TLS cert at `certs/cert.pem` and `certs/key.pem` — auto-enabled on startup

Post-deploy verification:

1. `GET /api/health` returns `{ status: "ok" }`
2. Auth login and JWT issuance work
3. Routes, buses, tickets, wallet APIs return data
4. Socket.IO bus position events reach connected clients

### Frontend (Netlify)

`netlify.toml` is pre-configured:
- Build command: `npm run build`
- Publish directory: `dist`
- SPA redirect: `/* → /index.html`

The frontend auto-detects backend URL:
- `localhost` / `192.168.x.x` → same origin (`:3000`)
- Production → `https://scanandgo-mhzn.onrender.com`

---

## Production Readiness Checklist

**Security**
- [ ] `NODE_ENV=production`
- [ ] `JWT_SECRET` is strong and rotated
- [ ] Production `MONGODB_URI` is set
- [ ] Live Razorpay keys configured (if payments enabled)

**Runtime**
- [ ] `npm install` succeeds
- [ ] `npm test` passes
- [ ] `npm run build` generates `dist/`
- [ ] `npm run start` boots without errors

**Functional**
- [ ] Passenger login and ticket booking
- [ ] Conductor QR scan and ticket validation
- [ ] Wallet debit and auto-refund for expired tickets
- [ ] Owner dashboard: route and bus visibility
- [ ] Zone switcher populates and map centers correctly

**Real-time**
- [ ] Socket.IO bus position events delivered to clients
- [ ] Ticket expiry auto-refund job runs on schedule

---

## Operational Notes

- Demo users are auto-created on first startup if absent.
- GPS simulation is controlled by `GPS_SIMULATION=true/false`.
- Backups are in `backup/2026-04-02/` — retained for rollback reference.

---

## Rollback Plan

1. Revert frontend to previous Netlify deployment
2. Revert backend to previous stable release tag
3. Restore MongoDB from latest valid backup if data was affected
4. Re-run smoke tests before resuming traffic

---

## Changelog

### v1.3.0 — June 29, 2026 (Production Release)
- **Financial Correctness**: Implemented atomic wallet balance deductions and credits using MongoDB atomic operations (`User.findOneAndUpdate` with `$inc` and `$gte` balance filters) to prevent parallel booking/refund race conditions.
- **Ticket Fare Unified Field**: Introduced `total_fare` in `Ticket` model to track and refund exact multi-ticket purchase amounts.
- **Security Hardening**:
  - Guarded simulated top-up and Razorpay recharge endpoints against execution in production environment.
  - Added API request rate limiting on authentication routes (login, register, password reset).
  - Replaced hardcoded conductor credentials (`cond123` fallback) with secure random temporary passwords.
- **Error Sanitization**: Appended a global Express error handler and production middleware to prevent internal database queries, schemas, or server paths from leaking in raw 500 error responses.
- **Performance Optimization**:
  - Eliminated N+1 query bottlenecks in route lookup by pre-aggregating active running bus counts.
  - Rewrote owner analytics (overview, daily/monthly/hourly revenue breakdown, route-wise, bus-wise stats) using fast MongoDB database-level aggregation pipelines.
- **Scalability & Maintenance**:
  - Replaced Native `setInterval` background jobs with precise `node-cron` schedules for auto-refunds and subscription maintenance.
  - Added TTL indexes on `GpsLog` (7 days) and `ArrivalPrediction` (1 hour) to automatically prune stale documents.
  - Removed `jsQR` dependency, routing local image QR code decoding directly through the native `Html5Qrcode.scanFile` method.
  - Standardized naming across headers to "ScanAndGo" and replaced competitor external dropdown links with internal app links (News, Team).

### v1.2.0 — May 1, 2026 (Production Release)
- **EM1630 hardware scanner integration** — conductor validation page now supports the EM1630 embedded barcode scanner via HID keyboard-wedge protocol; no drivers or HTTPS required
- **Scan validation queue** — all QR codes from both EM1630 and camera scanning are queued; conductor approves or rejects each in order with real-time queue counter
- **EM1630 status indicator** — live active/idle badge shows scanner connection health; graceful fallback to camera if scanner is absent or disconnected
- UI polish: scan-queue card styles, focus-trap for EM1630 input, hidden input element auto-refocuses after each scan

### v1.1.0 — April 21, 2026 (Production Release)
- **Membership tiers** — Gold / Silver / Bronze badges calculated from monthly travel activity
- **Forgot password** — email-based reset flow via SMTP
- **Community group chat** — General, Movies, Dating, Politics rooms
- **Owner analytics** — daily/monthly/hourly revenue, route-wise and bus-wise breakdown
- **Advertisement management** — admin-controlled hyper-local sponsored ads for passengers
- **Multi-ticket booking** — up to 6 tickets per transaction with fare preview
- **Privacy toggle** — passengers can hide phone number from conductors
- **Conductor overtime detection** — validated tickets flagged when scanned after expected arrival
- **Owner subscription billing** — 30-day / Monthly / Yearly plans via Razorpay
- **Wallet auto-refund** — expired unscanned tickets automatically refunded
- Stability fixes: Socket.IO reconnection handling, GPS log pruning, JWT expiry edge cases
- Netlify SPA redirect hardened (`netlify.toml`)
- MongoDB connection pooling tuned for production load

### v1.0.0 — Initial release
- Core GPS tracking, QR ticket booking, conductor scan-to-validate
- Passenger wallet with Razorpay top-up
- Multi-zone support (Trivandrum, Kannur)
- Admin fleet management dashboard
# dev-scanandgo
