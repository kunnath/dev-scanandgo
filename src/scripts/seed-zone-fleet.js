#!/usr/bin/env node
/**
 * seed-zone-fleet.js
 * Seed fleet data from an Excel file into a specific zone.
 *
 * Usage:
 *   node seed-zone-fleet.js <file.xlsx> --zone <zone>            # import
 *   node seed-zone-fleet.js <file.xlsx> --zone <zone> --dry-run  # validate only
 *   node seed-zone-fleet.js <file.xlsx> --zone <zone> --update   # upsert existing
 *
 * Example:
 *   node seed-zone-fleet.js fleet-export_Trivandrum.xlsx --zone trivandrum
 *   node seed-zone-fleet.js fleet-export_Kannur.xlsx     --zone kannur
 */

const XLSX     = require('xlsx');
const path     = require('path');
const fs       = require('fs');
const mongoose = require('mongoose');

require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });

const Stop  = require('../models/Stop');
const Route = require('../models/Route');
const Bus   = require('../models/Bus');
const User  = require('../models/User');
const { ZONE_KEYS } = require('../zones');

const MONGO_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/scanandgo';

/* ─── CLI args ─── */
const args    = process.argv.slice(2);
const dryRun  = args.includes('--dry-run');
const update  = args.includes('--update');
const file    = args.find(a => !a.startsWith('--'));

const zoneIdx = args.indexOf('--zone');
const zone    = zoneIdx !== -1 ? args[zoneIdx + 1] : null;

/* ─── ANSI colours ─── */
const R = '\x1b[31m', G = '\x1b[32m', Y = '\x1b[33m', C = '\x1b[36m', W = '\x1b[0m';

/* ─── Arg validation ─── */
if (!file) {
  console.error(`${R}Error: No input file specified.${W}`);
  console.error(`Usage: node seed-zone-fleet.js <file.xlsx> --zone <zone> [--dry-run] [--update]`);
  console.error(`Zones: ${ZONE_KEYS.join(', ')}`);
  process.exit(1);
}
if (!zone) {
  console.error(`${R}Error: --zone is required.${W}`);
  console.error(`Available zones: ${ZONE_KEYS.join(', ')}`);
  process.exit(1);
}

const ZONE = zone.toLowerCase();

if (!ZONE_KEYS.includes(ZONE)) {
  console.error(`${R}Error: Unknown zone "${zone}". Must be one of: ${ZONE_KEYS.join(', ')}${W}`);
  process.exit(1);
}

/* ─── Helpers ─── */
function readSheet(wb, name) {
  const ws = wb.Sheets[name];
  if (!ws) return [];
  return XLSX.utils.sheet_to_json(ws, { defval: null });
}

function yn(val) {
  if (val == null) return true;
  const s = String(val).toLowerCase().trim();
  return s === 'yes' || s === 'true' || s === '1';
}

function blank(v) {
  return v === null || v === undefined || String(v).trim() === '';
}

const errors   = [];
const warnings = [];
const stats    = { stops: 0, routes: 0, routeStops: 0, buses: 0 };

function err(sheet, row, msg)  { errors.push(`${R}ERROR${W}  [${sheet} row ${row}] ${msg}`); }
function warn(sheet, row, msg) { warnings.push(`${Y}WARN${W}   [${sheet} row ${row}] ${msg}`); }

