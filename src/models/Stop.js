const mongoose = require('mongoose');

const stopSchema = new mongoose.Schema({
  name:      { type: String, required: true },
  name_ml:   { type: String, default: null },
  latitude:  { type: Number, required: true },
  longitude: { type: Number, required: true },
  landmark:  { type: String, default: null },
  zone:      { type: String, required: true, enum: ['trivandrum', 'kannur', 'kozhikode', 'pathanamthitta'], default: 'trivandrum', index: true },
}, { timestamps: true });

stopSchema.index({ name: 'text', name_ml: 'text' });

module.exports = mongoose.model('Stop', stopSchema);
