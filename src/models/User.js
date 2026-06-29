const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
  name:     { type: String, required: true },
  phone:    { type: String, required: true, unique: true },
  email:    { type: String, default: null },
  password: { type: String, required: true },
  role:     { type: String, enum: ['passenger', 'conductor', 'admin', 'owner'], default: 'passenger' },
  ticketCategory: { type: String, enum: ['adult', 'student', 'free'], default: 'adult' },
  studentPassUrl: { type: String, default: null },
  studentPassKey: { type: String, default: null },
  wallet:   { type: Number, default: 0 },
  assignedRoute: { type: mongoose.Schema.Types.ObjectId, ref: 'Route', default: null },
  assignedBus:   { type: mongoose.Schema.Types.ObjectId, ref: 'Bus', default: null },

  // For owners: track their resources explicitly
  ownedRoutes: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Route', default: [] }],
  ownedConductors: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User', default: [] }],

  // Owner subscription lifecycle
  subscriptionPlan: {
    type: String,
    enum: ['thirty_days', 'monthly', 'yearly', null],
    default: null,
  },
  subscriptionStatus: {
    type: String,
    enum: ['none', 'active', 'expired'],
    default: 'none',
  },
  subscriptionStartAt: { type: Date, default: null },
  subscriptionEndAt: { type: Date, default: null },
  subscriptionReminderSentAt: { type: Date, default: null },
  subscriptionTotalPaid: { type: Number, default: 0 },
  subscriptionLastPaidAmount: { type: Number, default: 0 },
  subscriptionLastPaidAt: { type: Date, default: null },
  subscriptionLastPaymentProvider: { type: String, default: null },
  subscriptionLastPaymentId: { type: String, default: null },
  ownerPendingSubscription: {
    orderId: { type: String, default: null },
    plan: { type: String, enum: ['thirty_days', 'monthly', 'yearly', null], default: null },
    amount: { type: Number, default: 0 },
    createdAt: { type: Date, default: null },
  },

  // Conductor UPI payment fields
  conductorUpiId:   { type: String, trim: true, default: '' },   // e.g. ravi@oksbi, 9876543210@paytm
  conductorUpiName: { type: String, trim: true, default: '' },   // display name on UPI
  totalEarnings:    { type: Number, default: 0 },                // lifetime earnings from ticket validations
  todayEarnings:    { type: Number, default: 0 },                // today's earnings (reset daily)
  lastEarningDate:  { type: String, default: '' },               // YYYY-MM-DD to track daily reset

  // Passenger privacy
  hidePhoneFromConductor: { type: Boolean, default: false },

  // One-time 30-day plan tracking
  thirtyDayPlanEverActivated: { type: Boolean, default: false },

  // Poyaloo Pass
  poyalooPassActive: { type: Boolean, default: false },
  poyalooPassCardNumber: { type: String, unique: true, sparse: true },
  poyalooPassPhotoUrl: { type: String, default: null },
  poyalooPassPhotoKey: { type: String, default: null },
  poyalooPassPhysicalCount: { type: Number, default: 0 },
  poyalooPassPhysicalAddress: { type: String, default: '' },
  poyalooPassCardBlocked: { type: Boolean, default: false },

  // Password reset
  passwordResetToken:   { type: String, default: null },
  passwordResetExpires: { type: Date, default: null },
}, { timestamps: true });

// Hash password before save
userSchema.pre('save', async function () {
  if (!this.isModified('password')) return;
  this.password = await bcrypt.hash(this.password, 10);
});

// Compare password
userSchema.methods.comparePassword = function (candidatePassword) {
  return bcrypt.compareSync(candidatePassword, this.password);
};

// Indexes for better query performance
userSchema.index({ phone: 1 });
userSchema.index({ role: 1 });
userSchema.index({ role: 1, subscriptionStatus: 1, subscriptionEndAt: 1 });
userSchema.index({ role: 1, subscriptionLastPaidAt: -1 });
userSchema.index({ ownedRoutes: 1 });
userSchema.index({ ownedConductors: 1 });

module.exports = mongoose.model('User', userSchema);