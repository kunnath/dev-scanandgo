/**
 * Enhanced Seed: Comprehensive Kannur bus routes with ALL intermediate stops
 * Uses OSRM for road-based routing visualization
 */
const mongoose = require('mongoose');
const path = require('path');
const connectDB = require('./db');
const Stop = require('./models/Stop');
const Route = require('./models/Route');
const Bus = require('./models/Bus');

// Comprehensive stop list with intermediate stops for realistic routes
const kannurStopsList = [
  // === KANNUR CITY AREA ===
  { name: 'Kannur Bus Stand', lat: 11.8745, lng: 75.3704, landmark: 'Kannur Main Bus Stand' },
  { name: 'Thavakkara', lat: 11.8790, lng: 75.3730, landmark: 'Thavakkara Private Bus Stand' },
  { name: 'Moolam', lat: 11.8765, lng: 75.3715, landmark: 'Moolam Circle' },
  { name: 'South Bazaar', lat: 11.8718, lng: 75.3697, landmark: 'South Bazaar' },
  { name: 'Town Hall', lat: 11.8700, lng: 75.3650, landmark: 'Kannur Town Hall' },
  { name: 'Fort Junction', lat: 11.8680, lng: 75.3590, landmark: 'Kannur Fort' },
  { name: 'Caltex Junction', lat: 11.8750, lng: 75.3650, landmark: 'Caltex Junction' },
  { name: 'Lions Square', lat: 11.8730, lng: 75.3670, landmark: 'Lions Square' },
  { name: 'Station Road', lat: 11.8720, lng: 75.3750, landmark: 'Kannur Railway Station' },
  { name: 'Chavakkad', lat: 11.8710, lng: 75.3800, landmark: 'Chavakkad' },
  { name: 'Puthiyangadi', lat: 11.8800, lng: 75.3800, landmark: 'Puthiyangadi' },
  { name: 'Kannur Medical College', lat: 11.8850, lng: 75.3850, landmark: 'Medical College' },
  { name: 'Pappinisseri Jn', lat: 11.9400, lng: 75.3100, landmark: 'Pappinisseri Junction' },
  { name: 'Pappinisseri', lat: 11.9500, lng: 75.3000, landmark: 'Pappinisseri' },
  
  // === PAYYANUR ROAD ===
  { name: 'Azhikode', lat: 11.9100, lng: 75.3400, landmark: 'Azhikode' },
  { name: 'Azhikode South', lat: 11.9050, lng: 75.3350, landmark: 'Azhikode South' },
  { name: 'Kanhirode', lat: 11.9600, lng: 75.3200, landmark: 'Kanhirode' },
  { name: 'Kalliasseri', lat: 12.0000, lng: 75.3050, landmark: 'Kalliasseri' },
  { name: 'Kalliasseri Jn', lat: 12.0200, lng: 75.2950, landmark: 'Kalliasseri Junction' },
  { name: 'Pazhayangadi', lat: 12.0800, lng: 75.2800, landmark: 'Pazhayangadi' },
  { name: 'Mavilayi', lat: 12.0500, lng: 75.2700, landmark: 'Mavilayi' },
  { name: 'Kundyappuram', lat: 12.0700, lng: 75.2500, landmark: 'Kundyappuram' },
  { name: 'Payyanur', lat: 12.1000, lng: 75.2050, landmark: 'Payyanur Bus Stand' },
  { name: 'Payyanur South', lat: 12.0950, lng: 75.2100, landmark: 'Payyanur South' },
  { name: 'Eramam', lat: 12.1200, lng: 75.2500, landmark: 'Eramam' },
  { name: 'Kanhangad', lat: 12.3000, lng: 75.1000, landmark: 'Kanhangad' },
  { name: 'Kasaragod', lat: 12.5000, lng: 75.0000, landmark: 'Kasaragod Bus Stand' },
  
  // === THALIPARAMBA ROAD ===
  { name: 'Taliparamba', lat: 12.0360, lng: 75.3600, landmark: 'Taliparamba Town' },
  { name: 'Taliparamba New Bus Stand', lat: 12.0400, lng: 75.3550, landmark: 'New Bus Stand' },
  { name: 'Sreekandapuram', lat: 12.0500, lng: 75.4000, landmark: 'Sreekandapuram' },
  { name: 'Poyil', lat: 12.0600, lng: 75.4100, landmark: 'Poyil' },
  { name: 'Payyavoor', lat: 12.1000, lng: 75.4200, landmark: 'Payyavoor' },
  { name: 'Chandanakampara', lat: 12.1500, lng: 75.4000, landmark: 'Chandanakampara' },
  { name: 'Alakode', lat: 12.2100, lng: 75.3200, landmark: 'Alakode' },
  { name: 'Alakode Jn', lat: 12.2150, lng: 75.3250, landmark: 'Alakode Junction' },
  { name: 'Cherupuzha', lat: 12.2800, lng: 75.2800, landmark: 'Cherupuzha' },
  { name: 'Ulikkal', lat: 12.2500, lng: 75.3500, landmark: 'Ulikkal' },
  { name: 'Irikkur', lat: 12.0500, lng: 75.3000, landmark: 'Irikkur' },
  { name: 'Pattuvam', lat: 12.1500, lng: 75.2500, landmark: 'Pattuvam' },
  { name: 'Parassinikadavu', lat: 11.9500, lng: 75.2500, landmark: 'Parassinikadavu' },
  
  // === THALASSERY ROAD ===
  { name: 'Thalassery', lat: 11.7470, lng: 75.4900, landmark: 'Thalassery Bus Stand' },
  { name: 'Thalassery Court', lat: 11.7500, lng: 75.4850, landmark: 'Court Road' },
  { name: 'Dharmadam', lat: 11.7800, lng: 75.4500, landmark: 'Dharmadam' },
  { name: 'Muzhappilangad', lat: 11.8100, lng: 75.4200, landmark: 'Muzhappilangad Beach' },
  { name: 'Valapattanam', lat: 11.8300, lng: 75.4000, landmark: 'Valapattanam' },
  { name: 'Kolavelloor', lat: 11.8450, lng: 75.3850, landmark: 'Kolavelloor' },
  { name: 'Kottayam', lat: 11.8550, lng: 75.3700, landmark: 'Kottayam' },
  { name: 'Mappalappoyil', lat: 11.8600, lng: 75.3650, landmark: 'Mappalappoyil' },
  { name: 'Mayyazhi', lat: 11.7000, lng: 75.5500, landmark: 'Mayyazhi' },
  { name: 'Mahe', lat: 11.7000, lng: 75.5500, landmark: 'Mahe' },
  { name: 'Puduppanam', lat: 11.6500, lng: 75.6000, landmark: 'Puduppanam' },
  { name: 'Vatakara', lat: 11.6000, lng: 75.5800, landmark: 'Vatakara' },
  { name: 'Kozhikode', lat: 11.2588, lng: 75.7804, landmark: 'Kozhikode Bus Stand' },
  
  // === IRITTY ROAD ===
  { name: 'Mattanur', lat: 11.9500, lng: 75.5500, landmark: 'Mattanur' },
  { name: 'Mattanur Jn', lat: 11.9450, lng: 75.5550, landmark: 'Mattanur Junction' },
  { name: 'Kottiyur', lat: 11.9300, lng: 75.5900, landmark: 'Kottiyur' },
  { name: 'Vattiyur', lat: 11.9200, lng: 75.6200, landmark: 'Vattiyur' },
  { name: 'Iritty', lat: 11.9500, lng: 75.6500, landmark: 'Iritty Town' },
  { name: 'Iritty Jn', lat: 11.9450, lng: 75.6550, landmark: 'Iritty Junction' },
  { name: 'Keezhpally', lat: 12.0500, lng: 75.7500, landmark: 'Keezhpally' },
  { name: 'Koottupuzha', lat: 12.0500, lng: 75.7500, landmark: 'Koottupuzha' },
  { name: 'Makutta', lat: 12.0800, lng: 75.7800, landmark: 'Makutta' },
  { name: 'Virajpet', lat: 12.1000, lng: 75.8000, landmark: 'Virajpet' },
  { name: 'Gonikoppal', lat: 12.1500, lng: 75.8500, landmark: 'Gonikoppal' },
  { name: 'Srimangala', lat: 11.9500, lng: 75.9500, landmark: 'Srimangala' },
  { name: 'Kutta', lat: 11.9500, lng: 76.1000, landmark: 'Kutta' },
  { name: 'Madikeri', lat: 12.3400, lng: 75.7800, landmark: 'Madikeri' },
  
  // === OTHER STOPS ===
  { name: 'Panoor', lat: 11.9000, lng: 75.5500, landmark: 'Panoor' },
  { name: 'Kuthuparamba', lat: 11.8200, lng: 75.6000, landmark: 'Kuthuparamba' },
  { name: 'Vengad', lat: 11.8500, lng: 75.4500, landmark: 'Vengad' },
  { name: 'Matool', lat: 11.9000, lng: 75.6500, landmark: 'Matool' },
  { name: 'Mananthavady', lat: 11.9500, lng: 76.0000, landmark: 'Mananthavady' },
  { name: 'Pulpally', lat: 11.8500, lng: 76.0500, landmark: 'Pulpally' },
  { name: 'Thirunelli', lat: 11.9000, lng: 76.0500, landmark: 'Thirunelli Temple' },
  { name: 'Thaloor', lat: 11.7500, lng: 76.0000, landmark: 'Thaloor' },
  { name: 'Cheekad', lat: 12.2000, lng: 75.3500, landmark: 'Cheekad' },
];

