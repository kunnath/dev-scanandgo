/**
 * Seed script: Import Kannur Bus Timings from Excel to Database
 * Creates stops, routes, and dummy buses for demo
 */
const mongoose = require('mongoose');
const XLSX = require('xlsx');
const path = require('path');
const connectDB = require('./db');
const Stop = require('./models/Stop');
const Route = require('./models/Route');
const Bus = require('./models/Bus');

async function seedKannurFromExcel() {
  await connectDB();
  console.log('🌱 Seeding Kannur routes & buses from Excel...\n');

  // Read Excel file
  const excelPath = path.join(__dirname, '../fleet-export-demo.xlsx');
  const workbook = XLSX.readFile(excelPath);
  const sheet = workbook.Sheets['Kannur Bus Timings'];
  
  if (!sheet) {
    console.error('❌ Sheet "Kannur Bus Timings" not found!');
    process.exit(1);
  }

  const data = XLSX.utils.sheet_to_json(sheet);
  console.log(`  ✅ Loaded ${data.length} routes from Excel`);

  // Clear existing Kannur data
  await Promise.all([
    Stop.deleteMany({ zone: 'kannur' }),
    Route.deleteMany({ zone: 'kannur' }),
    Bus.deleteMany({ zone: 'kannur' }),
  ]);
  console.log('  ✅ Cleared existing Kannur data');

  // Get unique stops from routes
  const stopNames = new Set();
  data.forEach(row => {
    const route = row.Route || '';
    // Extract from/to from route name (e.g., "Kannur to Alakode")
    if (route.startsWith('Kannur to')) {
      const to = route.replace('Kannur to ', '').trim();
      stopNames.add('Kannur'); // Starting point
      stopNames.add(to);
    } else if (route.endsWith(' to Kannur')) {
      const from = route.replace(' to Kannur', '').trim();
      stopNames.add(from);
      stopNames.add('Kannur'); // End point
    }
  });

  console.log(`  📍 Found ${stopNames.size} unique stops`);

  // Create stops (using approximate coordinates for demo)
  const stopCoords = {
    'Kannur': { lat: 11.8745, lng: 75.3704 },
    'Alakode': { lat: 12.2100, lng: 75.3200 },
    'Iritty': { lat: 11.9500, lng: 75.6500 },
    'Keezhpally': { lat: 12.0500, lng: 75.7500 },
    'Cherupuzha': { lat: 12.2800, lng: 75.2800 },
    'Chandanakampara': { lat: 12.1500, lng: 75.4000 },
    'Koottupuzha': { lat: 12.0500, lng: 75.7500 },
    'Virajpet': { lat: 12.1000, lng: 75.8000 },
    'Kutta': { lat: 11.9500, lng: 76.1000 },
    'Madikeri': { lat: 12.3400, lng: 75.7800 },
    'Thirunelli': { lat: 11.9000, lng: 76.0500 },
    'Mananthavady': { lat: 11.9500, lng: 76.0000 },
    'Pulpally': { lat: 11.8500, lng: 76.0500 },
    'Thaloor': { lat: 11.7500, lng: 76.0000 },
    'Kozhikode': { lat: 11.2588, lng: 75.7804 },
    'Kuthuparamba': { lat: 11.8200, lng: 75.6000 },
    'Parassinikadavu': { lat: 11.9500, lng: 75.2500 },
    'Payyanur': { lat: 12.1000, lng: 75.2050 },
    'Sreekandapuram': { lat: 12.0500, lng: 75.4000 },
    'Pazhayangadi': { lat: 12.0800, lng: 75.2800 },
    'Cheekad': { lat: 12.2000, lng: 75.3500 },
    'Payyambalam': { lat: 11.8900, lng: 75.3600 },
    'Puthiyangadi': { lat: 11.8800, lng: 75.3800 },
    'Mattanur': { lat: 11.9500, lng: 75.5500 },
    'Matool': { lat: 11.9000, lng: 75.6500 },
    'Thalassery': { lat: 11.7470, lng: 75.4900 },
    'Thaliparamba': { lat: 12.0360, lng: 75.3600 },
    'Vadakara': { lat: 11.6000, lng: 75.5800 },
    'Vengad': { lat: 11.8500, lng: 75.4500 },
    'Irikkur': { lat: 12.0500, lng: 75.3000 },
    'Kanhangad': { lat: 12.3000, lng: 75.1000 },
    'Kasaragod': { lat: 12.5000, lng: 75.0000 },
    'Pattuvam': { lat: 12.1500, lng: 75.2500 },
  };

  const stopsData = Array.from(stopNames).map(name => ({
    name: name,
    name_ml: name, // Would need Malayalam translation
    latitude: stopCoords[name]?.lat || 11.8745 + (Math.random() - 0.5) * 0.1,
    longitude: stopCoords[name]?.lng || 75.3704 + (Math.random() - 0.5) * 0.1,
    landmark: `${name} Bus Stop`,
    zone: 'kannur',
  }));

  const stops = await Stop.insertMany(stopsData);
  const stopMap = {};
  stops.forEach(s => { stopMap[s.name] = s._id; });
  console.log(`  ✅ Created ${stops.length} stops`);

  // Generate dummy bus numbers
  const generateBusNumber = (zone, index) => {
    const zoneCode = zone === 'kannur' ? 'KL-13' : 'KL-01';
    const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const letter1 = letters[Math.floor(index / 676) % 26];
    const letter2 = letters[Math.floor(index / 26) % 26];
    const letter3 = letters[index % 26];
    const num = String(1000 + index).slice(-4);
    return `${zoneCode}-${letter1 || 'A'}${letter2 || 'A'}${letter3 || 'A'}-${num}`;
  };

  // Create routes
  const routesData = data.map((row, index) => {
    const route = row.Route || '';
    let from, to, routeDesc;
    
    if (route.startsWith('Kannur to')) {
      from = 'Kannur';
      to = route.replace('Kannur to ', '').trim();
      routeDesc = row['Route Description'] || `Kannur to ${to}`;
    } else if (route.endsWith(' to Kannur')) {
      from = route.replace(' to Kannur', '').trim();
      to = 'Kannur';
      routeDesc = row['Route Description'] || `${from} to Kannur`;
    }

    const code = `KNR-${to.substring(0, 3).toUpperCase()}${index + 1}`;
    
    return {
      name: route,
      code: code,
      description: routeDesc,
      type: 'city',
      base_fare: 10,
      per_km_fare: 1.5,
      active: true,
      zone: 'kannur',
      stops: [
        { stop: stopMap[from] || stopMap['Kannur'], stop_order: 1, distance_from_start_km: 0 },
        { stop: stopMap[to] || stopMap['Kannur'], stop_order: 2, distance_from_start_km: row.distance || 20 },
      ],
      // Store timings in description for demo
      first_bus: row['First Bus'] || row['First Bus'] || row.first_bus,
      last_bus: row['Last Bus'] || row['Last Bus'] || row.last_bus,
      timings: row.Timings || row.timings,
    };
  });

  const routes = await Route.insertMany(routesData);
  const routeMap = {};
  routes.forEach(r => { routeMap[r.code] = r._id; });
  console.log(`  ✅ Created ${routes.length} routes`);

  // Create dummy buses for each route
  const busesData = routes.map((route, index) => ({
    registration: generateBusNumber('kannur', index),
    route: route._id,
    conductor: null,
    type: 'ordinary',
    capacity: 50,
    gps_enabled: true,
    status: 'running',
    latitude: stopCoords['Kannur']?.lat || 11.8745,
    longitude: stopCoords['Kannur']?.lng || 75.3704,
    zone: 'kannur',
  }));

  const buses = await Bus.insertMany(busesData);
  console.log(`  ✅ Created ${buses.length} dummy buses`);

  console.log('\n🎉 Kannur seeding complete!');
  console.log('\n📋 Sample Routes:');
  routes.slice(0, 5).forEach(r => {
    console.log(`   - ${r.code}: ${r.name} (${r.first_bus} - ${r.last_bus})`);
  });

  console.log('\n🚌 Sample Buses:');
  buses.slice(0, 5).forEach(b => {
    console.log(`   - ${b.registration}`);
  });

  await mongoose.disconnect();
  process.exit(0);
}

seedKannurFromExcel().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});