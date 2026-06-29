const express = require('express');
const QRCode = require('qrcode');
const Ticket = require('../models/Ticket');
const Route = require('../models/Route');
const User = require('../models/User');
const Stop = require('../models/Stop');
const WalletTransaction = require('../models/WalletTransaction');
const config = require('../config');
const { authenticate, authorize } = require('../middleware/auth');

const router = express.Router();

// ─── Book a ticket ──────────────────────────────────────────────────────────
router.post('/book', authenticate, async (req, res) => {
  try {
    const { bus_id, route_id, from_stop_id, to_stop_id, ticket_count } = req.body;
    if (!bus_id || !route_id || !from_stop_id || !to_stop_id) {
      return res.status(400).json({ error: 'bus_id, route_id, from_stop_id and to_stop_id are required' });
    }
    const parsedCount = parseInt(ticket_count, 10);
    const count = isNaN(parsedCount) ? 1 : Math.max(1, parsedCount);

    const route = await Route.findById(route_id);
    if (!route) return res.status(404).json({ error: 'Route not found' });

    const fromEntry = route.stops.find(s => s.stop.toString() === from_stop_id);
    const toEntry = route.stops.find(s => s.stop.toString() === to_stop_id);

    if (!fromEntry || !toEntry) {
      return res.status(400).json({ error: 'Invalid stops for this route' });
    }

    if (from_stop_id === to_stop_id) {
      return res.status(400).json({ error: 'Destination stop cannot be the same as boarding stop' });
    }

    if (toEntry.distance_from_start_km <= fromEntry.distance_from_start_km) {
      return res.status(400).json({ error: 'Destination stop must be after boarding stop' });
    }

    const distance = toEntry.distance_from_start_km - fromEntry.distance_from_start_km;
    const farePerTicket = Math.max(route.base_fare, Math.round(distance * route.per_km_fare * 100) / 100);
    const totalFare = farePerTicket * count;

    const user = await User.findById(req.user.id);
    let payer = user;
    let paymentDesc = `Ticket booked (held until validated) x${count}`;
    let paymentMethod = 'wallet';

    if (req.body.poyaloo_card_number) {
      const cardNum = req.body.poyaloo_card_number.replace(/\s+/g, '');
      const cardUser = await User.findOne({ poyalooPassCardNumber: cardNum });
      if (!cardUser) {
        return res.status(400).json({ error: 'Invalid Poyaloo Pass card number' });
      }
      if (!cardUser.poyalooPassActive) {
        return res.status(400).json({ error: 'Poyaloo Pass associated with this card number is not active' });
      }
      if (cardUser.poyalooPassCardBlocked) {
        return res.status(403).json({ error: 'This Poyaloo Pass card is blocked by the card owner. Only wallet payment is allowed.' });
      }
      payer = cardUser;
      paymentDesc = `Ticket booked via Poyaloo Pass #${cardNum} (held until validated) x${count}`;
      paymentMethod = 'poyaloo_pass';
    }

    const expiresAt = new Date(Date.now() + config.qrTicketExpiryMinutes * 60 * 1000);

    // Deduct wallet atomically (HOLD — not settled until conductor validates)
    const updatedUser = await User.findOneAndUpdate(
      { _id: payer._id, wallet: { $gte: totalFare } },
      { $inc: { wallet: -totalFare } },
      { new: true }
    );
    if (!updatedUser) {
      return res.status(402).json({ error: `Insufficient balance. Total Fare: ₹${totalFare}, Payer Balance: ₹${payer.wallet}` });
    }
    payer = updatedUser;

    // Create ticket
    const ticket = await Ticket.create({
      user: req.user.id,
      bus: bus_id,
      route: route_id,
      from_stop: from_stop_id,
      to_stop: to_stop_id,
      fare: farePerTicket,
      total_fare: totalFare,
      count,
      payment_status: 'held',   // Money held until conductor validates
      expires_at: expiresAt,
    });

    // QR data
    const qrData = JSON.stringify({
      ticketId: ticket._id,
      userId: req.user.id,
      busId: bus_id,
      routeId: route_id,
      from: from_stop_id,
      to: to_stop_id,
      fare: farePerTicket,
      count,
      totalFare,
      expires: expiresAt.toISOString(),
    });

    ticket.qr_code = qrData;
    await ticket.save();

    // Record wallet debit with settlement pending
    await WalletTransaction.create({
      user: payer._id,
      type: 'debit',
      amount: totalFare,
      balance_after: payer.wallet,
      description: paymentDesc,
      payment_method: paymentMethod,
      payment_status: 'success',
      ticket_id: ticket._id,
      settlement_status: 'pending',
    });

    const qrImage = await QRCode.toDataURL(qrData, { width: 300, margin: 2 });

    const fromStop = await Stop.findById(from_stop_id);
    const toStop = await Stop.findById(to_stop_id);

    res.status(201).json({
      message: 'Ticket booked successfully',
      ticket: {
        id: ticket._id,
        from: fromStop?.name,
        to: toStop?.name,
        route: route.name,
        fare: farePerTicket,
        count,
        total_fare: totalFare,
        status: 'active',
        payment_status: 'held',
        expires_at: expiresAt.toISOString(),
        qr_image: qrImage,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Validate QR ticket (conductor scans) — SETTLES PAYMENT TO CONDUCTOR ───

// Step 1: Validate ticket and return details (no auto-approval)
router.post('/validate', authenticate, authorize('conductor', 'admin'), async (req, res) => {
  try {
    const { qr_data } = req.body;
    if (!qr_data) return res.status(400).json({ error: 'qr_data required' });

    let parsed;
    try {
      parsed = JSON.parse(qr_data);
    } catch {
      const cleanData = qr_data.trim().replace(/\s+/g, '');
      if (cleanData.length === 11 && !isNaN(cleanData)) {
        parsed = { type: 'poyaloo_pass', cardNumber: cleanData };
      } else {
        return res.status(400).json({ valid: false, error: 'Invalid QR data' });
      }
    }

    if (parsed.type === 'poyaloo_pass') {
      const passUser = await User.findOne({ poyalooPassCardNumber: parsed.cardNumber });
      if (!passUser) {
        return res.status(404).json({ valid: false, error: 'Poyaloo Pass not found' });
      }
      if (!passUser.poyalooPassActive) {
        return res.status(400).json({ valid: false, error: 'Poyaloo Pass is not active' });
      }
      if (passUser.poyalooPassCardBlocked) {
        return res.json({
          valid: false,
          isPoyalooPass: true,
          cardBlocked: true,
          error: 'This Poyaloo Pass card has been blocked by the owner',
          pass: {
            passenger: passUser.name,
            cardNumber: passUser.poyalooPassCardNumber,
          }
        });
      }
      const { getSignedProofUrl } = require('../services/r2Upload');
      let signedPhotoUrl = passUser.poyalooPassPhotoUrl;
      if (passUser.poyalooPassPhotoKey) {
        try {
          signedPhotoUrl = await getSignedProofUrl(passUser.poyalooPassPhotoKey);
        } catch (signedErr) {
          console.error('Error signing validator photo URL:', signedErr);
        }
      }

      return res.json({
        valid: true,
        isPoyalooPass: true,
        pass: {
          userId: passUser._id,
          cardNumber: passUser.poyalooPassCardNumber,
          passenger: passUser.name,
          phone: passUser.hidePhoneFromConductor ? undefined : passUser.phone,
          email: passUser.email,
          ticketCategory: passUser.ticketCategory,
          photoUrl: signedPhotoUrl,
          wallet: passUser.wallet,
        }
      });
    }

    const ticket = await Ticket.findById(parsed.ticketId)
      .populate('user', 'name phone email hidePhoneFromConductor ticketCategory')
      .populate('from_stop', 'name')
      .populate('to_stop', 'name');
    if (!ticket) {
      return res.status(404).json({ valid: false, error: 'Ticket not found' });
    }

    if (new Date(ticket.expires_at) < new Date()) {
      ticket.status = 'expired';
      await ticket.save();
      return res.json({ valid: false, error: 'Ticket has expired' });
    }

    if (ticket.status !== 'active') {
      return res.json({ valid: false, error: `Ticket is ${ticket.status}` });
    }

    // --- Route Verification Check ---
    const conductor = await User.findById(req.user.id);
    if (conductor.role === 'conductor') {
      if (!conductor.assignedRoute) {
        return res.status(400).json({ valid: false, error: 'You are not assigned to any route. Please update your assignment in your Profile first.' });
      }
      if (ticket.route.toString() !== conductor.assignedRoute.toString()) {
        return res.status(400).json({ valid: false, error: 'This ticket was booked for a different route and cannot be validated on this route.' });
      }
    }

    const user = ticket.user;
    const fromStop = ticket.from_stop;
    const toStop = ticket.to_stop;

    let phoneToShow = user?.phone;
    if (user?.hidePhoneFromConductor) phoneToShow = undefined;

    res.json({
      valid: true,
      ticket: {
        id: ticket._id,
        passenger: user?.name,
        phone: phoneToShow,
        email: user?.email || null,
        ticketCategory: user?.ticketCategory || 'adult',
        from: fromStop?.name,
        to: toStop?.name,
        fare: ticket.fare,
        count: ticket.count || 1,
        status: ticket.status,
        payment_status: ticket.payment_status,
        expires_at: ticket.expires_at,
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Step 2: Conductor approves or rejects the ticket
router.post('/:id/decision', authenticate, authorize('conductor', 'admin'), async (req, res) => {
  try {
    const { decision, reason } = req.body; // decision: 'approve' or 'reject'
    const ticket = await Ticket.findById(req.params.id);
    if (!ticket) return res.status(404).json({ error: 'Ticket not found' });
    if (ticket.status !== 'active') return res.status(400).json({ error: `Ticket is ${ticket.status}` });

    // --- Route Verification Check ---
    const conductor = await User.findById(req.user.id);
    if (conductor.role === 'conductor') {
      if (!conductor.assignedRoute) {
        return res.status(400).json({ error: 'You are not assigned to any route.' });
      }
      if (ticket.route.toString() !== conductor.assignedRoute.toString()) {
        return res.status(400).json({ error: 'This ticket was booked for a different route and cannot be validated on this route.' });
      }
    }

    const now = new Date();

    if (decision === 'approve') {
      ticket.validated = true;
      ticket.validated_by = conductor._id;
      ticket.boarded_at = now;
      ticket.status = 'used';
      // Settle payment to conductor
      if (ticket.payment_status === 'held') {
        ticket.payment_status = 'settled';
        ticket.settled_to_conductor = conductor._id;
        ticket.settled_at = now;
        // Update conductor earnings
        const settlementAmount = ticket.total_fare || (ticket.fare * (ticket.count || 1));
        const today = now.toISOString().split('T')[0];
        if (conductor.lastEarningDate !== today) {
          conductor.todayEarnings = 0;
          conductor.lastEarningDate = today;
        }
        conductor.totalEarnings = (conductor.totalEarnings || 0) + settlementAmount;
        conductor.todayEarnings = (conductor.todayEarnings || 0) + settlementAmount;
        await conductor.save();
        // Record settlement transaction (conductor side)
        const fromStop = await Stop.findById(ticket.from_stop).select('name');
        const toStop = await Stop.findById(ticket.to_stop).select('name');
        const passenger = await User.findById(ticket.user).select('name phone');
        await WalletTransaction.create({
          user: conductor._id,
          type: 'settlement',
          amount: settlementAmount,
          balance_after: conductor.wallet,
          description: `${fromStop?.name || '?'} → ${toStop?.name || '?'} (${passenger?.name || 'Passenger'})`,
          payment_method: 'upi',
          payment_id: `SETTLE-${ticket._id}`,
          payment_status: 'success',
          ticket_id: ticket._id,
          conductor_id: conductor._id,
          settlement_status: 'settled',
          settled_at: now,
        });
        // Update passenger's original debit transaction to settled
        await WalletTransaction.findOneAndUpdate(
          { ticket_id: ticket._id, user: ticket.user, type: 'debit' },
          { settlement_status: 'settled', conductor_id: conductor._id, settled_at: now }
        );
      }
      await ticket.save();
      return res.json({ approved: true, message: 'Ticket approved and settled.' });
    } else if (decision === 'reject') {
      ticket.status = 'rejected';
      ticket.validated = false;
      ticket.validated_by = conductor._id;
      ticket.boarded_at = null;
      ticket.alighted_at = null;
      ticket.rejection_reason = reason || 'Rejected by conductor';
      // Refund if payment was held
      if (ticket.payment_status === 'held') {
        ticket.payment_status = 'refunded';
        ticket.refunded_at = now;
        // Refund to passenger wallet
        const refundAmount = ticket.total_fare || (ticket.fare * (ticket.count || 1));
        await User.findByIdAndUpdate(
          ticket.user,
          { $inc: { wallet: refundAmount } }
        );
        // Update wallet transaction
        await WalletTransaction.findOneAndUpdate(
          { ticket_id: ticket._id, user: ticket.user, type: 'debit' },
          { settlement_status: 'refunded', refunded_at: now }
        );
      }
      await ticket.save();
      return res.json({ approved: false, message: 'Ticket rejected and refunded.' });
    } else {
      return res.status(400).json({ error: 'Invalid decision' });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Auto-refund expired held tickets ───────────────────────────────────────
router.post('/refund-expired', authenticate, authorize('admin'), async (req, res) => {
  try {
    const expired = await Ticket.find({
      status: 'active',
      payment_status: 'held',
      expires_at: { $lt: new Date() }
    });

    let refundCount = 0;
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
      refundCount++;
    }

    res.json({ refunded: refundCount });
  } catch (err) {
    res.status(500).json({ error: 'Refund process failed' });
  }
});

// ─── My tickets ─────────────────────────────────────────────────────────────
router.get('/my', authenticate, async (req, res) => {
  const tickets = await Ticket.find({ user: req.user.id })
    .populate('route', 'name code')
    .populate('from_stop', 'name')
    .populate('to_stop', 'name')
    .populate('bus', 'registration')
    .populate('settled_to_conductor', 'name conductorUpiId')
    .sort('-createdAt')
    .limit(50)
    .lean();

  res.json(tickets.map(t => ({
    ...t, id: t._id,
    route_name: t.route?.name,
    route_code: t.route?.code,
    from_stop_name: t.from_stop?.name,
    to_stop_name: t.to_stop?.name,
    bus_registration: t.bus?.registration,
    payment_status: t.payment_status || 'held',
    settled_to: t.settled_to_conductor ? {
      name: t.settled_to_conductor.name,
      upiId: t.settled_to_conductor.conductorUpiId,
    } : null,
    created_at: t.createdAt,
    count: t.count || 1,
    total_fare: (t.count && t.fare) ? t.count * t.fare : t.fare,
  })));
});

// ─── Get ticket QR code ─────────────────────────────────────────────────────
router.get('/:id/qr', authenticate, async (req, res) => {
  const ticket = await Ticket.findOne({ _id: req.params.id, user: req.user.id })
    .populate('route', 'name code')
    .populate('from_stop', 'name')
    .populate('to_stop', 'name')
    .populate('bus', 'registration');
  if (!ticket) return res.status(404).json({ error: 'Ticket not found' });

  const qrImage = await QRCode.toDataURL(ticket.qr_code, { width: 300, margin: 2 });
  res.json({
    qr_image: qrImage,
    status: ticket.status,
    expires_at: ticket.expires_at,
    route: ticket.route?.name,
    route_code: ticket.route?.code,
    from: ticket.from_stop?.name,
    to: ticket.to_stop?.name,
    fare: ticket.fare,
    count: ticket.count || 1,
    total_fare: (ticket.count && ticket.fare) ? ticket.count * ticket.fare : ticket.fare,
    bus_registration: ticket.bus?.registration,
    payment_status: ticket.payment_status,
    created_at: ticket.createdAt,
  });
});

// ─── Conductor: all validated tickets for today ─────────────────────────────
router.get('/conductor/validated', authenticate, authorize('conductor', 'admin'), async (req, res) => {
  try {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const ticketQuery = {
      validated: true,
      validated_by: req.user.id,
      boarded_at: { $gte: since },
    };

    if (req.user.role === 'conductor') {
      ticketQuery.validated_by = req.user.id;
    }

    const tickets = await Ticket.find(ticketQuery)
      .populate('user', 'name phone email hidePhoneFromConductor ticketCategory')
      .populate('route', 'name code')
      .populate('from_stop', 'name')
      .populate('to_stop', 'name')
      .populate('bus', 'registration')
      .sort('-boarded_at')
      .lean();

    const now = new Date();
    const result = tickets.map(t => {
      const expiresAt = new Date(t.expires_at);
      const isExpired = now > expiresAt;
      const boardedAt = new Date(t.boarded_at);
      const travelTimeMinutes = Math.round(((now - boardedAt) * 4) / (1000 * 60));
      const allowedMinutes = Math.round((expiresAt - boardedAt) / (1000 * 60));
      const overtimeMinutes = isExpired ? Math.round((now - expiresAt) / (1000 * 60)) : 0;

      // Hide phone if privacy enabled
      let phoneToShow = t.user?.phone || '-';
      if (t.user?.hidePhoneFromConductor) phoneToShow = undefined;

      const count = t.count || 1;
      const totalFare = (t.fare || 0) * count;

      return {
        id: t._id,
        passenger: t.user?.name || 'Unknown',
        phone: phoneToShow,
        email: t.user?.email || null,
        ticketCategory: t.user?.ticketCategory || 'adult',
        route_name: t.route?.name || '-',
        route_code: t.route?.code || '-',
        from_stop: t.from_stop?.name || '-',
        to_stop: t.to_stop?.name || '-',
        bus_reg: t.bus?.registration || '-',
        fare: t.fare,
        count,
        total_fare: totalFare,
        status: t.status,
        payment_status: t.payment_status || 'settled',
        boarded_at: t.boarded_at,
        expires_at: t.expires_at,
        travelTimeMinutes,
        allowedMinutes,
        isExpired,
        overtimeMinutes,
        flag: isExpired ? '🔴 OVERTIME' : '🟢 Valid',
      };
    });

    const validatedCount = result.reduce((sum, t) => sum + (t.count || 1), 0);
    const overtimeCount = result.reduce((sum, t) => sum + (t.isExpired ? (t.count || 1) : 0), 0);
    const todayTicketEarnings = result.reduce((sum, t) => sum + (t.total_fare || 0), 0);

    res.json({
      count: validatedCount,
      overtimeCount,
      todayTicketEarnings,
      tickets: result,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Passenger membership: count distinct travel days this month ─────────────
router.get('/monthly-travel-days', authenticate, async (req, res) => {
  try {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

    const tickets = await Ticket.find({
      user: req.user.id,
      createdAt: { $gte: startOfMonth, $lte: endOfMonth },
    }).select('createdAt').lean();

    const uniqueDays = new Set(
      tickets.map(t => new Date(t.createdAt).toISOString().slice(0, 10))
    );

    res.json({ travelDaysThisMonth: uniqueDays.size });
  } catch (err) {
    res.status(500).json({ error: 'Could not load travel stats' });
  }
});

module.exports = router;
