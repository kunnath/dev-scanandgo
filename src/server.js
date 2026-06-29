const express = require('express');
const http = require('http');
const https = require('https');
const fs = require('fs');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');
const config = require('./config');
const connectDB = require('./db');
const cron = require('node-cron');

const app = express();
const server = http.createServer(app);

// ─── HTTPS server (needed for camera access on mobile over WiFi) ────────────
let httpsServer = null;
const certPath = path.join(__dirname, '..', 'certs', 'cert.pem');
const keyPath = path.join(__dirname, '..', 'certs', 'key.pem');
if (fs.existsSync(certPath) && fs.existsSync(keyPath)) {
  httpsServer = https.createServer({
    key: fs.readFileSync(keyPath),
    cert: fs.readFileSync(certPath),
  }, app);
}

// Socket.IO on both HTTP and HTTPS
const io = new Server(server, {
  cors: {
    origin: [
      'https://poyaloo.com', 
      'https://poyalo.netlify.app',
      //'https://scanandgo-mhzn.onrender.com',
      'https://scanandgo-api-s4y4.onrender.com',
      'http://localhost:3000',
      'http://localhost:5173',
      'http://localhost:8080',
      'http://192.168.178.49:3000',
      'http://10.0.2.2:3000',       // Android emulator → host machine
    ],
    credentials: true,
  },
});
if (httpsServer) {
  // Attach Socket.IO to HTTPS server too
  io.attach(httpsServer);
}

// ─── Middleware ──────────────────────────────────────────────────────────────
// CORS: Allow only trusted frontend origins (production + local dev)
app.use(cors({
  origin: [
    'https://poyaloo.com',         // Production frontend
    'https://poyalo.netlify.app', // Production frontend
    'http://localhost:3000',      // Local dev (React/Vite)
    'http://localhost:5173',
    'http://localhost:8080',
    'http://192.168.178.49:3000', // Local network dev
    'http://10.0.2.2:3000',       // Android emulator
  ],
  credentials: true,
}));
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

// Production error sanitization middleware (prevents exposing raw error details to clients)
app.use((req, res, next) => {
  const originalJson = res.json;
  const originalSend = res.send;

  res.json = function (obj) {
    if (res.statusCode === 500 && process.env.NODE_ENV === 'production') {
      if (obj && (obj.error || obj.details)) {
        return originalJson.call(this, {
          error: 'An unexpected error occurred. Please try again later.'
        });
      }
    }
    return originalJson.call(this, obj);
  };

  res.send = function (body) {
    if (res.statusCode === 500 && process.env.NODE_ENV === 'production') {
      if (typeof body === 'string') {
        return originalSend.call(this, 'An unexpected error occurred. Please try again later.');
      }
    }
    return originalSend.call(this, body);
  };

  next();
});

// ─── API Routes ─────────────────────────────────────────────────────────────
app.use('/api/auth', require('./routes/auth'));
app.use('/api/zones', require('./routes/zones'));
app.use('/api/routes', require('./routes/routes'));
app.use('/api/buses', require('./routes/buses'));
app.use('/api/tickets', require('./routes/tickets'));
app.use('/api/wallet', require('./routes/wallet'));
app.use('/api/predictions', require('./routes/predictions'));
app.use('/api/owner', require('./routes/owner'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api/chat', require('./routes/chat'));

// Mount owner dropdown data route
app.use('/api/owner', require('./routes/owner_dropdown_data'));

// Mount owner analytics routes
app.use('/api/owner', require('./routes/owner_analytics'));

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    app: config.appName,
    city: config.appCity,
    db: 'MongoDB Atlas',
    timestamp: new Date().toISOString(),
  });
});

// ─── Serve frontend (SPA fallback) ──────────────────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// ─── Global Error Handler ────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('[Global Error Handler] Caught error:', err);
  const status = err.status || 500;
  const message = process.env.NODE_ENV === 'production'
    ? 'An unexpected error occurred. Please try again later.'
    : err.message;
  res.status(status).json({
    error: message,
    ...(process.env.NODE_ENV !== 'production' && { details: err.stack })
  });
});

// ─── Socket.IO ──────────────────────────────────────────────────────────────
const setupSocket = require('./services/socket');
setupSocket(io);

// ─── Start ──────────────────────────────────────────────────────────────────
const os = require('os');
function getLocalIP() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) return iface.address;
    }
  }
  return 'localhost';
}

async function ensureDemoUsers() {
  const User = require('./models/User');
  const demoUsers = [
    { name: 'Demo Passenger', phone: '9000000005', password: 'pass123', role: 'passenger', wallet: 500 },
    { name: 'Demo Conductor', phone: '9000000002', password: 'cond123', role: 'conductor', wallet: 0 },
  ];

  for (const demo of demoUsers) {
    const existing = await User.findOne({ phone: demo.phone });
    if (!existing) {
      await User.create(demo);
      console.log(`✅ Demo user created: ${demo.role} (${demo.phone})`);
    }
  }
}

