const express = require('express');
const router = express.Router();
const Bus = require('../models/Bus');
const Ticket = require('../models/Ticket');
const User = require('../models/User');
const Route = require('../models/Route');
const BusExpense = require('../models/BusExpense');
const { getSignedProofUrl } = require('../services/r2Upload');
const { authenticate, requireActiveOwnerSubscription } = require('../middleware/auth');

// =============================================
// OWNER ANALYTICS DASHBOARD ENDPOINTS
// =============================================

// GET /api/owner/analytics/overview
// Real-time dashboard with key business metrics
router.get('/analytics/overview', authenticate, requireActiveOwnerSubscription, async (req, res) => {
  try {
    const ownerId = req.user.id;
    
    // Get owner's buses
    const buses = await Bus.find({ owner: ownerId }).select('_id status').lean();
    const busIds = buses.map(b => b._id);
    
    if (busIds.length === 0) {
      return res.json({
        success: true,
        totalBuses: 0,
        activeBuses: 0,
        totalTicketsSold: 0,
        totalRevenue: 0,
        todayRevenue: 0,
        monthlyRevenue: 0,
        totalPassengers: 0
      });
    }
    
    // Count active buses
    const activeBuses = buses.filter(b => b.status === 'running').length;
    
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);

    // Optimize: Aggregate ticket stats entirely in MongoDB instead of loading all tickets in memory
    const ticketStats = await Ticket.aggregate([
      {
        $match: {
          bus: { $in: busIds },
          status: { $ne: 'cancelled' }
        }
      },
      {
        $group: {
          _id: null,
          totalTicketsSold: { $sum: { $ifNull: ["$count", 1] } },
          totalRevenue: { $sum: { $multiply: ["$fare", { $ifNull: ["$count", 1] }] } },
          todayRevenue: {
            $sum: {
              $cond: [
                { $gte: ["$createdAt", todayStart] },
                { $multiply: ["$fare", { $ifNull: ["$count", 1] }] },
                0
              ]
            }
          },
          monthlyRevenue: {
            $sum: {
              $cond: [
                { $gte: ["$createdAt", monthStart] },
                { $multiply: ["$fare", { $ifNull: ["$count", 1] }] },
                0
              ]
            }
          }
        }
      }
    ]);

    const stats = ticketStats[0] || {
      totalTicketsSold: 0,
      totalRevenue: 0,
      todayRevenue: 0,
      monthlyRevenue: 0
    };

    const metrics = {
      totalBuses: buses.length,
      activeBuses,
      totalTicketsSold: stats.totalTicketsSold,
      totalRevenue: stats.totalRevenue,
      todayRevenue: stats.todayRevenue,
      monthlyRevenue: stats.monthlyRevenue,
      totalPassengers: stats.totalTicketsSold
    };

    // Clean up dual response shapes - return top-level fields directly.
    res.json({
      success: true,
      ...metrics
    });
  } catch (err) {
    console.error('[ERROR] Failed to fetch overview metrics:', err);
    res.status(500).json({ 
      success: false,
      error: 'Failed to load metrics', 
      details: err.message 
    });
  }
});