// Route definitions with intermediate stops
const routeDefinitions = [
  {
    name: 'Kannur to Alakode',
    code: 'KNR-ALA',
    stops: ['Kannur Bus Stand', 'Thavakkara', 'Moolam', 'Town Hall', 'Fort Junction', 'Caltex Junction', 
            'Azhikode', 'Azhikode South', 'Pappinisseri Jn', 'Pappinisseri', 'Kanhirode', 'Kalliasseri', 
            'Kalliasseri Jn', 'Pazhayangadi', 'Mavilayi', 'Kundyappuram', 'Alakode Jn', 'Alakode'],
    type: 'city',
    baseFare: 25,
    perKmFare: 1.5,
  },
  {
    name: 'Kannur to Iritty',
    code: 'KNR-IRI',
    stops: ['Kannur Bus Stand', 'Thavakkara', 'Puthiyangadi', 'Kannur Medical College', 
            'Panoor', 'Mattanur', 'Mattanur Jn', 'Kottiyur', 'Vattiyur', 'Iritty Jn', 'Iritty'],
    type: 'express',
    baseFare: 25,
    perKmFare: 2.0,
  },
  {
    name: 'Kannur to Payyanur',
    code: 'KNR-PYR',
    stops: ['Kannur Bus Stand', 'Thavakkara', 'Moolam', 'Town Hall', 'Fort Junction', 'Caltex Junction',
            'Azhikode', 'Azhikode South', 'Pappinisseri Jn', 'Pappinisseri', 'Kanhirode', 'Kalliasseri',
            'Kalliasseri Jn', 'Pazhayangadi', 'Mavilayi', 'Kundyappuram', 'Payyanur'],
    type: 'suburban',
    baseFare: 30,
    perKmFare: 1.5,
  },
  {
    name: 'Kannur to Kozhikode',
    code: 'KNR-COI',
    stops: ['Kannur Bus Stand', 'Thavakkara', 'Fort Junction', 'Town Hall', 'Valapattanam', 
            'Kolavelloor', 'Kottayam', 'Mappalappoyil', 'Thalassery', 'Thalassery Court', 
            'Dharmadam', 'Muzhappilangad', 'Mayyazhi', 'Mahe', 'Puduppanam', 'Vatakara', 'Kozhikode'],
    type: 'express',
    baseFare: 80,
    perKmFare: 2.0,
  },
  {
    name: 'Kannur to Thalassery',
    code: 'KNR-TLY',
    stops: ['Kannur Bus Stand', 'Thavakkara', 'Fort Junction', 'Town Hall', 'Valapattanam', 
            'Kolavelloor', 'Kottayam', 'Mappalappoyil', 'Thalassery'],
    type: 'city',
    baseFare: 15,
    perKmFare: 1.5,
  },
  {
    name: 'Kannur to Taliparamba',
    code: 'KNR-TLP',
    stops: ['Kannur Bus Stand', 'Thavakkara', 'Moolam', 'Town Hall', 'Taliparamba New Bus Stand', 'Taliparamba'],
    type: 'city',
    baseFare: 15,
    perKmFare: 1.5,
  },
  {
    name: 'Kannur to Kasaragod',
    code: 'KNR-KSD',
    stops: ['Kannur Bus Stand', 'Thavakkara', 'Moolam', 'Town Hall', 'Fort Junction', 'Caltex Junction',
            'Azhikode', 'Azhikode South', 'Pappinisseri Jn', 'Pappinisseri', 'Kanhirode', 'Kalliasseri',
            'Kalliasseri Jn', 'Pazhayangadi', 'Mavilayi', 'Kundyappuram', 'Payyanur', 'Payyanur South',
            'Kanhangad', 'Kasaragod'],
    type: 'express',
    baseFare: 100,
    perKmFare: 2.0,
  },
  {
    name: 'Kannur to Mattanur',
    code: 'KNR-MTR',
    stops: ['Kannur Bus Stand', 'Thavakkara', 'Puthiyangadi', 'Kannur Medical College', 'Panoor', 'Mattanur'],
    type: 'city',
    baseFare: 15,
    perKmFare: 1.5,
  },
  {
    name: 'Kannur to Kuthuparamba',
    code: 'KNR-KTH',
    stops: ['Kannur Bus Stand', 'Thavakkara', 'Puthiyangadi', 'Kannur Medical College', 'Panoor', 'Kuthuparamba'],
    type: 'city',
    baseFare: 15,
    perKmFare: 1.5,
  },
  {
    name: 'Kannur to Virajpet',
    code: 'KNR-VRJ',
    stops: ['Kannur Bus Stand', 'Thavakkara', 'Puthiyangadi', 'Kannur Medical College', 
            'Panoor', 'Mattanur', 'Mattanur Jn', 'Kottiyur', 'Vattiyur', 'Iritty', 'Iritty Jn',
            'Keezhpally', 'Koottupuzha', 'Makutta', 'Virajpet'],
    type: 'express',
    baseFare: 50,
    perKmFare: 2.0,
  },
  {
    name: 'Kannur to Sreekandapuram',
    code: 'KNR-SKP',
    stops: ['Kannur Bus Stand', 'Thavakkara', 'Moolam', 'Town Hall', 'Taliparamba New Bus Stand',
            'Taliparamba', 'Sreekandapuram'],
    type: 'suburban',
    baseFare: 20,
    perKmFare: 1.5,
  },
  {
    name: 'Kannur to Cherupuzha',
    code: 'KNR-CHE',
    stops: ['Kannur Bus Stand', 'Thavakkara', 'Moolam', 'Town Hall', 'Taliparamba', 
            'Sreekandapuram', 'Poyil', 'Payyavoor', 'Chandanakampara', 'Ulikkal', 'Alakode', 'Cherupuzha'],
    type: 'suburban',
    baseFare: 30,
    perKmFare: 1.5,
  },
  {
    name: 'Kannur to Parassinikadavu',
    code: 'KNR-PSK',
    stops: ['Kannur Bus Stand', 'Thavakkara', 'Moolam', 'Town Hall', 'Fort Junction', 'Caltex Junction',
            'Azhikode', 'Pappinisseri Jn', 'Parassinikadavu'],
    type: 'city',
    baseFare: 15,
    perKmFare: 1.5,
  },
  // Return routes
  {
    name: 'Alakode to Kannur',
    code: 'KNR-ALA-R',
    stops: ['Alakode', 'Alakode Jn', 'Kundyappuram', 'Mavilayi', 'Pazhayangadi', 'Kalliasseri Jn',
            'Kalliasseri', 'Kanhirode', 'Pappinisseri', 'Pappinisseri Jn', 'Azhikode South', 
            'Azhikode', 'Caltex Junction', 'Town Hall', 'Moolam', 'Thavakkara', 'Kannur Bus Stand'],
    type: 'city',
    baseFare: 25,
    perKmFare: 1.5,
  },
  {
    name: 'Payyanur to Kannur',
    code: 'KNR-PYR-R',
    stops: ['Payyanur', 'Kundyappuram', 'Mavilayi', 'Pazhayangadi', 'Kalliasseri Jn', 'Kalliasseri',
            'Kanhirode', 'Pappinisseri', 'Pappinisseri Jn', 'Azhikode South', 'Azhikode',
            'Caltex Junction', 'Town Hall', 'Moolam', 'Thavakkara', 'Kannur Bus Stand'],
    type: 'suburban',
    baseFare: 30,
    perKmFare: 1.5,
  },
  {
    name: 'Kozhikode to Kannur',
    code: 'KNR-COI-R',
    stops: ['Kozhikode', 'Vatakara', 'Puduppanam', 'Mahe', 'Mayyazhi', 'Muzhappilangad', 'Dharmadam',
            'Thalassery Court', 'Thalassery', 'Mappalappoyil', 'Kottayam', 'Kolavelloor', 
            'Valapattanam', 'Town Hall', 'Fort Junction', 'Thavakkara', 'Kannur Bus Stand'],
    type: 'express',
    baseFare: 80,
    perKmFare: 2.0,
  },
  {
    name: 'Iritty to Kannur',
    code: 'KNR-IRI-R',
    stops: ['Iritty', 'Vattiyur', 'Kottiyur', 'Mattanur Jn', 'Mattanur', 'Panoor', 
            'Kannur Medical College', 'Puthiyangadi', 'Thavakkara', 'Kannur Bus Stand'],
    type: 'express',
    baseFare: 25,
    perKmFare: 2.0,
  },
];

