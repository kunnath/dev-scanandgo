const mongoose = require('mongoose');

const busExpenseSchema = new mongoose.Schema({
  bus:               { type: mongoose.Schema.Types.ObjectId, ref: 'Bus', required: true },
  conductor:         { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  type:              { type: String, enum: ['invoice', 'expense'], required: true },
  amount:            { type: Number, required: true, min: 0 },
  details:           { type: String, trim: true, maxlength: 500, default: '' },
  date:              { type: Date, default: Date.now },
  // Cloudflare R2 proof file
  proofKey:          { type: String, default: null }, // R2 object key (for deletion)
  proofUrl:          { type: String, default: null }, // public URL
  proofOriginalName: { type: String, default: null }, // original filename
  proofMimeType:     { type: String, default: null }, // image/jpeg, image/png, application/pdf
}, { timestamps: true });

busExpenseSchema.index({ bus: 1, date: -1 });

module.exports = mongoose.model('BusExpense', busExpenseSchema);