// GET /api/owner/analytics/revenue-breakdown
// Daily, monthly, and hourly booking amounts
router.get('/analytics/revenue-breakdown', authenticate, requireActiveOwnerSubscription, async (req, res) => {
  try {
    const ownerId = req.user.id;
    const { period = 'daily' } = req.query; // daily, monthly, hourly
    
    // Get owner's buses
    const buses = await Bus.find({ owner: ownerId }).select('_id').lean();
    const busIds = buses.map(b => b._id);
    
    if (busIds.length === 0) {
      return res.json({
        success: true,
        data: []
      });
    }
    
    let breakdown = [];
    
    if (period === 'daily') {
      // Last 30 days
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      thirtyDaysAgo.setHours(0, 0, 0, 0);

      const dailyStats = await Ticket.aggregate([
        {
          $match: {
            bus: { $in: busIds },
            status: { $ne: 'cancelled' },
            createdAt: { $gte: thirtyDaysAgo }
          }
        },
        {
          $group: {
            _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt", timezone: "+05:30" } },
            revenue: { $sum: { $multiply: ["$fare", { $ifNull: ["$count", 1] }] } }
          }
        }
      ]);

      const dailyMap = {};
      for (let i = 29; i >= 0; i--) {
        const date = new Date();
        date.setDate(date.getDate() - i);
        const dateStr = date.toISOString().split('T')[0];
        dailyMap[dateStr] = 0;
      }
      
      dailyStats.forEach(stat => {
        if (dailyMap.hasOwnProperty(stat._id)) {
          dailyMap[stat._id] = stat.revenue;
        }
      });
      
      breakdown = Object.entries(dailyMap).map(([date, revenue]) => ({
        _id: date,
        label: date,
        revenue,
        value: revenue
      }));
      
    } else if (period === 'monthly') {
      // Last 12 months
      const twelveMonthsAgo = new Date();
      twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 12);
      twelveMonthsAgo.setDate(1);
      twelveMonthsAgo.setHours(0, 0, 0, 0);

      const monthlyStats = await Ticket.aggregate([
        {
          $match: {
            bus: { $in: busIds },
            status: { $ne: 'cancelled' },
            createdAt: { $gte: twelveMonthsAgo }
          }
        },
        {
          $group: {
            _id: { $dateToString: { format: "%Y-%m", date: "$createdAt", timezone: "+05:30" } },
            revenue: { $sum: { $multiply: ["$fare", { $ifNull: ["$count", 1] }] } }
          }
        }
      ]);

      const monthlyMap = {};
      for (let i = 11; i >= 0; i--) {
        const date = new Date();
        date.setMonth(date.getMonth() - i);
        const monthStr = date.toISOString().substring(0, 7); // YYYY-MM
        monthlyMap[monthStr] = 0;
      }
      
      monthlyStats.forEach(stat => {
        if (monthlyMap.hasOwnProperty(stat._id)) {
          monthlyMap[stat._id] = stat.revenue;
        }
      });
      
      breakdown = Object.entries(monthlyMap).map(([month, revenue]) => ({
        _id: month,
        label: month,
        revenue,
        value: revenue
      }));
      
    } else if (period === 'hourly') {
      // Today by hour
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);

      const hourlyStats = await Ticket.aggregate([
        {
          $match: {
            bus: { $in: busIds },
            status: { $ne: 'cancelled' },
            createdAt: { $gte: todayStart }
          }
        },
        {
          $group: {
            _id: { $hour: { date: "$createdAt", timezone: "+05:30" } },
            revenue: { $sum: { $multiply: ["$fare", { $ifNull: ["$count", 1] }] } }
          }
        }
      ]);

      const hourlyMap = {};
      for (let h = 0; h < 24; h++) {
        hourlyMap[h] = 0;
      }
      
      hourlyStats.forEach(stat => {
        const hour = stat._id;
        if (hourlyMap.hasOwnProperty(hour)) {
          hourlyMap[hour] = stat.revenue;
        }
      });
      
      breakdown = Object.entries(hourlyMap).map(([hour, revenue]) => ({
        _id: hour,
        label: `${hour.toString().padStart(2, '0')}:00`,
        revenue,
        value: revenue
      }));
    }
    
    res.json({
      success: true,
      period,
      data: breakdown
    });
  } catch (err) {
    console.error('[ERROR] Failed to fetch revenue breakdown:', err);
    res.status(500).json({ 
      success: false,
      error: 'Failed to load revenue breakdown', 
      details: err.message 
    });
  }
});

