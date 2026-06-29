const express = require('express');
const mongoose = require('mongoose');
const Route = require('../models/Route');
const Stop = require('../models/Stop');
const Bus = require('../models/Bus');

const router = express.Router();

// Helper: Calculate distance between two points using Haversine formula
function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371; // km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}

// ─── List all routes ────────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const filter = { active: true };
    if (req.query.zone) filter.zone = req.query.zone;

    const { search } = req.query;
    if (search) {
      // Find stops matching search term in the current zone (if specified)
      const stopFilter = {
        $or: [
          { name: { $regex: search, $options: 'i' } },
          { name_ml: { $regex: search, $options: 'i' } }
        ]
      };
      if (req.query.zone) stopFilter.zone = req.query.zone;
      const matchingStops = await Stop.find(stopFilter).select('_id');
      const stopIds = matchingStops.map(s => s._id);

      // Match route name, code, or any of its stops
      filter.$or = [
        { name: { $regex: search, $options: 'i' } },
        { code: { $regex: search, $options: 'i' } },
        { 'stops.stop': { $in: stopIds } }
      ];
    }

    const routes = await Route.find(filter).populate('stops.stop').sort('code').lean();

    const formattedRoutes = routes.map(route => {
      const stops = (route.stops || [])
        .sort((a, b) => a.stop_order - b.stop_order)
        .map(rs => {
          if (!rs.stop) return null;
          return {
            id: rs.stop._id,
            name: rs.stop.name,
            name_ml: rs.stop.name_ml,
            latitude: rs.stop.latitude,
            longitude: rs.stop.longitude,
            landmark: rs.stop.landmark,
            stop_order: rs.stop_order,
            distance_from_start_km: rs.distance_from_start_km,
          };
        }).filter(Boolean);

      return {
        ...route,
        id: route._id,
        stops
      };
    });

    res.json(formattedRoutes);
  } catch (err) {
    console.error('Error listing routes:', err);
    res.status(500).json({ error: 'Server error listing routes' });
  }
});

// ─── Search routes between two stops ────────────────────────────────────────
router.get('/search/between', async (req, res) => {
  const { from, to } = req.query;
  if (!from || !to) return res.status(400).json({ error: 'from and to stop names required' });

  const stopFilter = {};
  if (req.query.zone) stopFilter.zone = req.query.zone;
  const fromStops = await Stop.find({ ...stopFilter, name: { $regex: from, $options: 'i' } }).select('_id');
  const toStops = await Stop.find({ ...stopFilter, name: { $regex: to, $options: 'i' } }).select('_id');

  const fromIds = fromStops.map(s => s._id);
  const toIds = toStops.map(s => s._id);

  const routes = await Route.find({
    active: true,
    'stops.stop': { $all: [...fromIds, ...toIds] },
  }).lean();

  // Filter: from must come before to in stop_order
  const filtered = routes.filter(r => {
    const fromEntry = r.stops.find(s => fromIds.some(fid => fid.equals(s.stop)));
    const toEntry = r.stops.find(s => toIds.some(tid => tid.equals(s.stop)));
    return fromEntry && toEntry && fromEntry.stop_order < toEntry.stop_order;
  });

  res.json(filtered.map(r => ({ ...r, id: r._id })));
});

// ─── List all stops ─────────────────────────────────────────────────────────
router.get('/stops/all', async (req, res) => {
  const filter = {};
  if (req.query.zone) filter.zone = req.query.zone;
  const stops = await Stop.find(filter).sort('name').lean();
  res.json(stops.map(s => ({ ...s, id: s._id })));
});

// ─── Stop name autocomplete ──────────────────────────────────────────────────
router.get('/stops/search', async (req, res) => {
  try {
    const { q, zone } = req.query;
    if (!q) return res.json([]);

    const filter = {
      $or: [
        { name: { $regex: q, $options: 'i' } },
        { name_ml: { $regex: q, $options: 'i' } }
      ]
    };
    if (zone) filter.zone = zone;

    const stops = await Stop.find(filter).limit(8).lean();
    res.json(stops.map(s => ({
      id: s._id,
      name: s.name,
      name_ml: s.name_ml,
      latitude: s.latitude,
      longitude: s.longitude,
      landmark: s.landmark,
      zone: s.zone
    })));
  } catch (err) {
    console.error('Error searching stops:', err);
    res.status(500).json({ error: 'Server error searching stops' });
  }
});

