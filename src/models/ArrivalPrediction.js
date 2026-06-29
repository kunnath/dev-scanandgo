const mongoose = require('mongoose');

const arrivalPredictionSchema = new mongoose.Schema({
  bus:               { type: mongoose.Schema.Types.ObjectId, ref: 'Bus', required: true },
  stop:              { type: mongoose.Schema.Types.ObjectId, ref: 'Stop', required: true },
  predicted_arrival: { type: Date, required: true },
  confidence:        { type: Number, default: 0.8 },
}, { timestamps: true });

arrivalPredictionSchema.index({ bus: 1 });
arrivalPredictionSchema.index({ stop: 1 });
arrivalPredictionSchema.index({ predicted_arrival: 1 }, { expireAfterSeconds: 3600 }); // Expire 1 hour after predicted arrival time

module.exports = mongoose.model('ArrivalPrediction', arrivalPredictionSchema);
