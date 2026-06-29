#!/usr/bin/env node
/**
 * clear-zone.js
 * Safely wipes all fleet data for a specific zone, then optionally re-seeds it.
 *
 * Usage:
 *   node clear-zone.js --zone <zone>                         # wipe only
 *   node clear-zone.js --zone <zone> --reseed <file.xlsx>    # wipe + re-seed
 *   node clear-zone.js --zone <zone> --dry-run               # preview only
 *
 * What gets deleted:
 *   Stops, Routes (+ embedded Route_Stops), Buses, Tickets,
 *   GPS Logs, Arrival Predictions
 *   Conductors are UNLINKED only (accounts kept, assignments cleared)
 *
 * What is NOT touched:
 *   Passengers, Admins, Owners, Wallet transactions, other zones
 */

const mongoose = require('mongoose');
const { execSync } = require('child_process');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });

const Stop              = require('../models/Stop');
const Route             = require('../models/Route');
const Bus               = require('../models/Bus');
const User              = require('../models/User');
const Ticket            = require('../models/Ticket');
const GpsLog            = require('../models/GpsLog');
const ArrivalPrediction = require('../models/ArrivalPrediction');
const { ZONE_KEYS }     = require('../zones');

const MONGO_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/scanandgo';

const args       = process.argv.slice(2);
const dryRun     = args.includes('--dry-run');
const zoneIdx    = args.indexOf('--zone');
const zone       = zoneIdx !== -1 ? args[zoneIdx + 1] : null;
const reseedIdx  = args.indexOf('--reseed');
const reseedFile = reseedIdx !== -1 ? args[reseedIdx + 1] : null;

const R = '\x1b[31m', G = '\x1b[32m', Y = '\x1b[33m', C = '\x1b[36m', B = '\x1b[1m', W = '\x1b[0m';

if (!zone) {
  console.error(`${R}Error: --zone is required.${W}`);
  console.error(`Usage: node clear-zone.js --zone <zone> [--reseed <file.xlsx>] [--dry-run]`);
  console.error(`Available zones: ${ZONE_KEYS.join(', ')}`);
  process.exit(1);
}
const ZONE = zone.toLowerCase();
if (!ZONE_KEYS.includes(ZONE)) {
  console.error(`${R}Error: Unknown zone "${zone}". Must be one of: ${ZONE_KEYS.join(', ')}${W}`);
  process.exit(1);
}

