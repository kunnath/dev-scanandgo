const express = require('express');
const crypto = require('crypto');
const router = require('express').Router();
const Bus = require('../models/Bus');
const Ticket = require('../models/Ticket');
const User = require('../models/User');
const WalletTransaction = require('../models/WalletTransaction');
const Route = require('../models/Route');
const BusAssignment = require('../models/BusAssignment');
const { authenticate, requireActiveOwnerSubscription } = require('../middleware/auth');

// POST /api/owner/claim-bus
// Body: { busId }
// Allows an owner to claim a bus by setting owner
router.post('/claim-bus', authenticate, requireActiveOwnerSubscription, async (req, res) => {
  try {
    const { busId } = req.body;
    if (!busId) return res.status(400).json({ error: 'busId is required' });
    // Only allow claiming if bus is not already assigned to an owner
    const bus = await Bus.findOne({ _id: busId, owner: null });
    if (!bus) return res.status(404).json({ error: 'Bus not found or already assigned to an owner' });
    bus.owner = req.user._id;
    await bus.save();
    res.json({ message: 'Bus claimed successfully', busId: bus._id });
  } catch (err) {
    res.status(500).json({ error: 'Failed to claim bus', details: err.message });
  }
});

// DEMO/TEST ONLY: Ensure a conductor exists by phone number (for assignment demo)
// POST /api/owner/ensure-conductor
// Body: { name, phone }
router.post('/ensure-conductor', authenticate, requireActiveOwnerSubscription, async (req, res) => {
  try {
    const { name, phone, password } = req.body;
    if (!name || !phone) return res.status(400).json({ error: 'name and phone are required' });
    let conductor = await User.findOne({ phone, role: 'conductor' });
    if (!conductor) {
      const conductorPassword = password || crypto.randomBytes(6).toString('hex'); // 12-char hex password
      conductor = new User({ name, phone, password: conductorPassword, role: 'conductor', wallet: 0 });
      await conductor.save();
      return res.json({ created: true, conductor, temporaryPassword: !password ? conductorPassword : undefined });
    }
    res.json({ created: false, conductor });
  } catch (err) {
    res.status(500).json({ error: 'Failed to ensure conductor', details: err.message });
  }
});

// Assign a conductor to a bus by phone number
// POST /api/owner/assign-conductor
// Body: { busId, conductorPhone }
router.post('/assign-conductor', authenticate, requireActiveOwnerSubscription, async (req, res) => {
  try {
    const { busId, conductorPhone, routeId } = req.body;

    console.log('[DEBUG] Assign-conductor request:', { busId, conductorPhone, routeId, typeofConductorPhone: typeof conductorPhone });
    if (!busId || !conductorPhone || !routeId) {
      return res.status(400).json({ error: 'busId, routeId, and conductorPhone (or name) are required.' });
    }

    // Find the bus mapped to this owner
    const bus = await Bus.findOne({ _id: busId, owner: req.user._id });
    if (!bus) {
      return res.status(404).json({ error: 'Bus not found or not owned by you.' });
    }

    // Find the conductor by phone OR name (case-insensitive)
    const conductor = await User.findOne({
      role: 'conductor',
      $or: [
        { phone: conductorPhone },
        { name: { $regex: `^${conductorPhone}$`, $options: 'i' } }
      ]
    });
    console.log('[DEBUG] Conductor lookup result:', conductor);
    if (!conductor) {
      return res.status(404).json({ error: 'Invalid Conductor phone number or name.' });
    }

    // Assign conductor and route to bus
    if (!bus.conductors) bus.conductors = [];
    // Prevent duplicate assignment
    if (!bus.conductors.some(id => id.toString() === conductor._id.toString())) {
      bus.conductors.push(conductor._id);
    }
    bus.route = routeId;
    await bus.save();

    // Update conductor's assignedBus and assignedRoute fields
    conductor.assignedBus = bus._id;
    conductor.assignedRoute = routeId;
    await conductor.save();

    res.json({ message: 'Operation successful', busId: bus._id, conductorId: conductor._id, routeId });
  } catch (err) {
    res.status(500).json({ error: 'Failed to assign conductor', details: err.message });
  }
});