async function seedKannurWithAllStops() {
  await connectDB();
  console.log('🌱 Seeding Kannur routes with ALL intermediate stops...\n');

  // Clear existing Kannur data
  await Promise.all([
    Stop.deleteMany({ zone: 'kannur' }),
    Route.deleteMany({ zone: 'kannur' }),
    Bus.deleteMany({ zone: 'kannur' }),
  ]);
  console.log('  ✅ Cleared existing Kannur data');

  // Create all stops
  const stopsData = kannurStopsList.map(s => ({
    name: s.name,
    name_ml: s.name,
    latitude: s.lat,
    longitude: s.lng,
    landmark: s.landmark,
    zone: 'kannur',
  }));

  const stops = await Stop.insertMany(stopsData);
  const stopMap = {};
  stops.forEach(s => { stopMap[s.name] = s._id; });
  console.log(`  ✅ Created ${stops.length} stops`);

  // Calculate distances
  const getStopCoords = (name) => {
    const s = kannurStopsList.find(s => s.name === name);
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

  // Create routes
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
      zone: 'kannur',
      stops: routeStops,
      total_distance_km: totalDist,
    };
  });

  const routes = await Route.insertMany(routesData);
  console.log(`  ✅ Created ${routes.length} routes with intermediate stops`);

  // Generate dummy bus numbers
  const generateBusNumber = (index) => {
    const zoneCode = 'KL-13';
    const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const letter1 = letters[Math.floor(index / 676) % 26] || 'A';
    const letter2 = letters[Math.floor(index / 26) % 26] || 'A';
    const letter3 = letters[index % 26] || 'A';
    const num = String(1000 + index).slice(-4);
    return `${zoneCode}-${letter1}${letter2}${letter3}-${num}`;
  };

  // Create 2 buses per route
  const busesData = [];
  routes.forEach((route, rIdx) => {
    for (let i = 0; i < 2; i++) {
      const firstStop = route.stops[0];
      const stopObj = stops.find(s => s._id.equals(firstStop.stop));
      busesData.push({
        registration: generateBusNumber(rIdx * 2 + i),
        route: route._id,
        conductor: null,
        type: i === 0 ? 'ordinary' : 'fast',
        capacity: 50,
        gps_enabled: true,
        status: 'running',
        latitude: stopObj?.latitude || 11.8745,
        longitude: stopObj?.longitude || 75.3704,
        zone: 'kannur',
      });
    }
  });

  const buses = await Bus.insertMany(busesData);
  console.log(`  ✅ Created ${buses.length} dummy buses`);

  console.log('\n🎉 Kannur seeding complete!');
  console.log('\n📋 Sample Routes:');
  routes.slice(0, 3).forEach(r => {
    console.log(`   - ${r.code}: ${r.name} (${r.stops.length} stops, ${r.total_distance_km}km)`);
  });

  await mongoose.disconnect();
  process.exit(0);
}

seedKannurWithAllStops().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});