/* ─── Main ─── */
async function run() {
  let resolvedPath = path.resolve(file);
  if (!fs.existsSync(resolvedPath)) {
    const fallbackPath = path.join(__dirname, 'data_source', file);
    if (fs.existsSync(fallbackPath)) {
      resolvedPath = fallbackPath;
    }
  }

  console.log(`\n${C}📂  Reading : ${resolvedPath}${W}`);
  console.log(`${C}🗺   Zone    : ${ZONE}${W}\n`);

  const wb = XLSX.readFile(resolvedPath);

  const stopsData      = readSheet(wb, 'Stops');
  const routesData     = readSheet(wb, 'Routes');
  const routeStopsData = readSheet(wb, 'Route_Stops');
  const busesData      = readSheet(wb, 'Buses');

  console.log(`   Sheets: ${stopsData.length} stops, ${routesData.length} routes, ` +
    `${routeStopsData.length} route-stops, ${busesData.length} buses\n`);

  /* ── Phase 1: Validate ── */
  console.log(`${C}── Phase 1: Validation ──${W}\n`);

  const stopNameSet  = new Set();
  const routeCodeSet = new Set();
  const busRegSet    = new Set();

  const validRouteTypes = ['city', 'suburban', 'express', 'superfast'];
  const validBusTypes   = ['ordinary', 'fast', 'superfast', 'ac'];
  const validStatuses   = ['idle', 'running', 'maintenance', 'breakdown'];

  // Stops
  for (let i = 0; i < stopsData.length; i++) {
    const r = stopsData[i], row = i + 2;
    if (blank(r.name))      err('Stops', row, 'name is required');
    if (blank(r.latitude))  err('Stops', row, 'latitude is required');
    if (blank(r.longitude)) err('Stops', row, 'longitude is required');
    if (r.name && stopNameSet.has(r.name.trim()))
      err('Stops', row, `duplicate stop name "${r.name}"`);
    if (r.name) stopNameSet.add(r.name.trim());
  }

  // Routes
  for (let i = 0; i < routesData.length; i++) {
    const r = routesData[i], row = i + 2;
    if (blank(r.code)) err('Routes', row, 'code is required');
    if (blank(r.name)) err('Routes', row, 'name is required');
    if (r.type && !validRouteTypes.includes(r.type))
      err('Routes', row, `invalid type "${r.type}" – allowed: ${validRouteTypes.join(', ')}`);
    if (r.code && routeCodeSet.has(r.code.trim()))
      err('Routes', row, `duplicate route code "${r.code}"`);
    if (r.code) routeCodeSet.add(r.code.trim());
  }

  // Route_Stops
  for (let i = 0; i < routeStopsData.length; i++) {
    const r = routeStopsData[i], row = i + 2;
    if (blank(r.route_code)) err('Route_Stops', row, 'route_code is required');
    if (blank(r.stop_name))  err('Route_Stops', row, 'stop_name is required');
    if (blank(r.stop_order)) err('Route_Stops', row, 'stop_order is required');
    if (r.route_code && !routeCodeSet.has(String(r.route_code).trim()))
      err('Route_Stops', row, `route_code "${r.route_code}" not found in Routes sheet`);
    if (r.stop_name && !stopNameSet.has(String(r.stop_name).trim()))
      err('Route_Stops', row, `stop_name "${r.stop_name}" not found in Stops sheet`);
  }

  // Buses
  for (let i = 0; i < busesData.length; i++) {
    const r = busesData[i], row = i + 2;
    if (blank(r.registration)) err('Buses', row, 'registration is required');
    if (r.type && !validBusTypes.includes(r.type))
      err('Buses', row, `invalid type "${r.type}" – allowed: ${validBusTypes.join(', ')}`);
    if (r.status && !validStatuses.includes(r.status))
      err('Buses', row, `invalid status "${r.status}" – allowed: ${validStatuses.join(', ')}`);
    if (r.route_code && !routeCodeSet.has(String(r.route_code).trim()))
      warn('Buses', row, `route_code "${r.route_code}" not in Routes sheet (will try DB)`);
    if (r.registration && busRegSet.has(String(r.registration).trim()))
      err('Buses', row, `duplicate registration "${r.registration}"`);
    if (r.registration) busRegSet.add(String(r.registration).trim());
  }



  /* Print validation results */
  if (warnings.length) {
    console.log(`${Y}Warnings (${warnings.length}):${W}`);
    warnings.forEach(w => console.log('  ' + w));
    console.log();
  }
  if (errors.length) {
    console.log(`${R}Errors (${errors.length}):${W}`);
    errors.forEach(e => console.log('  ' + e));
    console.log(`\n${R}❌  Fix errors and retry.${W}\n`);
    process.exit(1);
  }
  console.log(`${G}✅  Validation passed.${W}\n`);

  if (dryRun) {
    console.log(`${Y}── DRY RUN – nothing written to DB ──${W}`);
    return;
  }

  /* ── Phase 2: Import ── */
  console.log(`${C}── Phase 2: Import to DB ──${W}\n`);
  await mongoose.connect(MONGO_URI);
  console.log(`${C}Connected to MongoDB${W}\n`);

  /* Resolve a system owner for Bus.owner (required field) */
  const zoneOwner = await User.findOne({ role: 'admin' }).lean();
  if (!zoneOwner) {
    console.error(`${R}Error: No admin user found in DB. Create an admin account first.${W}`);
    await mongoose.disconnect();
    process.exit(1);
  }
  const ownerId = zoneOwner._id;

  /* ── Stops ── */
  const stopMap = {};  // name → ObjectId
  for (const s of stopsData) {
    const name = s.name.trim();
    let doc;
    if (update) {
      doc = await Stop.findOneAndUpdate(
        { name, zone: ZONE },
        { name, name_ml: s.name_ml || null, latitude: +s.latitude,
          longitude: +s.longitude, landmark: s.landmark || null, zone: ZONE },
        { upsert: true, new: true }
      );
    } else {
      const existing = await Stop.findOne({ name, zone: ZONE });
      if (existing) {
        stopMap[name] = existing._id;
        warn('Stops', '-', `"${name}" already in zone "${ZONE}" – skipped (use --update to overwrite)`);
        continue;
      }
      doc = await Stop.create({
        name, name_ml: s.name_ml || null,
        latitude: +s.latitude, longitude: +s.longitude,
        landmark: s.landmark || null, zone: ZONE,
      });
    }
    stopMap[name] = doc._id;
    stats.stops++;
  }
  // Pull all existing zone stops so route-stop linking works for skipped ones
  const allZoneStops = await Stop.find({ zone: ZONE }).lean();
  for (const s of allZoneStops) { if (!stopMap[s.name]) stopMap[s.name] = s._id; }
  console.log(`  Stops      : ${stats.stops} added/updated`);

  /* ── Routes ── */
  const routeMap = {};  // code → ObjectId
  for (const r of routesData) {
    const code = r.code.trim();
    const data = {
      name: r.name, code,
      description: r.description || null,
      type:        r.type        || 'city',
      base_fare:   r.base_fare   != null ? +r.base_fare   : 10,
      per_km_fare: r.per_km_fare != null ? +r.per_km_fare : 1.5,
      active:      r.active      != null ? yn(r.active)   : true,
      zone: ZONE,
      stops: [],
    };
    let doc;
    if (update) {
      doc = await Route.findOneAndUpdate({ code, zone: ZONE }, data, { upsert: true, new: true });
    } else {
      const existing = await Route.findOne({ code, zone: ZONE });
      if (existing) {
        routeMap[code] = existing._id;
        warn('Routes', '-', `"${code}" already in zone "${ZONE}" – skipped`);
        continue;
      }
      doc = await Route.create(data);
    }
    routeMap[code] = doc._id;
    stats.routes++;
  }
  const allZoneRoutes = await Route.find({ zone: ZONE }).lean();
  for (const r of allZoneRoutes) { if (!routeMap[r.code]) routeMap[r.code] = r._id; }
  console.log(`  Routes     : ${stats.routes} added/updated`);

  /* ── Route_Stops ── */
  const rsGrouped = {};
  for (const rs of routeStopsData) {
    const code = String(rs.route_code).trim();
    if (!rsGrouped[code]) rsGrouped[code] = [];
    rsGrouped[code].push(rs);
  }
  for (const [code, entries] of Object.entries(rsGrouped)) {
    const routeId = routeMap[code];
    if (!routeId) {
      warn('Route_Stops', '-', `route "${code}" not found – skipping its stops`);
      continue;
    }
    const stopsArr = entries
      .sort((a, b) => a.stop_order - b.stop_order)
      .map(rs => {
        const stopId = stopMap[String(rs.stop_name).trim()];
        if (!stopId) {
          warn('Route_Stops', '-', `stop "${rs.stop_name}" not found – skipping`);
          return null;
        }
        return {
          stop: stopId,
          stop_order: +rs.stop_order,
          distance_from_start_km: rs.distance_from_start_km != null ? +rs.distance_from_start_km : 0,
        };
      })
      .filter(Boolean);
    await Route.findByIdAndUpdate(routeId, { stops: stopsArr });
    stats.routeStops += stopsArr.length;
  }
  console.log(`  Route-Stops: ${stats.routeStops} links set`);

  /* ── Buses ── */
  const busMap = {};  // registration → ObjectId
  for (const b of busesData) {
    const reg       = String(b.registration).trim();
    const routeCode = b.route_code ? String(b.route_code).trim() : null;

    if (routeCode && !routeMap[routeCode]) {
      const dbRoute = await Route.findOne({ code: routeCode, zone: ZONE });
      if (dbRoute) routeMap[routeCode] = dbRoute._id;
    }

    const data = {
      registration: reg, zone: ZONE, owner: ownerId,
      route:        routeCode ? (routeMap[routeCode] || null) : null,
      type:         b.type       || 'ordinary',
      capacity:     b.capacity   != null ? +b.capacity : 50,
      gps_enabled:  b.gps_enabled != null ? yn(b.gps_enabled) : true,
      status:       b.status     || 'idle',
      latitude:     !blank(b.latitude)  ? +b.latitude  : null,
      longitude:    !blank(b.longitude) ? +b.longitude : null,
      start_time:   !blank(b.start_time) ? String(b.start_time).trim() : null,
      stop_time:    !blank(b.stop_time) ? String(b.stop_time).trim() : null,
    };

    let doc;
    if (update) {
      doc = await Bus.findOneAndUpdate({ registration: reg }, data, { upsert: true, new: true });
    } else {
      const existing = await Bus.findOne({ registration: reg }); // globally unique
      if (existing) {
        busMap[reg] = existing._id;
        warn('Buses', '-', `"${reg}" already exists – skipped`);
        continue;
      }
      doc = await Bus.create(data);
    }
    busMap[reg] = doc._id;
    stats.buses++;
  }
  const allZoneBuses = await Bus.find({ zone: ZONE }).lean();
  for (const b of allZoneBuses) { if (!busMap[b.registration]) busMap[b.registration] = b._id; }
  console.log(`  Buses      : ${stats.buses} added/updated`);



  /* ── Summary ── */
  console.log(`\n${G}✅  Import complete for zone "${ZONE}"${W}`);
  console.log(`   Stops: ${stats.stops}  Routes: ${stats.routes}  Route-Stops: ${stats.routeStops}  Buses: ${stats.buses}\n`);

  await mongoose.disconnect();
}

run().catch(e => {
  console.error(e);
  process.exit(1);
});
