const mongoose = require('mongoose');

const ownerSubscriptionPaymentSchema = new mongoose.Schema({
  owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  plan: { type: String, enum: ['thirty_days', 'monthly', 'yearly'], required: true },
  amount: { type: Number, required: true },
  currency: { type: String, default: 'INR' },
  status: { type: String, enum: ['success', 'failed'], default: 'success' },
  provider: { type: String, enum: ['razorpay', 'dev_simulation'], required: true },
  orderId: { type: String, default: null },
  paymentId: { type: String, default: null },
  signature: { type: String, default: null },
  paidAt: { type: Date, default: Date.now, index: true },
  metadata: { type: Object, default: {} },
}, { timestamps: true });

ownerSubscriptionPaymentSchema.index({ owner: 1, paidAt: -1 });
ownerSubscriptionPaymentSchema.index({ owner: 1, status: 1, paidAt: -1 });

module.exports = mongoose.model('OwnerSubscriptionPayment', ownerSubscriptionPaymentSchema);
