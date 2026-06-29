# ScanAndGo — Full Deep Study Report


---

## 1. WHAT THE PROJECT IS

A Kerala bus ticketing platform. Passenger books QR ticket → conductor scans it on bus → wallet settles. Owners manage fleets, conductors manage trips, admin oversees everything. Real-time GPS via Socket.IO. Static HTML/JS frontend served by the same Express server.

The core idea is solid and genuinely useful. The problems below are about execution, not concept.

---

## 2. ARCHITECTURE — SEVERE PROBLEMS

### 2.1 Monolith frontend: one 7,000-line `app.js` file

Every screen — login, passenger, conductor, owner dashboard, admin, QR scanner, maps, wallet, analytics, chat — is in one file.

**Consequences:**
- Page loads `274KB` of JS for every user, regardless of role. A passenger downloads conductor scanner code. A conductor downloads owner analytics code.
- `setupAssignModalListeners()` is defined **twice** (line 893 and line 1614) — the second silently overwrites the first. This is an active bug.
- No code splitting, no lazy loading, no module system.
- Impossible to test, debug, or maintain at scale.

**Fix needed:** Split by role/feature into separate JS files or move to a proper SPA framework (React/Vue/Next.js).

### 2.2 Single-file backend with business logic in `server.js`

Auto-refund job, subscription maintenance, demo seeding, GPS start, route verifier start — all inline in `startServer()`. 200+ lines of startup code.

### 2.3 Frontend and backend are one deployment

`app.use(express.static(...public))` — the static frontend is served by Express. This makes CDN distribution, caching, and independent frontend deployment impossible.

---

## 3. CRITICAL MONEY/SECURITY BUGS

### 3.1 Multi-ticket refund only returns single fare — **Money Loss**

```js
// Ticket stores farePerTicket, not totalFare
ticket.fare = farePerTicket;   // e.g. ₹20

// Refund in server.js auto-refund job:
passenger.wallet += ticket.fare;  // ₹20 — wrong for 3 passengers who paid ₹60
```

A passenger booking 3 tickets at ₹20 each pays ₹60. If the ticket expires or is rejected, they get ₹20 back. **₹40 is lost**. The `totalFare` field is never stored on the ticket model.

### 3.2 Wallet race condition on booking — **Double deduction possible**

```js
payer.wallet -= totalFare;  // reads then writes
await payer.save();
```

Two simultaneous booking requests read the same balance before either saves. Should use `$inc` with a balance check, same as the top-up endpoint already does correctly.

### 3.3 `/api/wallet/add` simulation endpoint is unguarded in production

Any authenticated user can POST to this and credit themselves up to ₹10,000. No `NODE_ENV` check, no admin-only guard. It is documented as "dev/test mode" in a comment but fully accessible in production.

### 3.4 `ensure-conductor` creates accounts with hardcoded `cond123` password

```js
conductor = new User({ password: 'cond123', ... });
```

This is an owner-accessible endpoint. Any owner who knows a conductor's phone number can reset their account to a known password.

### 3.5 Any passenger can recharge any other user's Poyaloo Pass card

```js
router.post('/recharge-pass', authenticate, async (req, res) => {
```

No role restriction. If you know someone's 11-digit card number you can top up their wallet (exploitable in simulation mode since money comes from nowhere).

---

## 4. LOGIC BUGS (INCORRECT BEHAVIOR)

### 4.1 Conductor earnings record wrong `balance_after`

```js
balance_after: conductor.totalEarnings,  // lifetime earnings ≠ wallet balance
```

The `WalletTransaction` schema's `balance_after` tracks wallet balance. `totalEarnings` is a completely separate field. The transaction ledger is corrupt for conductors.

### 4.2 Multi-count ticket conductor earnings are wrong

When conductor approves a 3-person ticket:
```js
conductor.totalEarnings += ticket.fare;  // adds ₹20, not ₹60
```

Conductor is underpaid in the ledger. Should be `ticket.fare * (ticket.count || 1)`.

### 4.3 `travelTimeMinutes` has a `* 4` multiplier bug

```js
const travelTimeMinutes = Math.round(((now - boardedAt) * 4) / (1000 * 60));
```

This shows 4x the actual travel time in the conductor's validated tickets view. A 10-minute journey shows as 40 minutes. Clearly a leftover debugging artifact.

### 4.4 Route direction logic blocks return journeys