async function run() {
  console.log(`\n${B}${C}🧹  clear-zone.js${W}`);
  console.log(`${C}Zone    : ${B}${ZONE}${W}`);
  console.log(`${C}Dry run : ${dryRun ? Y + 'YES – nothing will be deleted' : G + 'NO – data will be deleted'}${W}`);
  if (reseedFile) console.log(`${C}Re-seed : ${reseedFile}${W}`);
  console.log();

  await mongoose.connect(MONGO_URI);
  console.log(`${C}Connected to MongoDB${W}\n`);

  /* ── Collect zone IDs ── */
  const zoneBuses  = await Bus.find({ zone: ZONE }, '_id').lean();
  const zoneRoutes = await Route.find({ zone: ZONE }, '_id').lean();
  const zoneStops  = await Stop.find({ zone: ZONE }, '_id').lean();
  const busIds     = zoneBuses.map(b => b._id);
  const routeIds   = zoneRoutes.map(r => r._id);

  /* ── Count dependent records ── */
  const ticketCount    = await Ticket.countDocuments({ bus: { $in: busIds } });
  const gpsCount       = await GpsLog.countDocuments({ bus: { $in: busIds } });
  const predCount      = await ArrivalPrediction.countDocuments({ bus: { $in: busIds } });
  const conductorCount = await User.countDocuments({
    role: 'conductor',
    $or: [{ assignedRoute: { $in: routeIds } }, { assignedBus: { $in: busIds } }],
  });

  /* ── Print summary ── */
  console.log(`${B}Records that will be affected for zone "${ZONE}":${W}`);
  console.log(`  Stops              : ${zoneStops.length}`);
  console.log(`  Routes             : ${zoneRoutes.length}  (includes embedded Route_Stops)`);
  console.log(`  Buses              : ${zoneBuses.length}`);
  console.log(`  Tickets            : ${ticketCount}${ticketCount > 0 ? '  ' + R + '⚠  includes active/used tickets' + W : ''}`);
  console.log(`  GPS Logs           : ${gpsCount}`);
  console.log(`  Arrival Predictions: ${predCount}`);
  console.log(`  Conductors         : ${conductorCount}  (unlinked only – accounts kept)\n`);

  if (dryRun) {
    console.log(`${Y}── DRY RUN – nothing deleted. Remove --dry-run to proceed. ──${W}\n`);
    await mongoose.disconnect();
    return;
  }

  const total = zoneStops.length + zoneRoutes.length + zoneBuses.length +
                ticketCount + gpsCount + predCount + conductorCount;
  if (total === 0) {
    console.log(`${Y}No data found for zone "${ZONE}" – nothing to delete.${W}\n`);
    await mongoose.disconnect();
    return;
  }

  /* ── Typed confirmation ── */
  const readline = require('readline');
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise(resolve =>
    rl.question(`${R}${B}Type the zone name "${ZONE}" to confirm deletion: ${W}`, resolve)
  );
  rl.close();
  console.log();

  if (answer.trim().toLowerCase() !== ZONE) {
    console.log(`${Y}Aborted – confirmation did not match.${W}\n`);
    await mongoose.disconnect();
    process.exit(0);
  }

  /* ── Delete in safe dependency order ── */

  // Dependencies first (reference Buses/Stops, not the other way around)
  const gpsDel     = await GpsLog.deleteMany({ bus: { $in: busIds } });
  console.log(`  ${G}✓${W} GPS Logs deleted           : ${gpsDel.deletedCount}`);

  const predDel    = await ArrivalPrediction.deleteMany({ bus: { $in: busIds } });
  console.log(`  ${G}✓${W} Arrival Predictions deleted: ${predDel.deletedCount}`);

  const ticketDel  = await Ticket.deleteMany({ bus: { $in: busIds } });
  console.log(`  ${G}✓${W} Tickets deleted            : ${ticketDel.deletedCount}`);

  // Unlink conductors (keep account, clear assignments)
  const condUpdate = await User.updateMany(
    { role: 'conductor', $or: [{ assignedRoute: { $in: routeIds } }, { assignedBus: { $in: busIds } }] },
    { $set: { assignedRoute: null, assignedBus: null } }
  );
  console.log(`  ${G}✓${W} Conductors unlinked        : ${condUpdate.modifiedCount}`);

  // Core fleet data
  const busDel     = await Bus.deleteMany({ zone: ZONE });
  console.log(`  ${G}✓${W} Buses deleted              : ${busDel.deletedCount}`);

  const routeDel   = await Route.deleteMany({ zone: ZONE });
  console.log(`  ${G}✓${W} Routes deleted             : ${routeDel.deletedCount}`);

  const stopDel    = await Stop.deleteMany({ zone: ZONE });
  console.log(`  ${G}✓${W} Stops deleted              : ${stopDel.deletedCount}`);

  console.log(`\n${G}${B}✅  Zone "${ZONE}" cleared successfully.${W}\n`);
  await mongoose.disconnect();

  /* ── Optional re-seed ── */
  if (reseedFile) {
    const reseedPath = path.resolve(reseedFile);
    console.log(`${C}🌱  Re-seeding from: ${reseedPath}${W}\n`);
    execSync(
      `node "${path.join(__dirname, 'seed-zone-fleet.js')}" "${reseedPath}" --zone ${ZONE}`,
      { stdio: 'inherit' }
    );
  }
}

run().catch(e => { console.error(e); process.exit(1); });
