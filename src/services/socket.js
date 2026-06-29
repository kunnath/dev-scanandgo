/**
 * Socket.IO handler for real-time bus tracking.
 * Passengers join a route room to receive live bus positions.
 */

const jwt = require('jsonwebtoken');
const config = require('../config');
const ChatMessage = require('../models/ChatMessage');

const CHAT_ROOMS = new Set(['general', 'movies', 'dating', 'politics']);

function socketAuthMiddleware(socket, next) {
  try {
    const token = socket.handshake.auth?.token || socket.handshake.headers?.authorization?.replace('Bearer ', '');
    if (!token) return next(new Error('Authentication required'));
    const payload = jwt.verify(token, config.jwtSecret);
    socket.user = payload; // { id, name, phone, role }
    next();
  } catch (err) {
    next(new Error('Invalid or expired token'));
  }
}

function setupSocket(io) {
  io.use(socketAuthMiddleware);
  io.on('connection', (socket) => {
    // Only authenticated users reach here

    // Join a route room to track buses on that route
    socket.on('track:route', (routeId) => {
      if (!socket.user) return;
      socket.join(`route:${routeId}`);
      console.log(`[Socket.IO] User ${socket.user.phone} joined route room: route:${routeId}`);
    });

    // Leave a route room
    socket.on('untrack:route', (routeId) => {
      if (!socket.user) return;
      socket.leave(`route:${routeId}`);
    });

    // Join a specific bus room
    socket.on('track:bus', (busId) => {
      if (!socket.user) return;
      socket.join(`bus:${busId}`);
    });

    socket.on('untrack:bus', (busId) => {
      if (!socket.user) return;
      socket.leave(`bus:${busId}`);
    });

    // Track a specific stop for arrivals
    socket.on('track:stop', (stopId) => {
      if (!socket.user) return;
      socket.join(`stop:${stopId}`);
    });

    socket.on('untrack:stop', (stopId) => {
      if (!socket.user) return;
      socket.leave(`stop:${stopId}`);
    });

    // Join a public chat room.
    socket.on('chat:join', (roomKey) => {
      if (!socket.user) return;
      if (!CHAT_ROOMS.has(roomKey)) return;
      socket.join(`chat:${roomKey}`);
    });

    socket.on('chat:leave', (roomKey) => {
      if (!socket.user) return;
      if (!CHAT_ROOMS.has(roomKey)) return;
      socket.leave(`chat:${roomKey}`);
    });

    socket.on('chat:send', async (payload, ack) => {
      try {
        if (!socket.user) {
          if (typeof ack === 'function') ack({ ok: false, message: 'Authentication required' });
          return;
        }

        const roomKey = String(payload?.roomKey || '').trim();
        const text = String(payload?.text || '').trim();

        if (!CHAT_ROOMS.has(roomKey)) {
          if (typeof ack === 'function') ack({ ok: false, message: 'Invalid room key' });
          return;
        }
        if (!text) {
          if (typeof ack === 'function') ack({ ok: false, message: 'Message text is required' });
          return;
        }
        if (text.length > 500) {
          if (typeof ack === 'function') ack({ ok: false, message: 'Message is too long (max 500 chars)' });
          return;
        }

        const message = await ChatMessage.create({
          roomKey,
          sender: socket.user.id,
          senderName: socket.user.name,
          senderPhone: socket.user.phone,
          text,
        });

        const chatPayload = {
          _id: message._id,
          roomKey: message.roomKey,
          sender: message.sender,
          senderName: message.senderName,
          senderPhone: message.senderPhone,
          text: message.text,
          createdAt: message.createdAt,
        };

        io.to(`chat:${roomKey}`).emit('chat:new-message', chatPayload);
        if (typeof ack === 'function') ack({ ok: true, message: chatPayload });
      } catch (err) {
        if (typeof ack === 'function') ack({ ok: false, message: 'Failed to send message' });
      }
    });
  });
}

module.exports = setupSocket;
