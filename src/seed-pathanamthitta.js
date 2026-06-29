const mongoose = require('mongoose');
const path = require('path');
const connectDB = require('./db');
const Stop = require('./models/Stop');
const Route = require('./models/Route');
const Bus = require('./models/Bus');
const User = require('./models/User');

const ptaStopsList = [
  { name: 'Pathanamthitta', lat: 9.2648, lng: 76.7870, landmark: 'Private Bus Stand' },
  { name: 'Adoor', lat: 9.1600, lng: 76.7400, landmark: 'Adoor' },
  { name: 'Kottarakkara', lat: 9.0000, lng: 76.7700, landmark: 'Kottarakkara' },
  { name: 'Kilimanoor', lat: 8.7800, lng: 76.8800, landmark: 'Kilimanoor' },
  { name: 'Venjarammoodu', lat: 8.6800, lng: 76.9000, landmark: 'Venjarammoodu' },
  { name: 'Trivandrum', lat: 8.5241, lng: 76.9366, landmark: 'Thampanoor' },

  { name: 'Kozhencherry', lat: 9.3300, lng: 76.6900, landmark: 'Kozhencherry' },
  { name: 'Chengannur', lat: 9.3200, lng: 76.6100, landmark: 'Chengannur' },
  { name: 'Thiruvalla', lat: 9.3800, lng: 76.5800, landmark: 'Thiruvalla' },
  { name: 'Changanassery', lat: 9.4400, lng: 76.5400, landmark: 'Changanassery' },
  { name: 'Kottayam', lat: 9.5900, lng: 76.5200, landmark: 'Kottayam' },
  { name: 'Ettumanoor', lat: 9.6700, lng: 76.5600, landmark: 'Ettumanoor' },
  { name: 'Muvattupuzha', lat: 9.9800, lng: 76.5800, landmark: 'Muvattupuzha' },
  { name: 'Vyttila', lat: 9.9700, lng: 76.3200, landmark: 'Vyttila Hub' },
  { name: 'Ernakulam', lat: 9.9800, lng: 76.2800, landmark: 'Ernakulam South' },
  { name: 'Kochi', lat: 9.9300, lng: 76.2600, landmark: 'Fort Kochi' },
];

const routeDefinitions = [
  {
    name: 'Pathanamthitta to Trivandrum',
    code: 'PTA-TVM',
    stops: ['Pathanamthitta', 'Adoor', 'Kottarakkara', 'Kilimanoor', 'Venjarammoodu', 'Trivandrum'],
    type: 'express',
    baseFare: 100,
    perKmFare: 1.5,
  },
  {
    name: 'Pathanamthitta to Kottayam',
    code: 'PTA-KTM',
    stops: ['Pathanamthitta', 'Kozhencherry', 'Chengannur', 'Thiruvalla', 'Changanassery', 'Kottayam'],
    type: 'suburban',
    baseFare: 60,
    perKmFare: 1.5,
  },
  {
    name: 'Pathanamthitta to Ernakulam',
    code: 'PTA-EKM',
    stops: ['Pathanamthitta', 'Kozhencherry', 'Chengannur', 'Thiruvalla', 'Changanassery', 'Kottayam', 'Ettumanoor', 'Muvattupuzha', 'Vyttila', 'Ernakulam'],
    type: 'express',
    baseFare: 120,
    perKmFare: 1.5,
  },
  {
    name: 'Pathanamthitta to Thiruvalla',
    code: 'PTA-TVLA',
    stops: ['Pathanamthitta', 'Kozhencherry', 'Chengannur', 'Thiruvalla'],
    type: 'city',
    baseFare: 30,
    perKmFare: 1.5,
  },
  // Returns
  {
    name: 'Trivandrum to Pathanamthitta',
    code: 'TVM-PTA',
    stops: ['Trivandrum', 'Venjarammoodu', 'Kilimanoor', 'Kottarakkara', 'Adoor', 'Pathanamthitta'],
    type: 'express',
    baseFare: 100,
    perKmFare: 1.5,
  },
  {
    name: 'Kottayam to Pathanamthitta',
    code: 'KTM-PTA',
    stops: ['Kottayam', 'Changanassery', 'Thiruvalla', 'Chengannur', 'Kozhencherry', 'Pathanamthitta'],
    type: 'suburban',
    baseFare: 60,
    perKmFare: 1.5,
  },
  {
    name: 'Ernakulam to Pathanamthitta',
    code: 'EKM-PTA',
    stops: ['Ernakulam', 'Vyttila', 'Muvattupuzha', 'Ettumanoor', 'Kottayam', 'Changanassery', 'Thiruvalla', 'Chengannur', 'Kozhencherry', 'Pathanamthitta'],
    type: 'express',
    baseFare: 120,
    perKmFare: 1.5,
  },
  {
    name: 'Thiruvalla to Pathanamthitta',
    code: 'TVLA-PTA',
    stops: ['Thiruvalla', 'Chengannur', 'Kozhencherry', 'Pathanamthitta'],
    type: 'city',
    baseFare: 30,
    perKmFare: 1.5,
  },
];