// GET /api/owner/dashboard/revenue
// Returns revenue breakdowns: daily, monthly, hourly, route-wise, bus-wise
router.get('/dashboard/revenue', authenticate, requireActiveOwnerSubscription, async (req, res) => {
  try {
    const ownerId = req.user._id;
    const { from, to, groupBy } = req.query; // groupBy: 'day', 'month', 'hour', 'route', 'bus'
    // Get all buses mapped to this owner
    const buses = await Bus.find({ owner: ownerId });
    const busIds = buses.map(b => b._id);

    // Build match query
    const match = { bus: { $in: busIds } };
    if (from || to) {
      match.createdAt = {};
      if (from) match.createdAt.$gte = new Date(from);
      if (to) match.createdAt.$lte = new Date(to);
    }

    // Grouping logic
    let group = {};
    let project = {};
    if (groupBy === 'day') {
      group = {
        _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
        totalRevenue: { $sum: { $multiply: [{ $ifNull: ['$fare', 0] }, { $ifNull: ['$count', 1] }] } },
        ticketCount: { $sum: { $ifNull: ['$count', 1] } }
      };
      project = { _id: 0, day: '$_id', totalRevenue: 1, ticketCount: 1 };
    } else if (groupBy === 'month') {
      group = {
        _id: { $dateToString: { format: '%Y-%m', date: '$createdAt' } },
        totalRevenue: { $sum: { $multiply: [{ $ifNull: ['$fare', 0] }, { $ifNull: ['$count', 1] }] } },
        ticketCount: { $sum: { $ifNull: ['$count', 1] } }
      };
      project = { _id: 0, month: '$_id', totalRevenue: 1, ticketCount: 1 };
    } else if (groupBy === 'hour') {
      group = {
        _id: { $hour: '$createdAt' },
        totalRevenue: { $sum: { $multiply: [{ $ifNull: ['$fare', 0] }, { $ifNull: ['$count', 1] }] } },
        ticketCount: { $sum: { $ifNull: ['$count', 1] } }
      };
      project = { _id: 0, hour: '$_id', totalRevenue: 1, ticketCount: 1 };
    } else if (groupBy === 'route') {
      group = {
        _id: '$route',
        totalRevenue: { $sum: { $multiply: [{ $ifNull: ['$fare', 0] }, { $ifNull: ['$count', 1] }] } },
        ticketCount: { $sum: { $ifNull: ['$count', 1] } }
      };
      project = { _id: 0, route: '$_id', totalRevenue: 1, ticketCount: 1 };
    } else if (groupBy === 'bus') {
      group = {
        _id: '$bus',
        totalRevenue: { $sum: { $multiply: [{ $ifNull: ['$fare', 0] }, { $ifNull: ['$count', 1] }] } },
        ticketCount: { $sum: { $ifNull: ['$count', 1] } }
      };
      project = { _id: 0, bus: '$_id', totalRevenue: 1, ticketCount: 1 };
    } else {
      // Default: total revenue
      group = {
        _id: null,
        totalRevenue: { $sum: { $multiply: [{ $ifNull: ['$fare', 0] }, { $ifNull: ['$count', 1] }] } },
        ticketCount: { $sum: { $ifNull: ['$count', 1] } }
      };
      project = { _id: 0, totalRevenue: 1, ticketCount: 1 };
    }

    const agg = [
      { $match: match },
      { $group: group },
      { $project: project },
      { $sort: groupBy === 'hour' ? { hour: 1 } : groupBy === 'day' ? { day: 1 } : {} }
    ];

    let results = await Ticket.aggregate(agg);

    // If grouping by route or bus, populate names
    if (groupBy === 'route') {
      const routes = await Route.find({ _id: { $in: results.map(r => r.route) } });
      results = results.map(r => {
        const route = routes.find(rt => rt._id.toString() === r.route?.toString());
        return { ...r, routeName: route ? route.name : '' };
      });
    } else if (groupBy === 'bus') {
      const buses = await Bus.find({ _id: { $in: results.map(b => b.bus) } });
      results = results.map(r => {
        const bus = buses.find(bs => bs._id.toString() === r.bus?.toString());
        return { ...r, busRegistration: bus ? bus.registration : '' };
      });
    }

    res.json({ revenue: results });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch revenue breakdown', details: err.message });
  }
});