```js
if (toEntry.distance_from_start_km <= fromEntry.distance_from_start_km) {
  return res.status(400).json({ error: 'Destination stop must be after boarding stop' });
}
```

Real bus routes go both ways. A passenger travelling from stop 10 back to stop 3 on the same route is rejected. Either separate routes are needed per direction, or the validation must allow both directions.

### 4.5 `onGpsUpdate` restores `delayed` → `verified` on ANY GPS ping

```js
if (t.status === 'delayed') {
  t.status = 'verified';
  t.consecutiveMisses = 0;
}
```

The status becomes `verified` as soon as any GPS packet arrives — even if the bus is still nowhere near the route. Status should only restore on actual stop match.

### 4.6 Owner dashboard uses two different bus ownership fields inconsistently

- `owner_analytics.js`, `owner.js` (metrics/assignments) → `Bus.find({ owner: ownerId })`
- `owner.js` (revenue, tickets, claim-bus) → `Bus.find({ ownerBusId: ownerId })`

These are two separate MongoDB fields. An owner claiming a bus via `/claim-bus` sets `ownerBusId`. But the assignments and metrics endpoints query `owner`. An owner will see empty analytics or wrong assignment lists depending on how their buses were created.

### 4.7 `/api/owner/assign-bus` doesn't verify bus belongs to the calling owner

```js
const bus = await Bus.findOne({ _id: busId });  // no owner check
```

Any owner can reassign any bus to their conductors.

### 4.8 Owner registration activates subscription immediately without payment

```js
userData.subscriptionStatus = 'active';
userData.subscriptionEndAt = computeSubscriptionEnd(startAt, subscriptionPlan);
```

Owner registers → subscription is immediately active. No payment gateway call, no pending state. The payment is expected separately via `/owner-subscription/verify-razorpay` but registration doesn't enforce it. An owner who registers and never pays still gets active subscription for the full plan duration.

### 4.9 Multi-count ticket creates one Ticket document for N passengers

There's no per-person validation possible. A conductor cannot partially validate (2 of 3 people boarding). The QR is a single code representing multiple people. In real transit, this breaks the boarding flow.

### 4.10 Route finder runs `Bus.countDocuments` inside a per-route loop (N+1 query)

```js
for (const route of routes) {
  const activeBusesCount = await Bus.countDocuments({ route: route._id, status: 'running' });
}
```

N DB queries for N routes. Should be one aggregate query before the loop.

---

## 5. SECURITY PROBLEMS

### 5.1 No rate limiting on any endpoint

Auth routes (login, register, password reset) are open to brute force. Any IP can make unlimited attempts.

### 5.2 JWT token accepted via query string

```js
token = req.query.token;
```

Query string tokens appear in server logs, browser history, access logs, and HTTP referrer headers. Acceptable only for short-lived QR-scan links, not as a general auth pattern.

### 5.3 `err.message` sent to clients everywhere

Every `catch` block does `res.status(500).json({ error: err.message })`. MongoDB error messages, schema validation details, and internal paths get sent to the user.

### 5.4 No input sanitization library

No `express-validator` or `joi`. Validation is ad-hoc per field. Several endpoints accept unsanitized regex patterns (stop search uses `$regex: searchTerm` directly — a user can inject regex that causes ReDoS).

### 5.5 `GET /api/admin/ads` is fully public

Returns all active ads including `createdBy` user IDs. Unnecessary data exposure.

---

## 6. DATA MODEL PROBLEMS

### 6.1 `Bus` model has both `owner` and `ownerBusId` pointing to User

```js
owner:      { type: ObjectId, ref: 'User', required: true },
ownerBusId: { type: ObjectId, ref: 'User', default: null },
```

Both fields reference the owner. Half the codebase uses one, half uses the other. One field must be removed and all queries unified.

### 6.2 `Bus` model references `conductor` (singular, not in schema) in some code

The schema only defines `conductors` (array). Leftover from old single-conductor design not fully cleaned up.

### 6.3 `Ticket` model has no `total_fare` field

The booking calculates `totalFare = fare * count` but never stores it. Every refund/settle recalculates it, and if `count` is missing, money is calculated wrong.

### 6.4 `WalletTransaction` mixes passenger and conductor concerns

A conductor's settlement transaction uses `balance_after: conductor.totalEarnings` (not wallet). The transaction ledger is logically inconsistent for conductors.

