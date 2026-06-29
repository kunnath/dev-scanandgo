const express = require('express');
const multer = require('multer');
const Bus = require('../models/Bus');
const GpsLog = require('../models/GpsLog');
const BusExpense = require('../models/BusExpense');
const { authenticate, authorize } = require('../middleware/auth');
const { uploadToR2, getSignedProofUrl, ALLOWED_TYPES } = require('../services/r2Upload');

// multer: store file in memory (streamed directly to R2, no disk I/O)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB max
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_TYPES[file.mimetype]) return cb(null, true);
    cb(new Error('Only PNG, JPEG and PDF files are allowed'));
  },
});

const router = express.Router();

// ─── List available (unassigned) buses for registration ───────────────
router.get('/available', async (req, res) => {
  const filter = { route: null, conductor: null };
  if (req.query.zone) filter.zone = req.query.zone;
  const buses = await Bus.find(filter).sort('registration').lean();
  res.json(buses.map(b => ({ id: b._id, registration: b.registration })));
});

// ─── List all buses ─────────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  const filter = {};
  if (req.query.zone) filter.zone = req.query.zone;
  const buses = await Bus.find(filter)
    .populate('route', 'name code stops')
    .populate('last_stop', 'name')
    .populate('next_stop', 'name')
    .sort('status registration')
    .lean();

  res.json(buses.map(b => ({
    ...b, id: b._id,
    route_name: b.route?.name || null,
    route_code: b.route?.code || null,
    last_stop_name: b.last_stop?.name || null,
    next_stop_name: b.next_stop?.name || null,
    requiredStops: b.route?.stops ? Math.max(1, b.route.stops.length - 3) : 3,
  })));
});