// GET /api/owner/dashboard/tickets
// Returns all tickets for buses owned by the owner, with optional filters
router.get('/dashboard/tickets', authenticate, requireActiveOwnerSubscription, async (req, res) => {
  try {
    const ownerId = req.user._id;
    const { bus, route, status, from, to } = req.query;
    // Get all buses mapped to this owner
    const buses = await Bus.find({ owner: ownerId });
    const busIds = buses.map(b => b._id);

    // Build query
    const query = { bus: { $in: busIds } };
    if (bus) query.bus = bus;
    if (route) query.route = route;
    if (status) query.status = status;
    if (from || to) {
      query.createdAt = {};
      if (from) query.createdAt.$gte = new Date(from);
      if (to) query.createdAt.$lte = new Date(to);
    }

    // Populate user, bus, route for context
    const tickets = await Ticket.find(query)
      .populate('user', 'name phone')
      .populate('bus', 'registration')
      .populate('route', 'name code')
      .sort({ createdAt: -1 })
      .limit(500); // Limit for performance

    res.json({ tickets });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch tickets', details: err.message });
  }
});

// GET /api/owner/dashboard/metrics
// Returns key business metrics for the owner
router.get('/dashboard/metrics', authenticate, requireActiveOwnerSubscription, async (req, res) => {
  try {
    const ownerId = req.user._id;
    // Get all buses owned by this owner
    const buses = await Bus.find({ owner: ownerId });
    const busIds = buses.map(b => b._id);

    // Total tickets sold for owned buses
    const ticketMetricsAgg = await Ticket.aggregate([
      { $match: { bus: { $in: busIds } } },
      {
        $group: {
          _id: null,
          totalTickets: { $sum: { $ifNull: ['$count', 1] } },
          totalRevenue: { $sum: { $multiply: [{ $ifNull: ['$fare', 0] }, { $ifNull: ['$count', 1] }] } }
        }
      }
    ]);
    const totalTickets = ticketMetricsAgg[0]?.totalTickets || 0;
    const totalRevenue = ticketMetricsAgg[0]?.totalRevenue || 0;

    // Active buses (example: status = 'active')
    const activeBuses = await Bus.countDocuments({ owner: ownerId, status: 'active' });

    res.json({
      totalBuses: buses.length,
      activeBuses,
      totalTickets,
      totalRevenue
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch metrics', details: err.message });
  }
});


// GET /api/owner/assignments
// Returns all current assignments (bus, route, conductor)

router.get('/assignments', authenticate, requireActiveOwnerSubscription, async (req, res) => {
  try {
    const ownerId = req.user._id;
    // Get all buses owned by this owner
    const buses = await Bus.find({ owner: ownerId }).populate('route').populate('conductors');
    // Flatten assignments: one row per bus-conductor
    const assignments = [];
    for (const bus of buses) {
      if (bus.conductors && bus.conductors.length) {
        for (const conductor of bus.conductors) {
          assignments.push({
            busReg: bus.registration,
            routeName: bus.route?.name || '',
            conductorName: conductor.name,
            status: 'Active'
          });
        }
      } else {
        assignments.push({
          busReg: bus.registration,
          routeName: bus.route?.name || '',
          conductorName: '-',
          status: 'Unassigned'
        });
      }
    }
    res.json({ assignments });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch assignments', details: err.message });
  }
});

// GET /api/owner/available-buses
// Returns all buses owned by the owner that are not assigned to a conductor
router.get('/available-buses', authenticate, requireActiveOwnerSubscription, async (req, res) => {
  try {
    const ownerId = req.user._id;
    // Buses owned by owner
    const buses = await Bus.find({ owner: ownerId });
    res.json({ buses });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch buses', details: err.message });
  }
});

// GET /api/owner/available-routes
// Returns all routes (optionally filter by owner if needed)
router.get('/available-routes', authenticate, requireActiveOwnerSubscription, async (req, res) => {
  try {
    // Filter by zone if provided in query or user
    let zone = req.query.zone;
    if (!zone && req.user && req.user.zone) zone = req.user.zone;
    // Default to 'kannur' if not specified
    if (!zone) zone = 'kannur';
    const routes = await Route.find({ zone });
    res.json({ routes });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch routes', details: err.message });
  }
});

// GET /api/owner/available-conductors
// Returns all conductors not currently assigned to a bus
router.get('/available-conductors', authenticate, requireActiveOwnerSubscription, async (req, res) => {
  try {
    // Find all users with role 'conductor' who are not assigned to a bus (assignedBus is null or not set)
    const conductors = await User.find({
      role: 'conductor',
      $or: [
        { assignedBus: null },
        { assignedBus: { $exists: false } }
      ]
    });
    res.json({ conductors });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch conductors', details: err.message });
  }
});

// POST /api/owner/assign
// Assigns a bus, route, and conductor
router.post('/assign', authenticate, requireActiveOwnerSubscription, async (req, res) => {
  try {
    const { busId, routeId, conductorId } = req.body;
    if (!busId || !routeId || !conductorId) {
      return res.status(400).json({ error: 'busId, routeId, and conductorId are required' });
    }
    const ownerId = req.user._id;
    // Try to find bus by _id or registration (for dummyBusNumber)
    let bus = await Bus.findById(busId);
    if (!bus) {
      // Try to find by registration
      bus = await Bus.findOne({ registration: busId });
    }
    if (!bus) {
      // Create new bus with dummyBusNumber as registration
      bus = new Bus({
        registration: busId,
        owner: ownerId,
        status: 'idle',
        zone: 'kannur',
        conductors: [],
      });
    }
    bus.route = routeId;
    if (!bus.conductors) bus.conductors = [];
    if (!bus.conductors.includes(conductorId)) bus.conductors.push(conductorId);
    await bus.save();

    // Assign bus and route to conductor
    const conductor = await User.findById(conductorId);
    if (!conductor) return res.status(404).json({ error: 'Conductor not found' });
    conductor.assignedBus = bus._id;
    conductor.assignedRoute = routeId;
    await conductor.save();

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to assign', details: err.message });
  }
});

// POST /api/owner/assign-bus
// Body: { busId, conductorId, routeId }
router.post('/assign-bus', authenticate, requireActiveOwnerSubscription, async (req, res) => {
  try {
    const { busId, conductorId, routeId } = req.body;
    if (!busId || !conductorId) return res.status(400).json({ error: 'busId and conductorId are required' });
    // Only allow assignment if bus is owned by this owner
    const bus = await Bus.findOne({ _id: busId, owner: req.user._id });
    if (!bus) return res.status(404).json({ error: 'Bus not found or not owned by you' });
    // Create or update assignment
    let assignment = await BusAssignment.findOneAndUpdate(
      { bus: busId },
      { owner: req.user._id, conductorId, routeId, status: 'active' },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    res.json({ message: 'Assignment successful', assignment });
  } catch (err) {
    res.status(500).json({ error: 'Failed to assign bus', details: err.message });
  }
});

// GET /api/owner/assignments-dashboard
// Returns all assignments for this owner
router.get('/assignments-dashboard', authenticate, requireActiveOwnerSubscription, async (req, res) => {
  try {
    const assignments = await BusAssignment.find({ owner: req.user._id })
      .populate('bus', 'registration')
      .populate('conductorId', 'name phone')
      .populate('routeId', 'name code');
    res.json({ assignments });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch assignments', details: err.message });
  }
});

module.exports = router;
