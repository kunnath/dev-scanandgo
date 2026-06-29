const mongoose = require('mongoose');

const busSchema = new mongoose.Schema({
  owner:        { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  registration: { type: String, required: true, unique: true },
  route:        { type: mongoose.Schema.Types.ObjectId, ref: 'Route', default: null },
  conductors:   [{ type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null }],
  type:         { type: String, enum: ['ordinary', 'fast', 'superfast', 'ac'], default: 'ordinary' },
  capacity:     { type: Number, default: 50 },
  gps_enabled:  { type: Boolean, default: true },
  latitude:     { type: Number, default: null },
  longitude:    { type: Number, default: null },
  speed_kmh:    { type: Number, default: 0 },
  heading:      { type: Number, default: 0 },
  last_stop:    { type: mongoose.Schema.Types.ObjectId, ref: 'Stop', default: null },
  next_stop:    { type: mongoose.Schema.Types.ObjectId, ref: 'Stop', default: null },
  status:       { type: String, enum: ['idle', 'running', 'maintenance', 'breakdown', 'off-route'], default: 'idle' },
  last_gps_update: { type: Date, default: null },
  start_time:   { type: String, default: null }, // e.g. "06:00"
  stop_time:    { type: String, default: null }, // e.g. "22:00"

  // Route verification fields
  route_verified:             { type: Boolean, default: false },
  route_verification_status:  { type: String, enum: ['pending', 'verified', 'delayed', 'off-route'], default: 'pending' },
  route_verified_at:          { type: Date, default: null },
  route_deviation_at:         { type: Date, default: null },
  verified_stops_count:       { type: Number, default: 0 },
  zone:                       { type: String, required: true, enum: ['trivandrum', 'kannur', 'kozhikode', 'pathanamthitta'], default: 'trivandrum', index: true },
}, { timestamps: true });

busSchema.index({ route: 1, status: 1 });

module.exports = mongoose.model('Bus', busSchema);