async function startServer() {
  // Connect to MongoDB first
  await connectDB();

  // Ensure demo user accounts exist (so login works without running the seed script)
  await ensureDemoUsers();

  // Route Verifier — validates conductor is following assigned route
  const RouteVerifier = require('./services/routeVerifier');
  const routeVerifier = new RouteVerifier(io);
  routeVerifier.start();

  // GPS Simulator (dev mode) – start after DB connection
  const GPSSimulator = require('./services/gpsSimulator');
  const gpsSimulator = new GPSSimulator(io, routeVerifier);
  gpsSimulator.start();

  // Auto-refund expired unvalidated tickets every 5 minutes
  const Ticket = require('./models/Ticket');
  const User = require('./models/User');
  const WalletTransaction = require('./models/WalletTransaction');

  // Auto-refund expired unvalidated tickets every 5 minutes
  cron.schedule('*/5 * * * *', async () => {
    try {
      const expired = await Ticket.find({
        status: 'active',
        payment_status: 'held',
        expires_at: { $lt: new Date() }
      });

      for (const ticket of expired) {
        ticket.status = 'expired';
        ticket.payment_status = 'refunded';
        ticket.refunded_at = new Date();
        await ticket.save();

        const refundAmount = ticket.total_fare || (ticket.fare * (ticket.count || 1));
        const passenger = await User.findByIdAndUpdate(
          ticket.user,
          { $inc: { wallet: refundAmount } },
          { new: true }
        );
        if (passenger) {
          await WalletTransaction.create({
            user: passenger._id,
            type: 'refund',
            amount: refundAmount,
            balance_after: passenger.wallet,
            description: `Auto-refund: ticket expired (not validated by conductor)`,
            payment_method: 'wallet',
            payment_status: 'success',
            ticket_id: ticket._id,
            settlement_status: 'refunded',
          });

          await WalletTransaction.findOneAndUpdate(
            { ticket_id: ticket._id, user: passenger._id, type: 'debit' },
            { settlement_status: 'refunded' }
          );
        }
      }

      if (expired.length > 0) {
        console.log(`♻️  Auto-refunded ${expired.length} expired tickets`);
      }
    } catch (err) {
      console.error('Auto-refund error:', err);
    }
  });

  // Owner subscription maintenance every hour:
  // 1) expire ended subscriptions, 2) mark one-day reminder sent timestamp.
  cron.schedule('0 * * * *', async () => {
    try {
      const now = new Date();
      const inOneDay = new Date(now.getTime() + (24 * 60 * 60 * 1000));
      const reminderCooldown = new Date(now.getTime() - (20 * 60 * 60 * 1000));

      const expiredResult = await User.updateMany(
        {
          role: 'owner',
          subscriptionStatus: 'active',
          subscriptionEndAt: { $lte: now },
        },
        {
          $set: { subscriptionStatus: 'expired' },
        }
      );

      const reminderResult = await User.updateMany(
        {
          role: 'owner',
          subscriptionStatus: 'active',
          subscriptionEndAt: { $gt: now, $lte: inOneDay },
          $or: [
            { subscriptionReminderSentAt: null },
            { subscriptionReminderSentAt: { $exists: false } },
            { subscriptionReminderSentAt: { $lt: reminderCooldown } },
          ],
        },
        {
          $set: { subscriptionReminderSentAt: now },
        }
      );

      const expiredCount = expiredResult?.modifiedCount || 0;
      const reminderCount = reminderResult?.modifiedCount || 0;
      if (expiredCount > 0 || reminderCount > 0) {
        console.log(`🔔 Owner subscriptions: expired=${expiredCount}, one-day-reminders=${reminderCount}`);
      }
    } catch (err) {
      console.error('Owner subscription maintenance error:', err);
    }
  });

  const localIP = getLocalIP();
  const httpsPort = Number(config.port) + 443; // e.g. 3443

  server.listen(config.port, '0.0.0.0', () => {
    console.log(`   HTTP  → http://localhost:${config.port}  |  http://${localIP}:${config.port}`);
  });

  if (httpsServer) {
    httpsServer.listen(httpsPort, '0.0.0.0', () => {
      console.log(`   HTTPS → https://localhost:${httpsPort} | https://${localIP}:${httpsPort}  (📷 Camera works here!)`);
    });
  }

  console.log(`
╔══════════════════════════════════════════════════════════╗
║                                                          ║
║   🚌  ScanAndGo – ${config.appCity}                   ║
║                                                          ║
║   Local:    http://localhost:${config.port}                      ║
║   Network:  http://${localIP}:${config.port}                 ║${httpsServer ? `
║   📷 HTTPS: https://${localIP}:${httpsPort}               ║` : ''}
║   Database: MongoDB Atlas                                ║
║   GPS Sim:  ${config.gpsSimulation ? 'ON' : 'OFF'}                                       ║
║                                                          ║
║   📷 Use HTTPS URL on mobile for camera scanner          ║
║                                                          ║
╚══════════════════════════════════════════════════════════╝
  `);
}

startServer().catch(err => {
  console.error('Failed to start server:', err);
  process.exit(1);
});

module.exports = { app, server, io };
