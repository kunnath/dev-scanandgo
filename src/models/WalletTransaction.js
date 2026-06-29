const mongoose = require('mongoose');

const walletTransactionSchema = new mongoose.Schema({
  user:           { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  type:           { type: String, enum: ['credit', 'debit', 'refund', 'settlement'], required: true },
  amount:         { type: Number, required: true },
  balance_after:  { type: Number, required: true },
  description:    { type: String, default: '' },
  payment_method: { type: String, default: 'upi' },         // upi, wallet, razorpay
  payment_id:     { type: String, default: null },           // razorpay_payment_id
  order_id:       { type: String, default: null },           // razorpay_order_id
  payment_status: { type: String, enum: ['pending', 'success', 'failed'], default: 'pending' },

  // Settlement fields (for conductor payouts)
  ticket_id:      { type: mongoose.Schema.Types.ObjectId, ref: 'Ticket', default: null },
  conductor_id:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  settlement_status: {
    type: String,
    enum: ['none', 'pending', 'settled', 'refunded'],
    default: 'none'
  },
  settled_at:     { type: Date, default: null },
}, { timestamps: true });

walletTransactionSchema.index({ user: 1, createdAt: -1 });
walletTransactionSchema.index({ order_id: 1 });
walletTransactionSchema.index({ ticket_id: 1 });
walletTransactionSchema.index({ conductor_id: 1, createdAt: -1 });

module.exports = mongoose.model('WalletTransaction', walletTransactionSchema);