// ─── Route finder ────────────────────────────────────────────────────────────
router.get('/find', async (req, res) => {
  try {
    const { destination_stop_id, origin_stop_id, lat, lng, zone } = req.query;
    if (!destination_stop_id) {
      return res.status(400).json({ error: 'destination_stop_id is required' });
    }

    let destObjectId;
    try {
      destObjectId = new mongoose.Types.ObjectId(destination_stop_id);
    } catch (err) {
      return res.status(400).json({ error: 'Invalid destination_stop_id' });
    }

    const destStop = await Stop.findById(destObjectId).lean();
    if (!destStop) {
      return res.status(404).json({ error: 'Destination stop not found' });
    }

    let originStop = null;
    if (origin_stop_id) {
      try {
        originStop = await Stop.findById(new mongoose.Types.ObjectId(origin_stop_id)).lean();
      } catch (err) {
        // ignore invalid origin_stop_id format
      }
    }

    // Find active routes in zone passing through this destination stop.
    // We filter by destStop.zone directly to avoid client-side zone mismatch errors.
    const routeFilter = {
      active: true,
      'stops.stop': destObjectId,
      zone: destStop.zone
    };

    const routes = await Route.find(routeFilter).populate('stops.stop').lean();

    // Optimize: Pre-calculate active running bus counts per route using aggregate
    const routeIds = routes.map(r => r._id);
    const busCounts = await Bus.aggregate([
      {
        $match: {
          route: { $in: routeIds },
          status: 'running'
        }
      },
      {
        $group: {
          _id: "$route",
          count: { $sum: 1 }
        }
      }
    ]);
    const busCountMap = {};
    busCounts.forEach(bc => {
      if (bc._id) {
        busCountMap[bc._id.toString()] = bc.count;
      }
    });

    const userLat = (lat && !isNaN(parseFloat(lat))) ? parseFloat(lat) : null;
    const userLng = (lng && !isNaN(parseFloat(lng))) ? parseFloat(lng) : null;

    const optionsList = [];

    for (const route of routes) {
      // Find destination stop entry on this route
      const destEntry = route.stops.find(s => {
        if (!s.stop) return false;
        const stopId = s.stop._id ? s.stop._id.toString() : s.stop.toString();
        return stopId === destObjectId.toString();
      });
      if (!destEntry) continue;

      // Boarding candidates: stops on the route prior to the destination stop
      const candidates = route.stops.filter(s => s.stop_order < destEntry.stop_order);

      // Find the nearest boarding stop to user
      let boardingEntry = null;
      let walkingDistanceKm = null;

      if (originStop) {
        // Find if the selected origin stop is on the route prior to the destination stop
        boardingEntry = candidates.find(s => {
          if (!s.stop) return false;
          const stopId = s.stop._id ? s.stop._id.toString() : s.stop.toString();
          return stopId === originStop._id.toString();
        });
        if (!boardingEntry) {
          // If the selected origin stop is not on the route prior to destination, this route is not a valid option
          continue;
        }
        walkingDistanceKm = 0;
      } else if (candidates.length > 0) {
        if (userLat !== null && userLng !== null) {
          let minWalkDist = Infinity;
          for (const candidate of candidates) {
            if (!candidate.stop) continue;
            const candLat = candidate.stop.latitude;
            const candLng = candidate.stop.longitude;
            if (candLat === undefined || candLng === undefined) continue;

            const dist = calculateDistance(userLat, userLng, candLat, candLng);
            if (dist < minWalkDist) {
              minWalkDist = dist;
              boardingEntry = candidate;
            }
          }
          walkingDistanceKm = minWalkDist;
        } else {
          // If user location is not provided, default to the first stop on the route
          boardingEntry = candidates.reduce((prev, curr) => prev.stop_order < curr.stop_order ? prev : curr);
        }
      } else {
        // Fallback: if destination stop is the first stop, let them board at the destination itself
        boardingEntry = destEntry;
        if (userLat !== null && userLng !== null && destEntry.stop) {
          const destLat = destEntry.stop.latitude;
          const destLng = destEntry.stop.longitude;
          if (destLat !== undefined && destLng !== undefined) {
            walkingDistanceKm = calculateDistance(userLat, userLng, destLat, destLng);
          }
        }
      }

      if (!boardingEntry || !boardingEntry.stop || !destStop) continue;

      // Calculate travel distance on the bus
      let busDistanceKm = destEntry.distance_from_start_km - boardingEntry.distance_from_start_km;
      if (!busDistanceKm || busDistanceKm <= 0) {
        // Fallback: cumulative distance between stops
        const sortedRouteStops = [...route.stops].sort((a, b) => a.stop_order - b.stop_order);
        const bIdx = sortedRouteStops.findIndex(s => {
          if (!s.stop || !boardingEntry.stop) return false;
          const stopId = s.stop._id ? s.stop._id.toString() : s.stop.toString();
          const boardStopId = boardingEntry.stop._id ? boardingEntry.stop._id.toString() : boardingEntry.stop.toString();
          return stopId === boardStopId;
        });
        const dIdx = sortedRouteStops.findIndex(s => {
          if (!s.stop || !destEntry.stop) return false;
          const stopId = s.stop._id ? s.stop._id.toString() : s.stop.toString();
          const destStopId = destEntry.stop._id ? destEntry.stop._id.toString() : destEntry.stop.toString();
          return stopId === destStopId;
        });
        busDistanceKm = 0;
        for (let i = bIdx; i < dIdx; i++) {
          const s1 = sortedRouteStops[i].stop;
          const s2 = sortedRouteStops[i + 1].stop;
          if (s1 && s2 && s1.latitude && s1.longitude && s2.latitude && s2.longitude) {
            busDistanceKm += calculateDistance(s1.latitude, s1.longitude, s2.latitude, s2.longitude);
          }
        }
      }

      // Fare calculation
      const baseFare = route.base_fare || 10;
      const perKmFare = route.per_km_fare || 1.5;
      const fareEstimate = Math.max(baseFare, Math.round(busDistanceKm * perKmFare * 100) / 100);

      // Travel time ETA based on route type average speed
      let speedKmh = 25;
      if (route.type === 'city') speedKmh = 20;
      else if (route.type === 'suburban') speedKmh = 25;
      else if (route.type === 'express') speedKmh = 35;
      else if (route.type === 'superfast') speedKmh = 45;

      const durationMin = Math.max(2, Math.round((busDistanceKm / speedKmh) * 60));

      const activeBusesCount = busCountMap[route._id.toString()] || 0;

      optionsList.push({
        route_id: route._id,
        route_code: route.code,
        route_name: route.name,
        route_type: route.type,
        description: route.description,
        fare: fareEstimate,
        duration_min: durationMin,
        distance_km: busDistanceKm,
        walking_distance_km: walkingDistanceKm,
        active_buses: activeBusesCount,
        boarding_stop: {
          id: boardingEntry.stop._id,
          name: boardingEntry.stop.name,
          latitude: boardingEntry.stop.latitude,
          longitude: boardingEntry.stop.longitude
        },
        destination_stop: {
          id: destStop._id,
          name: destStop.name,
          latitude: destStop.latitude,
          longitude: destStop.longitude
        }
      });
    }

    if (optionsList.length === 0) {
      return res.json({});
    }

    // Rank options:
    // 1. Best
    const bestOptions = [...optionsList].sort((a, b) => {
      const aWalk = a.walking_distance_km !== null ? a.walking_distance_km : 0;
      const bWalk = b.walking_distance_km !== null ? b.walking_distance_km : 0;
      const scoreA = aWalk * 10 + a.duration_min + a.fare * 0.5;
      const scoreB = bWalk * 10 + b.duration_min + b.fare * 0.5;
      return scoreA - scoreB;
    });

    // 2. Fastest
    const fastestOptions = [...optionsList].sort((a, b) => a.duration_min - b.duration_min);

    // 3. Cheapest
    const cheapestOptions = [...optionsList].sort((a, b) => a.fare - b.fare);

    // 4. Least Walking
    const leastWalkingOptions = userLat !== null && userLng !== null
      ? [...optionsList].sort((a, b) => (a.walking_distance_km || 0) - (b.walking_distance_km || 0))
      : null;

    res.json({
      best: bestOptions[0] || null,
      fastest: fastestOptions[0] || null,
      cheapest: cheapestOptions[0] || null,
      least_walking: leastWalkingOptions ? leastWalkingOptions[0] : null,
      all: optionsList
    });

  } catch (err) {
    console.error('Error finding routes:', err);
    res.status(500).json({ error: 'Server error finding routes' });
  }
});