// GET /api/owner/analytics/route-wise
// Route-wise revenue and passenger statistics
router.get('/analytics/route-wise', authenticate, requireActiveOwnerSubscription, async (req, res) => {
  try {
    const ownerId = req.user.id;
    
    // Get owner's buses with routes
    const buses = await Bus.find({ owner: ownerId })
      .select('_id route')
      .populate('route', 'name code')
      .lean();
    
    if (buses.length === 0) {
      return res.json({
        success: true,
        routes: []
      });
    }
    
    // Group buses by route
    const routeMap = {};
    const busIds = [];
    buses.forEach(bus => {
      if (bus.route) {
        busIds.push(bus._id);
        const routeId = bus.route._id.toString();
        if (!routeMap[routeId]) {
          routeMap[routeId] = {
            routeId,
            routeName: bus.route.name,
            routeCode: bus.route.code,
            busIds: []
          };
        }
        routeMap[routeId].busIds.push(bus._id);
      }
    });

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    // Optimize: Pre-calculate route statistics in MongoDB using a single aggregation pipeline
    const routeStats = await Ticket.aggregate([
      {
        $match: {
          bus: { $in: busIds },
          status: { $ne: 'cancelled' }
        }
      },
      {
        $group: {
          _id: "$route",
          totalRevenue: { $sum: { $multiply: ["$fare", { $ifNull: ["$count", 1] }] } },
          totalPassengers: { $sum: { $ifNull: ["$count", 1] } },
          todayRevenue: {
            $sum: {
              $cond: [
                { $gte: ["$createdAt", todayStart] },
                { $multiply: ["$fare", { $ifNull: ["$count", 1] }] },
                0
              ]
            }
          },
          todayPassengers: {
            $sum: {
              $cond: [
                { $gte: ["$createdAt", todayStart] },
                { $ifNull: ["$count", 1] },
                0
              ]
            }
          }
        }
      }
    ]);

    const routeStatsMap = {};
    routeStats.forEach(stat => {
      if (stat._id) {
        routeStatsMap[stat._id.toString()] = stat;
      }
    });
    
    const routeAnalytics = Object.values(routeMap).map(route => {
      const stats = routeStatsMap[route.routeId] || {
        totalRevenue: 0,
        totalPassengers: 0,
        todayRevenue: 0,
        todayPassengers: 0
      };
      
      return {
        routeId: route.routeId,
        routeName: route.routeName,
        routeCode: route.routeCode,
        busCount: route.busIds.length,
        totalTickets: stats.totalPassengers,
        totalBuses: route.busIds.length,
        totalRevenue: stats.totalRevenue,
        totalPassengers: stats.totalPassengers,
        todayRevenue: stats.todayRevenue,
        todayPassengers: stats.todayPassengers,
        avgRevenuePerBus: route.busIds.length > 0 ? stats.totalRevenue / route.busIds.length : 0,
        avgRevenuePerPassenger: stats.totalPassengers > 0 ? stats.totalRevenue / stats.totalPassengers : 0
      };
    });
    
    // Sort by total revenue descending
    routeAnalytics.sort((a, b) => b.totalRevenue - a.totalRevenue);
    
    res.json({
      success: true,
      routes: routeAnalytics
    });
  } catch (err) {
    console.error('[ERROR] Failed to fetch route-wise analytics:', err);
    res.status(500).json({ 
      success: false,
      error: 'Failed to load route analytics', 
      details: err.message 
    });
  }
});

