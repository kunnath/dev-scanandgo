const express = require('express');
const ArrivalPrediction = require('../models/ArrivalPrediction');
const Stop = require('../models/Stop');

const router = express.Router();

// ─── Get arrival predictions for a stop ─────────────────────────────────────
router.get('/stop/:stopId', async (req, res) => {
  const predictions = await ArrivalPrediction.find({
    stop: req.params.stopId,
    predicted_arrival: { $gt: new Date() },
  })
    .populate({
      path: 'bus',
      match: { status: 'running' },
      select: 'registration type latitude longitude speed_kmh route',
      populate: { path: 'route', select: 'name code' },
    })
    .sort('predicted_arrival')
    .lean();

  // Filter out predictions where bus didn't match (not running)
  const filtered = predictions
    .filter(p => p.bus)
    .map(p => ({
      ...p,
      registration: p.bus.registration,
      bus_type: p.bus.type,
      route_name: p.bus.route?.name,
      route_code: p.bus.route?.code,
      latitude: p.bus.latitude,
      longitude: p.bus.longitude,
      speed_kmh: p.bus.speed_kmh,
    }));

  const stop = await Stop.findById(req.params.stopId).lean();
  res.json({ stop: stop ? { ...stop, id: stop._id } : null, predictions: filtered });
});

// ─── Get arrival predictions for a bus ──────────────────────────────────────
router.get('/bus/:busId', async (req, res) => {
  const predictions = await ArrivalPrediction.find({
    bus: req.params.busId,
    predicted_arrival: { $gt: new Date() },
  })
    .populate('stop', 'name latitude longitude')
    .sort('predicted_arrival')
    .lean();

  res.json(predictions.map(p => ({
    ...p,
    stop_name: p.stop?.name,
    stop_lat: p.stop?.latitude,
    stop_lng: p.stop?.longitude,
  })));
});

module.exports = router;
