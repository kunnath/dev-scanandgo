/*
 * Fresh deployment setup script
 * - Drops the current database
 * - Seeds baseline users, stops, routes, and buses
 *
 * Usage:
 *   node src/scripts/fresh-setup.js --force
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');

const config = require('../config');

const User = require('../models/User');
const Stop = require('../models/Stop');
const Route = require('../models/Route');
const Bus = require('../models/Bus');

function requireForceFlag() {
  const hasForce = process.argv.includes('--force');
  if (!hasForce) {
    console.error('Refusing to continue without --force.');
    console.error('Run: node src/scripts/fresh-setup.js --force');
    process.exit(1);
  }
}

function mapRouteType(type) {
  const t = String(type || '').toLowerCase();
  if (['city', 'suburban', 'express', 'superfast'].includes(t)) return t;
  if (t === 'ordinary') return 'city';
  if (t === 'fast') return 'suburban';
  if (t === 'ac') return 'superfast';
  return 'city';
}

function mapBusType(type) {
  const t = String(type || '').toLowerCase();
  if (['ordinary', 'fast', 'superfast', 'ac'].includes(t)) return t;
  if (t === 'city') return 'ordinary';
  if (t === 'suburban') return 'fast';
  if (t === 'express') return 'superfast';
  return 'ordinary';
}

function buildStopCoordinates(stopName, idx) {
  // Deterministic fallback coordinates around Kannur center.
  const baseLat = 11.8745;
  const baseLng = 75.3704;
  return {
    latitude: baseLat + ((idx % 10) * 0.004),
    longitude: baseLng + ((idx % 10) * 0.004),
    name: stopName,
    name_ml: stopName,
    landmark: `${stopName} Bus Stop`,
    zone: 'kannur',
  };
}

async function seedFreshData() {
  const dataPath = path.join(__dirname, '../../data/kannur-bus-simulation.json');
  const simulation = JSON.parse(fs.readFileSync(dataPath, 'utf8'));

  // Users
  const users = await User.create([
    { name: 'Admin User', phone: '9000000001', email: 'admin@scanandgo.in', password: 'admin123', role: 'admin', wallet: 0 },
    { name: 'Owner User', phone: '9000000009', email: 'owner@scanandgo.in', password: 'owner123', role: 'owner', wallet: 0 },
    { name: 'Conductor 1', phone: '9000000010', email: null, password: 'cond123', role: 'conductor', wallet: 0, conductorUpiId: 'conductor1@oksbi', conductorUpiName: 'Conductor 1' },
    { name: 'Conductor 2', phone: '9000000011', email: null, password: 'cond123', role: 'conductor', wallet: 0, conductorUpiId: 'conductor2@oksbi', conductorUpiName: 'Conductor 2' },
    { name: 'Passenger 1', phone: '9000000005', email: 'pass1@scanandgo.in', password: 'pass123', role: 'passenger', wallet: 500 },
    { name: 'Passenger 2', phone: '9000000006', email: 'pass2@scanandgo.in', password: 'pass123', role: 'passenger', wallet: 300 },
  ]);

  const owner = users.find((u) => u.role === 'owner');
  const conductors = users.filter((u) => u.role === 'conductor');

  // Stops
  const stopNames = Array.from(
    new Set(simulation.flatMap((bus) => [String(bus.from).trim(), String(bus.to).trim()]))
  );

  const stops = await Stop.insertMany(stopNames.map((name, idx) => buildStopCoordinates(name, idx)));
  const stopIdByName = new Map(stops.map((s) => [s.name, s._id]));

  // Routes
  const uniqueByRouteId = new Map();
  for (const bus of simulation) {
    if (!uniqueByRouteId.has(bus.routeId)) uniqueByRouteId.set(bus.routeId, bus);
  }

  const routes = await Route.insertMany(
    Array.from(uniqueByRouteId.values()).map((item) => {
      const from = String(item.from).trim();
      const to = String(item.to).trim();
      return {
        name: `${from} - ${to}`,
        code: String(item.routeId).trim(),
        description: `Seeded route ${from} to ${to}`,
        type: mapRouteType(item.type),
        base_fare: 10,
        per_km_fare: 1.5,
        active: true,
        zone: 'kannur',
        stops: [
          { stop: stopIdByName.get(from), stop_order: 1, distance_from_start_km: 0 },
          { stop: stopIdByName.get(to), stop_order: 2, distance_from_start_km: Number(item.distance) || 10 },
        ],
        total_distance_km: Number(item.distance) || 10,
      };
    })
  );

  const routeByCode = new Map(routes.map((r) => [r.code, r]));

  // Buses
  const buses = await Bus.insertMany(
    simulation.map((item, idx) => {
      const route = routeByCode.get(String(item.routeId).trim());
      const conductor = conductors[idx % conductors.length];
      return {
        owner: owner._id,
        registration: String(item.dummyBusNumber).trim(),
        route: route._id,
        conductors: [conductor._id],
        type: mapBusType(item.type),
        capacity: 50,
        gps_enabled: true,
        latitude: Number(item.currentLocation?.lat) || 11.8745,
        longitude: Number(item.currentLocation?.lng) || 75.3704,
        speed_kmh: Number(item.currentSpeed) || 0,
        heading: 0,
        status: 'running',
        last_gps_update: new Date(),
        zone: 'kannur',
      };
    })
  );

  // Owner portfolio and conductor assignments
  owner.ownedRoutes = routes.map((r) => r._id);
  owner.ownedConductors = conductors.map((c) => c._id);
  await owner.save();

  for (let i = 0; i < conductors.length; i += 1) {
    const conductor = conductors[i];
    const bus = buses[i];
    if (!bus) break;
    conductor.assignedBus = bus._id;
    conductor.assignedRoute = bus.route;
    await conductor.save();
  }

  console.log('Seed summary:');
  console.log(`- Users: ${users.length}`);
  console.log(`- Stops: ${stops.length}`);
  console.log(`- Routes: ${routes.length}`);
  console.log(`- Buses: ${buses.length}`);
}

async function run() {
  requireForceFlag();

  if (!config.mongodbUri) {
    console.error('MONGODB_URI is missing. Set it in .env');
    process.exit(1);
  }

  await mongoose.connect(config.mongodbUri);
  console.log(`Connected to MongoDB: ${mongoose.connection.name}`);

  console.log('Dropping existing database...');
  await mongoose.connection.dropDatabase();
  console.log('Database dropped.');

  console.log('Seeding fresh deployment data...');
  await seedFreshData();

  await mongoose.disconnect();
  console.log('Fresh setup complete.');
}

run().catch(async (err) => {
  console.error('Fresh setup failed:', err);
  try {
    await mongoose.disconnect();
  } catch (e) {
    // ignore disconnect errors
  }
  process.exit(1);
});
