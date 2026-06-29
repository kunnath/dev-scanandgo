const mongoose = require('mongoose');

const gpsLogSchema = new mongoose.Schema({
  bus:        { type: mongoose.Schema.Types.ObjectId, ref: 'Bus', required: true },
  latitude:   { type: Number, required: true },
  longitude:  { type: Number, required: true },
  speed_kmh:  { type: Number, default: 0 },
  heading:    { type: Number, default: 0 },
  recorded_at:{ type: Date, default: Date.now },
});

gpsLogSchema.index({ bus: 1, recorded_at: -1 });
gpsLogSchema.index({ recorded_at: 1 }, { expireAfterSeconds: 604800 }); // 7-day TTL expiry

module.exports = mongoose.model('GpsLog', gpsLogSchema);