// GET /api/owner/analytics/bus-wise
// Bus-wise revenue and passenger statistics
router.get('/analytics/bus-wise', authenticate, requireActiveOwnerSubscription, async (req, res) => {
  try {
    const ownerId = req.user.id;
    
    // Get owner's buses with routes
    const buses = await Bus.find({ owner: ownerId })
      .select('registration _id type capacity status route')
      .populate('route', 'name code')
      .lean();
    
    if (buses.length === 0) {
      return res.json({
        success: true,
        buses: []
      });
    }
    
    const busIds = buses.map(b => b._id);
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    // Optimize: Pre-calculate bus statistics using a single aggregate query on Ticket
    const busStats = await Ticket.aggregate([
      {
        $match: {
          bus: { $in: busIds },
          status: { $ne: 'cancelled' }
        }
      },
      {
        $group: {
          _id: "$bus",
          totalRevenue: { $sum: { $multiply: ["$fare", { $ifNull: ["$count", 1] }] } },
          totalPassengers: { $sum: { $ifNull: ["$count", 1] } },
          todayRevenue: {
            $sum: {
              $cond: [
                { $gte: ["$createdAt", todayStart] },
                { $multiply: ["$fare", { $ifNull: ["$count", 1] }] },
                0
              ]
            }
          },
          todayPassengers: {
            $sum: {
              $cond: [
                { $gte: ["$createdAt", todayStart] },
                { $ifNull: ["$count", 1] },
                0
              ]
            }
          }
        }
      }
    ]);

    // Optimize: Pre-calculate bus expenses using a single aggregate query on BusExpense
    const expenseStats = await BusExpense.aggregate([
      {
        $match: {
          bus: { $in: busIds }
        }
      },
      {
        $group: {
          _id: "$bus",
          totalExpenses: { $sum: "$amount" }
        }
      }
    ]);

    const busStatsMap = {};
    busStats.forEach(stat => {
      if (stat._id) {
        busStatsMap[stat._id.toString()] = stat;
      }
    });

    const expenseStatsMap = {};
    expenseStats.forEach(stat => {
      if (stat._id) {
        expenseStatsMap[stat._id.toString()] = stat;
      }
    });
    
    const busAnalytics = buses.map(bus => {
      const stats = busStatsMap[bus._id.toString()] || {
        totalRevenue: 0,
        totalPassengers: 0,
        todayRevenue: 0,
        todayPassengers: 0
      };
      const expense = expenseStatsMap[bus._id.toString()] || {
        totalExpenses: 0
      };
      const totalExpenses = expense.totalExpenses;
      const netProfit = stats.totalRevenue - totalExpenses;
      
      return {
        busId: bus._id,
        busNumber: bus.registration,
        routeName: bus.route ? bus.route.name : null,
        totalTickets: stats.totalPassengers,
        registration: bus.registration,
        type: bus.type,
        capacity: bus.capacity,
        status: bus.status,
        route: bus.route ? {
          name: bus.route.name,
          code: bus.route.code
        } : null,
        totalRevenue: stats.totalRevenue,
        totalExpenses,
        netProfit,
        totalPassengers: stats.totalPassengers,
        todayRevenue: stats.todayRevenue,
        todayPassengers: stats.todayPassengers,
        avgRevenuePerPassenger: stats.totalPassengers > 0 ? stats.totalRevenue / stats.totalPassengers : 0,
        capacityUtilization: stats.totalPassengers > 0 ? ((stats.totalPassengers / bus.capacity) * 100).toFixed(1) : 0
      };
    });
    
    // Sort by total revenue descending
    busAnalytics.sort((a, b) => b.totalRevenue - a.totalRevenue);
    
    res.json({
      success: true,
      buses: busAnalytics
    });
  } catch (err) {
    console.error('[ERROR] Failed to fetch bus-wise analytics:', err);
    res.status(500).json({ 
      success: false,
      error: 'Failed to load bus analytics', 
      details: err.message 
    });
  }
});