// ─── Get route with stops ───────────────────────────────────────────────────
router.get('/:id', async (req, res) => {
  const route = await Route.findById(req.params.id).populate('stops.stop').lean();
  if (!route) return res.status(404).json({ error: 'Route not found' });

  const stops = (route.stops || [])
    .sort((a, b) => a.stop_order - b.stop_order)
    .map(rs => ({
      id: rs.stop._id,
      name: rs.stop.name,
      name_ml: rs.stop.name_ml,
      latitude: rs.stop.latitude,
      longitude: rs.stop.longitude,
      landmark: rs.stop.landmark,
      stop_order: rs.stop_order,
      distance_from_start_km: rs.distance_from_start_km,
    }));

  res.json({ ...route, id: route._id, stops });
});

// ─── Get active buses on a route ────────────────────────────────────────────
router.get('/:id/buses', async (req, res) => {
  const buses = await Bus.find({ route: req.params.id })
    .populate('last_stop', 'name')
    .populate('next_stop', 'name')
    .populate('route', 'stops')
    .lean();

  res.json(buses.map(b => ({
    id: b._id,
    registration: b.registration,
    type: b.type,
    capacity: b.capacity,
    latitude: b.latitude,
    longitude: b.longitude,
    speed_kmh: b.speed_kmh,
    heading: b.heading,
    status: b.status,
    last_gps_update: b.last_gps_update,
    last_stop_name: b.last_stop?.name || null,
    next_stop_name: b.next_stop?.name || null,
    route_verified: b.route_verified || false,
    route_verification_status: b.route_verification_status || 'pending',
    verified_stops_count: b.verified_stops_count || 0,
    requiredStops: b.route && b.route.stops ? Math.max(1, b.route.stops.length - 3) : 3,
  })));
});

module.exports = router;
