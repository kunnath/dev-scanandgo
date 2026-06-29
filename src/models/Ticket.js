const mongoose = require('mongoose');

const ticketSchema = new mongoose.Schema({
    count:      { type: Number, default: 1 },
  user:       { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  bus:        { type: mongoose.Schema.Types.ObjectId, ref: 'Bus', required: true },
  route:      { type: mongoose.Schema.Types.ObjectId, ref: 'Route', required: true },
  from_stop:  { type: mongoose.Schema.Types.ObjectId, ref: 'Stop', required: true },
  to_stop:    { type: mongoose.Schema.Types.ObjectId, ref: 'Stop', required: true },
  fare:       { type: Number, required: true },
  total_fare: { type: Number, required: true },
  qr_code:    { type: String, default: null },
  status:     { type: String, enum: ['active', 'used', 'expired', 'cancelled', 'rejected'], default: 'active' },
  boarded_at: { type: Date, default: null },
  alighted_at:{ type: Date, default: null },
  validated:  { type: Boolean, default: false },
  validated_by: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  expires_at: { type: Date, required: true },
  rejection_reason: { type: String, default: null },

  // Payment & settlement
  payment_status: {
    type: String,
    enum: ['held', 'settled', 'refunded'],
    default: 'held'
  },
  settled_to_conductor: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  settled_at:   { type: Date, default: null },
  refunded_at:  { type: Date, default: null },
}, { timestamps: true });

ticketSchema.index({ user: 1 });
ticketSchema.index({ bus: 1 });
ticketSchema.index({ status: 1, payment_status: 1, expires_at: 1 });
ticketSchema.index({ validated_by: 1, boarded_at: -1 });

module.exports = mongoose.model('Ticket', ticketSchema);