// ─── Search buses ─────────────────────────────────────────────────────────────
router.get('/search', authenticate, authorize('conductor', 'admin'), async (req, res) => {
  try {
    const { registration } = req.query;
    if (!registration) return res.status(400).json({ error: 'registration query required' });
    const buses = await Bus.find({ registration: new RegExp(registration.trim(), 'i') })
      .populate('route', 'name code stops')
      .populate('last_stop', 'name')
      .populate('next_stop', 'name')
      .limit(5)
      .lean();
    res.json(buses.map(bus => ({ ...bus, id: bus._id })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Get one bus ────────────────────────────────────────────────────────────
router.get('/:id', async (req, res) => {
  const bus = await Bus.findById(req.params.id)
    .populate('route', 'name code stops')
    .populate('last_stop', 'name')
    .populate('next_stop', 'name')
    .populate('conductor', 'name')
    .lean();

  if (!bus) return res.status(404).json({ error: 'Bus not found' });

  res.json({
    ...bus, id: bus._id,
    route_name: bus.route?.name || null,
    route_code: bus.route?.code || null,
    last_stop_name: bus.last_stop?.name || null,
    next_stop_name: bus.next_stop?.name || null,
    conductor_name: bus.conductor?.name || null,
    requiredStops: bus.route?.stops ? Math.max(1, bus.route.stops.length - 3) : 3,
  });
});

// ─── Update bus GPS (from GPS device / conductor app) ───────────────────────
router.post('/:id/gps', authenticate, authorize('conductor', 'admin'), async (req, res) => {
  const { latitude, longitude, speed_kmh, heading } = req.body;
  if (latitude == null || longitude == null) {
    return res.status(400).json({ error: 'latitude and longitude required' });
  }

  const now = new Date();
  await Bus.findByIdAndUpdate(req.params.id, {
    latitude, longitude,
    speed_kmh: speed_kmh || 0,
    heading: heading || 0,
    last_gps_update: now,
  });

  await GpsLog.create({
    bus: req.params.id, latitude, longitude,
    speed_kmh: speed_kmh || 0,
    heading: heading || 0,
  });

  res.json({ message: 'GPS updated', latitude, longitude });
});

// ─── Update bus status ──────────────────────────────────────────────────────
router.patch('/:id/status', authenticate, authorize('conductor', 'admin'), async (req, res) => {
  const { status } = req.body;
  if (!['idle', 'running', 'maintenance', 'breakdown', 'off-route'].includes(status)) {
    return res.status(400).json({ error: 'Invalid status' });
  }

  await Bus.findByIdAndUpdate(req.params.id, { status });
  res.json({ message: `Bus status set to ${status}` });
});

// ─── Get GPS history for a bus ──────────────────────────────────────────────
router.get('/:id/gps-history', async (req, res) => {
  const limit = parseInt(req.query.limit) || 100;
  const logs = await GpsLog.find({ bus: req.params.id }).sort('-recorded_at').limit(limit).lean();
  res.json(logs);
});

// ─── Get route verification status for a bus ────────────────────────────────
router.get('/:id/route-status', async (req, res) => {
  const bus = await Bus.findById(req.params.id)
    .select('registration route_verified route_verification_status verified_stops_count route_verified_at route_deviation_at')
    .lean();
  if (!bus) return res.status(404).json({ error: 'Bus not found' });
  res.json({
    id: bus._id,
    registration: bus.registration,
    route_verified: bus.route_verified || false,
    route_verification_status: bus.route_verification_status || 'pending',
    verified_stops_count: bus.verified_stops_count || 0,
    route_verified_at: bus.route_verified_at || null,
    route_deviation_at: bus.route_deviation_at || null,
  });
});

// ─── Conductor: Submit invoice or expense for assigned bus ─────────────────
// Accepts multipart/form-data with optional 'proof' file (PNG/JPEG/PDF, max 5 MB)
router.post(
  '/:busId/expenses',
  authenticate,
  authorize('conductor'),
  upload.single('proof'),
  async (req, res) => {
    try {
      const { type, amount, details } = req.body;

      if (!['invoice', 'expense'].includes(type)) {
        return res.status(400).json({ error: 'type must be "invoice" or "expense"' });
      }
      const parsedAmount = parseFloat(amount);
      if (!parsedAmount || parsedAmount <= 0) {
        return res.status(400).json({ error: 'amount must be a positive number' });
      }

      // Verify the authenticated conductor is assigned to this bus
      // (conductor field = self-assigned; conductors array = owner-assigned)
      const User = require('../models/User');
      const user = await User.findById(req.user.id).lean();
      if (!user || !user.assignedBus || user.assignedBus.toString() !== req.params.busId) {
        return res.status(403).json({ error: 'You are not assigned to this bus' });
      }

      // Upload proof file to R2 if provided
      let proofKey = null, proofUrl = null, proofOriginalName = null, proofMimeType = null;
      if (req.file) {
        const r2 = await uploadToR2(
          req.file.buffer,
          req.file.mimetype,
          req.file.originalname,
          `expenses/${req.params.busId}`,
        );
        proofKey          = r2.key;
        proofUrl          = r2.publicUrl;
        proofOriginalName = r2.originalName;
        proofMimeType     = r2.mimeType;
      }

      const entry = await BusExpense.create({
        bus:       req.params.busId,
        conductor: req.user.id,
        type,
        amount:    parsedAmount,
        details:   (details || '').slice(0, 500),
        proofKey,
        proofUrl,
        proofOriginalName,
        proofMimeType,
      });

      res.json({ success: true, entry });
    } catch (err) {
      console.error('[BusExpense] POST error:', err);
      // multer size/type error
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ error: 'Proof file must be under 5 MB' });
      }
      res.status(500).json({ error: err.message });
    }
  }
);

// ─── Conductor: View expense history for assigned bus ────────────────────────
router.get('/:busId/expenses', authenticate, authorize('conductor'), async (req, res) => {
  try {
    // Verify conductor is assigned to this bus by checking their profile
    const User = require('../models/User');
    const user = await User.findById(req.user.id).lean();
    if (!user || !user.assignedBus || user.assignedBus.toString() !== req.params.busId) {
      return res.status(403).json({ error: 'You are not assigned to this bus' });
    }

    const entries = await BusExpense.find({ bus: req.params.busId })
      .sort('-date')
      .limit(50)
      .lean();

    res.json({ success: true, entries });
  } catch (err) {
    console.error('[BusExpense] GET error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── Conductor: Get a temporary signed URL for a proof file ────────────────
// GET /api/buses/:busId/expenses/:expenseId/proof-url
router.get('/:busId/expenses/:expenseId/proof-url', authenticate, authorize('conductor'), async (req, res) => {
  try {
    const User = require('../models/User');
    const user = await User.findById(req.user.id).lean();
    if (!user || !user.assignedBus || user.assignedBus.toString() !== req.params.busId) {
      return res.status(403).json({ error: 'You are not assigned to this bus' });
    }

    const entry = await BusExpense.findOne({
      _id: req.params.expenseId,
      bus: req.params.busId,
    }).lean();
    if (!entry)         return res.status(404).json({ error: 'Expense entry not found' });
    if (!entry.proofKey) return res.status(404).json({ error: 'No proof file attached to this entry' });

    const signedUrl = await getSignedProofUrl(entry.proofKey);
    res.json({ success: true, signedUrl, mimeType: entry.proofMimeType, originalName: entry.proofOriginalName });
  } catch (err) {
    console.error('[BusExpense] proof-url error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
