const mongoose = require('mongoose');

const BusAssignmentSchema = new mongoose.Schema({
  bus:         { type: mongoose.Schema.Types.ObjectId, ref: 'Bus', required: true, index: true },
  owner:       { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  conductorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  routeId:     { type: mongoose.Schema.Types.ObjectId, ref: 'Route', required: false },
  status:      { type: String, enum: ['active', 'inactive', 'pending'], default: 'active' },
}, { timestamps: true });

BusAssignmentSchema.index({ bus: 1, owner: 1, conductorId: 1 }, { unique: true });

module.exports = mongoose.model('BusAssignment', BusAssignmentSchema);
