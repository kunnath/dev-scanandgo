const mongoose = require('mongoose');

const advertisementSchema = new mongoose.Schema({
  title:       { type: String, required: true, trim: true, maxlength: 80 },
  description: { type: String, required: true, trim: true, maxlength: 200 },
  url:         { type: String, default: '', trim: true },
  imageUrl:    { type: String, default: '', trim: true },
  isActive:    { type: Boolean, default: true },
  createdBy:   { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

module.exports = mongoose.model('Advertisement', advertisementSchema);