### 6.5 User model has 60+ fields — god object

All roles share one User document. A passenger has 15 unused owner subscription fields. An owner has unused `poyalooPassCardNumber`. Should be separate profile documents linked to a base user.

### 6.6 No TTL index on `GpsLog` or `ArrivalPrediction`

GPS logs grow indefinitely. With continuous GPS updates every 5 seconds for all running buses, `GpsLog` will be millions of documents in weeks. Add `expireAfterSeconds` TTL index.

---

## 7. PERFORMANCE PROBLEMS

### 7.1 Analytics endpoints load ALL tickets into memory then filter in JS

```js
const allTickets = await Ticket.find({ bus: { $in: busIds } }).lean();
const todayTickets = allTickets.filter(t => new Date(t.createdAt) >= todayStart);
```

This loads potentially hundreds of thousands of ticket documents into Node.js memory. MongoDB aggregation should do all grouping and filtering server-side.

### 7.2 Route-wise analytics runs one Ticket query per route in `Promise.all`

One DB query per route, all in parallel. 10 routes = 10 simultaneous full collection scans. Should be one aggregate with `$group by route`.

### 7.3 Frontend loads all resources unconditionally

`app.js` (274KB), Leaflet (150KB+), Socket.IO, two QR libraries, Razorpay SDK — all loaded on initial page load for every user. A passenger who never scans a QR still loads the QR scanner library.

### 7.4 `GpsSimulator` runs `Route.findById` (with full stop population) on every tick per bus

```js
// Every 5 seconds, for every running bus:
const route = await Route.findById(bus.route).populate('stops.stop').lean();
```

Routes don't change between ticks. Must be cached in memory.

### 7.5 `ArrivalPrediction.deleteMany + insertMany` on every GPS tick per bus

Full delete and re-insert of predictions for every bus on every 5-second tick. Under 20 buses that's 40 DB operations every 5 seconds just for predictions.

---

## 8. CODE QUALITY PROBLEMS

### 8.1 `setupAssignModalListeners` defined twice in `app.js` (lines 893 and 1614)

JavaScript silently uses the second definition. Features wired in the first definition are lost. Active broken functionality bug.

### 8.2 No tests exist despite Jest being configured

`"test": "jest --coverage"` in `package.json`, Jest installed, zero test files. Running `npm test` reports "No tests found."

### 8.3 `console.log` used as the logging system throughout (62+ instances)

No log levels, no structured output, no way to filter in production.

### 8.4 Dual response shapes from analytics endpoints

```js
res.json({
  success: true,
  ...metrics,   // top-level spread
  metrics       // also nested
});
```

Both `/analytics/overview` and `/analytics/revenue-breakdown` duplicate fields at top level AND nested for "backward compatibility." The API has two shapes for the same data, making future changes dangerous.

### 8.5 Five seed files with no clear usage guide

`seed.js`, `seed-kannur.js`, `seed-kannur-full.js`, `seed-kannur-stops.js`, `seed-pathanamthitta.js` — all at root level, no README clarifying which to run.

### 8.6 `.DS_Store` files committed to the repository

macOS metadata files tracked in git. Add `**/.DS_Store` to `.gitignore`.

### 8.7 `ownerSubscriptionThirtyDaysAmount` stored as string `'free'` in config

```js
ownerSubscriptionThirtyDaysAmount: process.env.OWNER_SUB_30_DAYS_AMOUNT || 'free',
```

`getPlanAmount()` does `Number('free')` → `NaN`. Arithmetic using this value silently produces NaN.

### 8.8 Scheduled jobs use `setInterval` — not production-grade

The auto-refund (5 min) and subscription maintenance (1 hour) jobs use `setInterval` directly in `server.js`. These fail silently on crash, run multiple times on horizontal scale, and have no retry logic. Use `node-cron` or a proper job queue (BullMQ).

### 8.9 No global Express error handler

No `app.use((err, req, res, next) => ...)`. Unhandled rejections in routes hang or crash. Every route handles its own catch independently.

---

## 9. FRONTEND-SPECIFIC PROBLEMS

### 9.1 Title says "Poyaloo ScanAndGo" — brand confusion

```html
<title>Poyaloo ScanAndGo – Kerala Bus Tracker</title>
```

The app is called "ScanAndGo" but the HTML title, icon, and multiple references use "Poyaloo." Brand identity is split.

