const mongoose = require('mongoose');
const https = require('https');
require('dotenv').config();

const Stop = require('../models/Stop');
const Route = require('../models/Route');

const MONGO_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/scanandgo';

// Simple sleep helper
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Simple distance helper in km
function calcDistance(lat1, lng1, lat2, lng2) {
  const dLat = lat2 - lat1;
  const dLng = lng2 - lng1;
  return Math.sqrt(dLat * dLat + dLng * dLng) * 111.12;
}

// Fetch routing geometry from OSRM API
function getOSRMRoute(start, end) {
  return new Promise((resolve, reject) => {
    // OSRM coordinates are in lng,lat format
    const url = `https://router.project-osrm.org/route/v1/driving/${start.lng},${start.lat};${end.lng},${end.lat}?overview=full&geometries=geojson`;
    
    https.get(url, { headers: { 'User-Agent': 'ScanAndGo Seeder' } }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          resolve(json);
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', reject);
  });
}

// Downsample coordinates array to a fixed count (e.g. max 15 points per segment to keep db clean and fast)
function downsample(coords, maxPoints = 15) {
  if (coords.length <= maxPoints + 2) return coords;
  const step = (coords.length - 2) / (maxPoints - 1);
  const result = [coords[0]];
  for (let i = 1; i < maxPoints - 1; i++) {
    const idx = Math.round(i * step);
    if (idx > 0 && idx < coords.length - 1) {
      result.push(coords[idx]);
    }
  }
  result.push(coords[coords.length - 1]);
  return result;
}

async function enrich() {
  await mongoose.connect(MONGO_URI);
  console.log('Connected to MongoDB for Route Enrichment.\n');

  // 1. Clean up any existing intermediate stops (starts with `.pt-`) in DB
  const deletedStops = await Stop.deleteMany({ name: /^\.pt-/ });
  console.log(`Cleaned up ${deletedStops.deletedCount} old intermediate stops from database.\n`);

  const routes = await Route.find().populate('stops.stop');
  console.log(`Found ${routes.length} routes to enrich.\n`);

  for (const route of routes) {
    console.log(`Processing route: ${route.code} - ${route.name} (${route.zone})`);
    
    // Filter out any intermediate stops from route's current stops list
    const mainStops = route.stops
      .filter(s => s.stop && !s.stop.name.startsWith('.pt-'))
      .sort((a, b) => a.stop_order - b.stop_order);

    if (mainStops.length < 2) {
      console.log(`  ⚠️ Route has less than 2 main stops, skipping.\n`);
      continue;
    }

    console.log(`  Main stops: ${mainStops.map(s => s.stop.name).join(' → ')}`);
    
    const enrichedStopsList = [];
    let currentOrder = 1;
    let accumulatedDistance = 0;

    // Add first stop
    const firstStopEntry = mainStops[0];
    enrichedStopsList.push({
      stop: firstStopEntry.stop._id,
      stop_order: currentOrder++,
      distance_from_start_km: 0
    });

    for (let i = 0; i < mainStops.length - 1; i++) {
      const stopA = mainStops[i].stop;
      const stopB = mainStops[i+1].stop;

      console.log(`  Fetching road path from "${stopA.name}" to "${stopB.name}"...`);
      let routeGeo = null;
      
      try {
        await sleep(250); // Respect OSRM API rate limits (4 requests per second)
        const osrmResult = await getOSRMRoute(
          { lat: stopA.latitude, lng: stopA.longitude },
          { lat: stopB.latitude, lng: stopB.longitude }
        );
        
        if (osrmResult.routes && osrmResult.routes[0]) {
          routeGeo = osrmResult.routes[0].geometry.coordinates;
        }
      } catch (err) {
        console.error(`    ❌ OSRM API error: ${err.message}. Falling back to straight line.`);
      }

      const segmentCoords = routeGeo || [
        [stopA.longitude, stopA.latitude],
        [stopB.longitude, stopB.latitude]
      ];

      // Downsample to keep it token and database efficient
      const pathPoints = downsample(segmentCoords, 15);
      console.log(`    Generated ${pathPoints.length} road points for segment.`);

      // Create intermediate stops and add them (excluding the start and end coordinates which are main stops)
      let segmentStartDistance = accumulatedDistance;
      let lastLat = stopA.latitude;
      let lastLng = stopA.longitude;

      for (let j = 1; j < pathPoints.length - 1; j++) {
        const [lng, lat] = pathPoints[j];
        
        // Calculate distance contribution
        const stepDist = calcDistance(lastLat, lastLng, lat, lng);
        accumulatedDistance += stepDist;
        lastLat = lat;
        lastLng = lng;

        // Create intermediate stop document
        const ptStop = await Stop.create({
          name: `.pt-${route.code}-${i}-${j}`,
          name_ml: `.pt-${route.code}-${i}-${j}`,
          latitude: lat,
          longitude: lng,
          landmark: 'Route path intermediate point',
          zone: route.zone
        });

        enrichedStopsList.push({
          stop: ptStop._id,
          stop_order: currentOrder++,
          distance_from_start_km: Math.round(accumulatedDistance * 100) / 100
        });
      }

      // Add Stop B (the next main stop)
      const stepDistToB = calcDistance(lastLat, lastLng, stopB.latitude, stopB.longitude);
      accumulatedDistance += stepDistToB;
      
      enrichedStopsList.push({
        stop: stopB._id,
        stop_order: currentOrder++,
        distance_from_start_km: Math.round(accumulatedDistance * 100) / 100
      });
    }

    // Update Route in DB
    route.stops = enrichedStopsList;
    route.total_distance_km = Math.round(accumulatedDistance * 10) / 10;
    await route.save();

    console.log(`  ✅ Route "${route.code}" enriched successfully. Total stops: ${route.stops.length}, Distance: ${route.total_distance_km} km\n`);
  }

  await mongoose.disconnect();
  console.log('🎉 Route path enrichment completed successfully!');
}

enrich().catch(err => {
  console.error('Enrichment error:', err);
  process.exit(1);
});
