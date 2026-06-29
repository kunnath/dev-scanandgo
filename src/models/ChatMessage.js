const mongoose = require('mongoose');

const CHAT_ROOMS = ['general', 'movies', 'dating', 'politics'];

const chatMessageSchema = new mongoose.Schema({
  roomKey: {
    type: String,
    enum: CHAT_ROOMS,
    required: true,
    index: true,
  },
  sender: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  },
  senderName: {
    type: String,
    required: true,
    trim: true,
  },
  senderPhone: {
    type: String,
    required: true,
    trim: true,
    index: true,
  },
  text: {
    type: String,
    required: true,
    trim: true,
    maxlength: 500,
  },
}, { timestamps: true });

chatMessageSchema.index({ roomKey: 1, createdAt: -1 });

module.exports = mongoose.model('ChatMessage', chatMessageSchema);
