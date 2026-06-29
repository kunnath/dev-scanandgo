const express = require('express');
const ChatMessage = require('../models/ChatMessage');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

const CHAT_ROOMS = [
  { key: 'general', name: 'General' },
  { key: 'movies', name: 'Movies' },
  { key: 'dating', name: 'Dating' },
  { key: 'politics', name: 'Politics' },
];
const VALID_ROOM_KEYS = new Set(CHAT_ROOMS.map((r) => r.key));

function normalizeLimit(rawLimit) {
  const parsed = Number(rawLimit);
  if (!Number.isFinite(parsed) || parsed <= 0) return 40;
  return Math.min(Math.floor(parsed), 100);
}

router.get('/rooms', authenticate, (req, res) => {
  res.json({ rooms: CHAT_ROOMS });
});

router.get('/messages/:roomKey', authenticate, async (req, res) => {
  try {
    const { roomKey } = req.params;
    if (!VALID_ROOM_KEYS.has(roomKey)) {
      return res.status(400).json({ message: 'Invalid room key' });
    }

    const limit = normalizeLimit(req.query.limit);
    const query = { roomKey };

    if (req.query.before) {
      const beforeDate = new Date(req.query.before);
      if (!Number.isNaN(beforeDate.getTime())) {
        query.createdAt = { $lt: beforeDate };
      }
    }

    const messages = await ChatMessage.find(query)
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();

    res.json({
      roomKey,
      messages: messages.reverse(),
    });
  } catch (err) {
    res.status(500).json({ message: 'Failed to load chat messages' });
  }
});

router.post('/messages/:roomKey', authenticate, async (req, res) => {
  try {
    const { roomKey } = req.params;
    if (!VALID_ROOM_KEYS.has(roomKey)) {
      return res.status(400).json({ message: 'Invalid room key' });
    }

    const text = String(req.body.text || '').trim();
    if (!text) {
      return res.status(400).json({ message: 'Message text is required' });
    }
    if (text.length > 500) {
      return res.status(400).json({ message: 'Message is too long (max 500 chars)' });
    }

    const message = await ChatMessage.create({
      roomKey,
      sender: req.user.id,
      senderName: req.user.name,
      senderPhone: req.user.phone,
      text,
    });

    res.status(201).json({ message });
  } catch (err) {
    res.status(500).json({ message: 'Failed to send message' });
  }
});

module.exports = router;
