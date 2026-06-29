/**
 * Seed data – Multi-Zone: Trivandrum + Kannur
 * Real bus stops, routes, and sample buses for both zones.
 */
const mongoose = require('mongoose');
const connectDB = require('./db');
const User = require('./models/User');
const Stop = require('./models/Stop');
const Route = require('./models/Route');
const Bus = require('./models/Bus');

async function seed() {
  await connectDB();
  console.log('🌱 Seeding ScanAndGo database (Multi-Zone)...\n');

  // ─── Clear existing data ──────────────────────────────────────────────────
  await Promise.all([
    User.deleteMany({}),
    Stop.deleteMany({}),
    Route.deleteMany({}),
    Bus.deleteMany({}),
  ]);

  // ─── Users (use create() so pre-save password hash hook fires) ──────────
  const users = await User.create([
    { name: 'Admin User',     phone: '9000000001', email: 'admin@scanandgo.in', password: 'admin123', role: 'admin',     wallet: 0 },
    // Trivandrum conductors
    { name: 'Rajesh Kumar',   phone: '9000000002', email: null, password: 'cond123', role: 'conductor', wallet: 0 },
    { name: 'Suresh Nair',    phone: '9000000003', email: null, password: 'cond123', role: 'conductor', wallet: 0 },
    { name: 'Anil Pillai',    phone: '9000000004', email: null, password: 'cond123', role: 'conductor', wallet: 0 },
    // Kannur conductors
    { name: 'Rajesh Menon',   phone: '9000000010', email: null, password: 'cond123', role: 'conductor', wallet: 0 },
    { name: 'Suresh Mohan',   phone: '9000000011', email: null, password: 'cond123', role: 'conductor', wallet: 0 },
    { name: 'Anil Nair',      phone: '9000000012', email: null, password: 'cond123', role: 'conductor', wallet: 0 },
    // Passengers (can use both zones)
    { name: 'Arun Mohan',     phone: '9000000005', email: 'arun@email.com',  password: 'pass123', role: 'passenger', wallet: 500 },
    { name: 'Priya Menon',    phone: '9000000006', email: 'priya@email.com', password: 'pass123', role: 'passenger', wallet: 300 },
  ]);
  console.log(`  ✅ ${users.length} users`);

  const [admin, tvmCond1, tvmCond2, tvmCond3, knrCond1, knrCond2, knrCond3, pass1, pass2] = users;

  // ═══════════════════════════════════════════════════════════════════════════
  //   KANNUR ZONE (DEMO: Load from kannur-bus-simulation.json)
  // ═══════════════════════════════════════════════════════════════════════════
  const fs = require('fs');
  const path = require('path');
  const demoPath = path.join(__dirname, '../data/kannur-bus-simulation.json');
  let demoBuses = [];
  try {
    demoBuses = JSON.parse(fs.readFileSync(demoPath, 'utf8'));
    console.log(`  ✅ Loaded ${demoBuses.length} demo Kannur buses from kannur-bus-simulation.json`);
  } catch (err) {
    console.error('❌ Failed to load demo Kannur buses:', err);
  }

  // Insert stops if not already present
  const knrStopsData = [
    { name: 'Thavakkara Bus Stand', latitude: 11.8790, longitude: 75.3730, landmark: 'Thavakkara Bus Stand', zone: 'kannur' },
    { name: 'Payyanur Bus Stand', latitude: 12.1000, longitude: 75.2050, landmark: 'Payyanur Bus Stand', zone: 'kannur' },
    { name: 'Taliparamba Town', latitude: 12.0360, longitude: 75.3600, landmark: 'Taliparamba Town', zone: 'kannur' },
    { name: 'Kasaragod Bus Stand', latitude: 12.5000, longitude: 75.0000, landmark: 'Kasaragod Bus Stand', zone: 'kannur' },
    { name: 'Thalassery Bus Stand', latitude: 11.7470, longitude: 75.4900, landmark: 'Thalassery Bus Stand', zone: 'kannur' },
  ];
  const knrStops = await Stop.insertMany(knrStopsData);
  const ks = {};
  knrStops.forEach(stop => { ks[stop.name] = stop._id; });

  // Insert demo routes
  const demoRoutesData = [];
  demoBuses.forEach(bus => {
    if (!demoRoutesData.find(r => r.code === bus.routeId)) {
      demoRoutesData.push({
        name: `${bus.from} – ${bus.to}`,
        code: bus.routeId,
        description: `Demo route from ${bus.from} to ${bus.to}`,
        type: bus.type,
        base_fare: 10,
        per_km_fare: 1.5,
        zone: 'kannur',
        stops: [
          { stop: ks[bus.from] || knrStops[0]._id, stop_order: 1, distance_from_start_km: 0 },
          { stop: ks[bus.to] || knrStops[1]._id, stop_order: 2, distance_from_start_km: bus.distance },
        ],
      });
    }
  });
  const demoRoutes = await Route.insertMany(demoRoutesData);
  const routeMap = {};
  demoRoutes.forEach(r => { routeMap[r.code] = r._id; });
  console.log(` ✅ ${demoRoutes.length} demo Kannur routes inserted`);

  // Insert demo buses
  // Map demo bus types to allowed enum values
  function mapBusType(type) {
    if (type === 'city') return 'ordinary';
    if (type === 'express') return 'superfast';
    if (['ordinary', 'fast', 'superfast', 'ac'].includes(type)) return type;
    return 'ordinary';
  }

  // Use the admin user as the owner for demo buses
  const demoBusesData = demoBuses.map(bus => ({
    registration: bus.dummyBusNumber,
    route: routeMap[bus.routeId],
    owner: admin._id,
    conductors: [],
    type: mapBusType(bus.type),
    capacity: 50,
    gps_enabled: true,
    status: 'running',
    latitude: knrStopsData[0].latitude,
    longitude: knrStopsData[0].longitude,
    zone: 'kannur',
  }));
  const demoBusDocs = await Bus.insertMany(demoBusesData);
  console.log(` ✅ ${demoBusDocs.length} demo Kannur buses inserted`);

  await mongoose.disconnect();
  process.exit(0);
}

seed().catch(err => {
  console.error(err);
  process.exit(1);
});
