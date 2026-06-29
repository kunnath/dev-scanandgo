const express = require('express');
const User = require('../models/User');
const Bus = require('../models/Bus');
const Ticket = require('../models/Ticket');
const OwnerSubscriptionPayment = require('../models/OwnerSubscriptionPayment');
const Advertisement = require('../models/Advertisement');
const { authenticate, authorize } = require('../middleware/auth');

const router = express.Router();

// GET /api/admin/dashboard
// Minimal admin dashboard for billing and usage tracking.
router.get('/dashboard', authenticate, authorize('admin'), async (req, res) => {
  try {
    const now = new Date();
    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);

    const last30DaysStart = new Date(now);
    last30DaysStart.setDate(last30DaysStart.getDate() - 30);

    const [
      totalUsers,
      owners,
      conductors,
      passengers,
      admins,
      totalBuses,
      runningBuses,
      totalTickets,
      ticketsToday,
      activeOwnerSubscriptions,
      expiredOwnerSubscriptions,
      recentPayments,
      totalBillingAgg,
      billing30DaysAgg,
      paymentsTodayCount,
    ] = await Promise.all([
      User.countDocuments({}),
      User.countDocuments({ role: 'owner' }),
      User.countDocuments({ role: 'conductor' }),
      User.countDocuments({ role: 'passenger' }),
      User.countDocuments({ role: 'admin' }),
      Bus.countDocuments({}),
      Bus.countDocuments({ status: 'running' }),
      Ticket.countDocuments({}),
      Ticket.countDocuments({ createdAt: { $gte: todayStart } }),
      User.countDocuments({ role: 'owner', subscriptionStatus: 'active', subscriptionEndAt: { $gt: now } }),
      User.countDocuments({ role: 'owner', $or: [
        { subscriptionStatus: 'expired' },
        { subscriptionEndAt: { $lte: now } },
      ] }),
      OwnerSubscriptionPayment.find({ status: 'success' })
        .sort({ paidAt: -1 })
        .limit(10)
        .populate('owner', 'name phone email')
        .select('owner plan amount currency provider paidAt paymentId orderId'),
      OwnerSubscriptionPayment.aggregate([
        { $match: { status: 'success' } },
        { $group: { _id: null, total: { $sum: '$amount' } } },
      ]),
      OwnerSubscriptionPayment.aggregate([
        { $match: { status: 'success', paidAt: { $gte: last30DaysStart } } },
        { $group: { _id: null, total: { $sum: '$amount' } } },
      ]),
      OwnerSubscriptionPayment.countDocuments({ status: 'success', paidAt: { $gte: todayStart } }),
    ]);

    const totalBilling = totalBillingAgg?.[0]?.total || 0;
    const billingLast30Days = billing30DaysAgg?.[0]?.total || 0;

    return res.json({
      success: true,
      generatedAt: now,
      billing: {
        totalCollected: totalBilling,
        collectedLast30Days: billingLast30Days,
        paymentsToday: paymentsTodayCount,
        recentPayments,
      },
      usage: {
        users: {
          total: totalUsers,
          owners,
          conductors,
          passengers,
          admins,
        },
        buses: {
          total: totalBuses,
          running: runningBuses,
        },
        tickets: {
          total: totalTickets,
          today: ticketsToday,
        },
        ownerSubscriptions: {
          active: activeOwnerSubscriptions,
          expired: expiredOwnerSubscriptions,
        },
      },
    });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to load admin dashboard data' });
  }
});

// ── Advertisement routes ─────────────────────────────────────────────────────

// GET /api/admin/ads  — public, used by profile page to display active ads
router.get('/ads', async (req, res) => {
  try {
    const ads = await Advertisement.find({ isActive: true }).sort({ createdAt: -1 }).lean();
    res.json({ success: true, ads });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load advertisements' });
  }
});

// POST /api/admin/ads  — admin only
router.post('/ads', authenticate, authorize('admin'), async (req, res) => {
  try {
    const { title, description, url, imageUrl } = req.body;
    if (!title || !description) return res.status(400).json({ error: 'title and description are required' });
    const ad = await Advertisement.create({
      title,
      description,
      url: url || '',
      imageUrl: imageUrl || '',
      createdBy: req.user._id,
    });
    res.json({ success: true, ad });
  } catch (err) {
    res.status(500).json({ error: 'Failed to create advertisement' });
  }
});

// PUT /api/admin/ads/:id/toggle  — admin only
router.put('/ads/:id/toggle', authenticate, authorize('admin'), async (req, res) => {
  try {
    const ad = await Advertisement.findById(req.params.id);
    if (!ad) return res.status(404).json({ error: 'Advertisement not found' });
    ad.isActive = !ad.isActive;
    await ad.save();
    res.json({ success: true, isActive: ad.isActive });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update advertisement' });
  }
});

// DELETE /api/admin/ads/:id  — admin only
router.delete('/ads/:id', authenticate, authorize('admin'), async (req, res) => {
  try {
    await Advertisement.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete advertisement' });
  }
});

module.exports = router;