async function seedPathanamthitta() {
  await connectDB();
  console.log('🌱 Seeding Pathanamthitta routes...');

  // Clear existing Pathanamthitta data
  await Promise.all([
    Stop.deleteMany({ zone: 'pathanamthitta' }),
    Route.deleteMany({ zone: 'pathanamthitta' }),
    Bus.deleteMany({ zone: 'pathanamthitta' }),
  ]);
  console.log('  ✅ Cleared existing Pathanamthitta data');

  // Create stops
  const stopsData = ptaStopsList.map(s => ({
    name: s.name,
    name_ml: s.name,
    latitude: s.lat,
    longitude: s.lng,
    landmark: s.landmark,
    zone: 'pathanamthitta',
  }));

  const stops = await Stop.insertMany(stopsData);
  const stopMap = {};
  stops.forEach(s => { stopMap[s.name] = s._id; });
  console.log(`  ✅ Created ${stops.length} stops`);

  const getStopCoords = (name) => {
    const s = ptaStopsList.find(s => s.name === name);
    return s ? { lat: s.lat, lng: s.lng } : null;
  };

  const calcDistance = (stop1, stop2) => {
    const c1 = getStopCoords(stop1);
    const c2 = getStopCoords(stop2);
    if (!c1 || !c2) return 10;
    const dLat = c2.lat - c1.lat;
    const dLng = c2.lng - c1.lng;
    return Math.sqrt(dLat * dLat + dLng * dLng) * 111;
  };

  const routesData = routeDefinitions.map((routeDef) => {
    let cumDist = 0;
    const routeStops = routeDef.stops.map((stopName, order) => {
      const prevStop = order > 0 ? routeDef.stops[order - 1] : stopName;
      const dist = order > 0 ? calcDistance(prevStop, stopName) : 0;
      cumDist += dist;
      return {
        stop: stopMap[stopName],
        stop_order: order + 1,
        distance_from_start_km: Math.round(cumDist * 10) / 10,
      };
    });

    const totalDist = Math.round(cumDist);

    return {
      name: routeDef.name,
      code: routeDef.code,
      description: `${routeDef.stops.length} stops via ${routeDef.stops.slice(1, -1).join(' → ') || 'Direct'}`,
      type: routeDef.type,
      base_fare: routeDef.baseFare,
      per_km_fare: routeDef.perKmFare,
      active: true,
      zone: 'pathanamthitta',
      stops: routeStops,
      total_distance_km: totalDist,
    };
  });

  const routes = await Route.insertMany(routesData);
  console.log(`  ✅ Created ${routes.length} routes`);

  let dummyOwner = await User.findOne({ role: 'owner' });
  if (!dummyOwner) {
    dummyOwner = await User.create({
      name: 'Dummy Owner PTA',
      phone: '0000000000',
      password: 'password123',
      role: 'owner',
      status: 'approved'
    });
  }

  // Generate buses
  const generateBusNumber = (index) => {
    const zoneCode = 'KL-03';
    const num = String(1000 + index).slice(-4);
    return `${zoneCode}-A-${num}`;
  };

  const busesData = [];
  routes.forEach((route, rIdx) => {
    for (let i = 0; i < 2; i++) {
      const firstStop = route.stops[0];
      const stopObj = stops.find(s => s._id.equals(firstStop.stop));
      busesData.push({
        registration: generateBusNumber(rIdx * 2 + i),
        route: route._id,
        owner: dummyOwner._id,
        conductor: null,
        type: i === 0 ? 'ordinary' : 'fast',
        capacity: 50,
        gps_enabled: true,
        status: 'running',
        latitude: stopObj?.latitude || 9.2648,
        longitude: stopObj?.longitude || 76.7870,
        zone: 'pathanamthitta',
      });
    }
  });

  const buses = await Bus.insertMany(busesData);
  console.log(`  ✅ Created ${buses.length} dummy buses`);

  console.log('\n🎉 Pathanamthitta seeding complete!');
  await mongoose.disconnect();
  process.exit(0);
}

seedPathanamthitta().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
