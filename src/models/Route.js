const mongoose = require('mongoose');

const routeStopSchema = new mongoose.Schema({
  stop:       { type: mongoose.Schema.Types.ObjectId, ref: 'Stop', required: true },
  stop_order: { type: Number, required: true },
  distance_from_start_km: { type: Number, default: 0 },
});

const routeSchema = new mongoose.Schema({
  name:        { type: String, required: true },
  code:        { type: String, required: true },
  description: { type: String, default: null },
  type:        { type: String, enum: ['city', 'suburban', 'express', 'superfast'], default: 'city' },
  base_fare:   { type: Number, default: 10 },
  per_km_fare: { type: Number, default: 1.5 },
  active:      { type: Boolean, default: true },
  stops:       [routeStopSchema],
  zone:        { type: String, required: true, enum: ['trivandrum', 'kannur', 'kozhikode', 'pathanamthitta'], default: 'trivandrum', index: true },
  first_bus:   { type: String, default: null },
  last_bus:    { type: String, default: null },
  timings:     { type: String, default: null },
  total_distance_km: { type: Number, default: null },
}, { timestamps: true });

routeSchema.index({ code: 1, zone: 1 }, { unique: true });

module.exports = mongoose.model('Route', routeSchema);