### 9.2 All CDN dependencies loaded without Subresource Integrity (SRI)

```html
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
```

No `integrity` attribute. If any CDN is compromised, malicious code runs in every user's browser.

### 9.3 Console suppression in production hides real errors

```js
if (window.location.hostname !== 'localhost') {
  // suppresses console.error too
}
```

`console.error` is also silenced. Production bugs become invisible in browser devtools.

### 9.4 Burger menu links out to competitor/unrelated apps

The nav burger menu links to Uber, Swiggy, Flipkart, Amazon, IRCTC, Airbnb — sending users away from the product.

### 9.5 Fonts loaded from Google Fonts (GDPR/privacy concern)

```html
<link href="https://fonts.googleapis.com/css2?family=Inter...">
```

Google Fonts requests expose user IP addresses to Google. For a government-adjacent transit app this is a compliance concern. Self-host the fonts.

### 9.6 No service worker / offline support

For a transit app used in moving buses with unreliable connectivity, there is no offline capability, no PWA caching, no "you have 5 minutes left on this ticket" local state.

### 9.7 Two QR scanner libraries loaded simultaneously

Both `html5-qrcode` and `jsQR` are loaded on every page. Only one is needed.

---

## 10. WHAT MEETS COMPANY STANDARDS VS WHAT DOESN'T

| Area | Status |
|---|---|
| Core domain logic (ticketing, wallet hold/settle) | ✅ Conceptually correct |
| Authentication (JWT, bcrypt, RBAC) | ✅ Correct |
| Real-time GPS with Socket.IO | ✅ Correct approach |
| Route verification algorithm (Haversine) | ✅ Correct math |
| Razorpay signature verification | ✅ Correct |
| CORS allowlist (not wildcard) | ✅ Correct |
| Input validation | ❌ Ad-hoc, incomplete |
| Error handling | ❌ Raw errors to client |
| Rate limiting | ❌ None |
| Test coverage | ❌ Zero |
| Frontend architecture | ❌ Not maintainable at scale |
| Data model consistency | ❌ Dual ownership fields, god object User |
| DB performance | ❌ N+1 queries, no TTL indexes |
| Money calculation correctness | ❌ Multi-ticket refund bug |
| Security (production endpoints) | ❌ wallet/add unguarded |
| Logging | ❌ console.log only |
| Scheduled jobs | ❌ setInterval, not production-grade |
| Deployment readiness | ❌ Not production ready |

---

## 11. PRIORITY FIX LIST

### 🔴 Must fix before any real money flows

1. Store `total_fare` on Ticket model; fix all refund/reject paths to use it
2. Wallet deduction must use MongoDB `$inc` with balance check (atomic)
3. Guard `/api/wallet/add` behind `NODE_ENV !== 'production'` or admin-only
4. Fix conductor earnings: `ticket.fare * (ticket.count || 1)`
5. Unify `owner` vs `ownerBusId` — pick one field, migrate all queries

### 🟠 Must fix before production launch

6. Rate limiting on all auth routes (`express-rate-limit`)
7. Global Express error handler — stop sending `err.message` to clients
8. Remove or restrict `ensure-conductor` hardcoded password
9. Add TTL index on `GpsLog` (e.g., 7-day expiry)
10. Fix `setupAssignModalListeners` duplicate in `app.js`
11. Fix `travelTimeMinutes * 4` bug in conductor view
12. Cache route data in GPS simulator (stop querying DB on every tick)
13. Fix `ownerSubscriptionThirtyDaysAmount` NaN issue (`'free'` → `0`)
14. Add SRI `integrity` attributes to all CDN script tags
15. Remove console suppression or replace with proper logging

### 🟡 Must fix for scale and long-term maintenance

16. Split `app.js` into modules by role/feature
17. Move all analytics to MongoDB aggregation (stop loading everything into memory)
18. Split `auth.js` route file (51KB) into `auth.js`, `subscription.js`, `poyalooPass.js`
19. Replace `setInterval` jobs with `node-cron` or BullMQ
20. Add TTL index on `ArrivalPrediction`
21. Write smoke tests for all payment flows
22. Self-host fonts (remove Google Fonts dependency)
23. Remove duplicate QR library (keep only one)
24. Remove burger menu links to external competitor apps
25. Fix brand naming — settle on "ScanAndGo" or "Poyaloo" consistently