// GET /api/owner/analytics/tickets
// All tickets for owned buses with filtering
router.get('/analytics/tickets', authenticate, requireActiveOwnerSubscription, async (req, res) => {
  try {
    const ownerId = req.user.id;
    const { status, busId, routeId, limit = 50 } = req.query;
    
    // Get owner's buses
    const buses = await Bus.find({ owner: ownerId }).select('_id').lean();
    const busIds = buses.map(b => b._id);
    
    if (busIds.length === 0) {
      return res.json({
        success: true,
        tickets: [],
        total: 0
      });
    }
    
    // Build query
    let query = { bus: { $in: busIds } };
    
    if (status) {
      query.status = status;
    }
    if (busId) {
      // Keep bus filter constrained to owner's buses.
      query.bus = { $in: busIds.filter(id => id.toString() === busId.toString()) };
    }
    if (routeId) {
      query.route = routeId;
    }
    
    // Get tickets with passenger info
    const tickets = await Ticket.find(query)
      .populate('user', 'name phone')
      .populate('bus', 'registration')
      .populate('route', 'name code')
      .populate('from_stop', 'name')
      .populate('to_stop', 'name')
      .sort({ createdAt: -1 })
      .limit(parseInt(limit))
      .lean();
    
    const total = await Ticket.countDocuments(query);
    
    const formattedTickets = tickets.map(t => {
      const passengerName = t.user ? t.user.name : null;
      const passengerPhone = t.user ? t.user.phone : null;
      const busNumber = t.bus ? t.bus.registration : null;
      const routeName = t.route ? t.route.name : null;

      return {
        id: t._id,
        _id: t._id,
        ticketId: t._id.toString(),
        passengerName,
        passengerPhone,
        busNumber,
        routeName,
        passenger: t.user ? {
          name: passengerName,
          phone: passengerPhone
        } : null,
        bus: busNumber,
        route: t.route ? {
          name: t.route.name,
          code: t.route.code
        } : null,
        from: t.from_stop ? t.from_stop.name : null,
        to: t.to_stop ? t.to_stop.name : null,
        fare: t.fare,
        count: t.count || 1,
        total_fare: (t.fare || 0) * (t.count || 1),
        status: t.status,
        qr_code: t.qr_code,
        createdAt: t.createdAt,
        validatedAt: t.boarded_at,
        expiresAt: t.expires_at
      };
    });
    
    res.json({
      success: true,
      tickets: formattedTickets,
      total
    });
  } catch (err) {
    console.error('[ERROR] Failed to fetch tickets:', err);
    res.status(500).json({ 
      success: false,
      error: 'Failed to load tickets', 
      details: err.message 
    });
  }
});

// ─── Owner: View expense details for a specific bus ──────────────────────────
// GET /api/owner/analytics/bus/:busId/expenses
// Returns all expense/invoice entries for a bus with proof URLs (for owner download).
router.get('/analytics/bus/:busId/expenses', authenticate, requireActiveOwnerSubscription, async (req, res) => {
  try {
    // Ensure the requesting owner actually owns this bus
    const bus = await Bus.findOne({ _id: req.params.busId, owner: req.user.id }).lean();
    if (!bus) {
      return res.status(403).json({ error: 'Bus not found or not owned by you' });
    }

    const entries = await BusExpense.find({ bus: req.params.busId })
      .populate('conductor', 'name phone')
      .sort('-date')
      .lean();

    const formatted = entries.map(e => ({
      id:               e._id,
      type:             e.type,
      amount:           e.amount,
      details:          e.details || '',
      date:             e.date,
      conductorName:    e.conductor?.name || 'Unknown',
      conductorPhone:   e.conductor?.phone || '',
      proofKey:          e.proofKey || null,
      proofOriginalName: e.proofOriginalName || null,
      proofMimeType:     e.proofMimeType || null,
    }));

    const totalExpenses = entries.reduce((s, e) => s + (e.amount || 0), 0);

    res.json({ success: true, busRegistration: bus.registration, totalExpenses, entries: formatted });
  } catch (err) {
    console.error('[Owner Expenses] GET error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── Owner: Get a temporary signed URL for a conductor's proof file ─────────────
// GET /api/owner/analytics/bus/:busId/expenses/:expenseId/proof-url
router.get('/analytics/bus/:busId/expenses/:expenseId/proof-url', authenticate, requireActiveOwnerSubscription, async (req, res) => {
  try {
    const bus = await Bus.findOne({ _id: req.params.busId, owner: req.user.id }).lean();
    if (!bus) return res.status(403).json({ error: 'Bus not found or not owned by you' });

    const entry = await BusExpense.findOne({
      _id: req.params.expenseId,
      bus: req.params.busId,
    }).lean();
    if (!entry)          return res.status(404).json({ error: 'Expense entry not found' });
    if (!entry.proofKey) return res.status(404).json({ error: 'No proof file attached to this entry' });

    const signedUrl = await getSignedProofUrl(entry.proofKey);
    res.json({ success: true, signedUrl, mimeType: entry.proofMimeType, originalName: entry.proofOriginalName });
  } catch (err) {
    console.error('[Owner Expenses] proof-url error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
