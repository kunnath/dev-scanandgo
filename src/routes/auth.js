const express = require('express');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const { Resend } = require('resend');
const User = require('../models/User');
const OwnerSubscriptionPayment = require('../models/OwnerSubscriptionPayment');
const Bus = require('../models/Bus');
const Route = require('../models/Route');
const config = require('../config');
const { authenticate, authorize } = require('../middleware/auth');
const { authRateLimiter } = require('../middleware/rateLimiter');
const multer = require('multer');
const { uploadToR2, getSignedProofUrl, ALLOWED_TYPES } = require('../services/r2Upload');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB max
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_TYPES[file.mimetype]) return cb(null, true);
    cb(new Error('Only PNG, JPEG and PDF files are allowed'));
  },
});

const router = express.Router();
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

// Password strength: min 8 chars, 1 uppercase, 1 number, 1 special char
const PASSWORD_REGEX = /^(?=.*[A-Z])(?=.*[0-9])(?=.*[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]).{8,}$/;

async function sendEmailViaResend(to, subject, html) {
  try {
    const apiKey = config.resendApiKey || process.env.RESEND_API_KEY || process.env.resend_api_key;
    if (!apiKey) {
      console.error('❌ Resend API key not found in config or env. Config key:', config.resendApiKey);
      throw new Error('Resend API key not configured. Please set resend_api_key in environment variables.');
    }
    
    const resend = new Resend(apiKey);
    const fromEmail = config.emailFrom || process.env.EMAIL_FROM || 'noreply@scanandgo.com';
    
    console.log('📧 Sending email via Resend to:', to, 'from:', fromEmail);
    
    const result = await resend.emails.send({
      from: fromEmail,
      to: to,
      subject: subject,
      html: html,
    });
    
    if (result.error) {
      console.error('❌ Resend API error:', result.error);
      throw new Error(result.error.message);
    }
    
    console.log('✅ Email sent successfully. ID:', result.id);
    return result;
  } catch (err) {
    console.error('❌ Resend email error:', err.message, err);
    throw err;
  }
}

function computeSubscriptionEnd(startDate, plan) {
  const end = new Date(startDate);
  if (plan === 'yearly') {
    end.setFullYear(end.getFullYear() + 1);
  } else if (plan === 'thirty_days') {
    end.setDate(end.getDate() + 30);
  } else {
    end.setMonth(end.getMonth() + 1);
  }
  return end;
}

function getPlanAmount(plan) {
  if (plan === 'yearly') return Number(config.ownerSubscriptionYearlyAmount || 0);
  if (plan === 'thirty_days') {
    const amt = config.ownerSubscriptionThirtyDaysAmount;
    if (amt === 'free' || !amt) return 0;
    const num = Number(amt);
    return isNaN(num) ? 0 : num;
  }
  return Number(config.ownerSubscriptionMonthlyAmount || 0);
}

function getRazorpay() {
  const keyId = String(config.razorpayKeyId || '').trim();
  const keySecret = String(config.razorpayKeySecret || '').trim();
  const isDummy = keyId === 'PLACEHOLDER' || keySecret === 'PLACEHOLDER'
    || keyId.startsWith('DEV_DUMMY') || keySecret.startsWith('DEV_DUMMY');
  if (!keyId || !keySecret || isDummy) return null;
  const Razorpay = require('razorpay');
  return new Razorpay({
    key_id: keyId,
    key_secret: keySecret,
  });
}

function getOwnerSubscriptionState(user) {
  if (!user || user.role !== 'owner') return null;

  const now = new Date();
  const endAt = user.subscriptionEndAt ? new Date(user.subscriptionEndAt) : null;
  const msLeft = endAt ? endAt.getTime() - now.getTime() : 0;
  const daysLeft = endAt ? Math.max(0, Math.ceil(msLeft / ONE_DAY_MS)) : 0;
  const isActive = user.subscriptionStatus === 'active' && endAt && msLeft > 0;
  const shouldNotify = isActive && msLeft <= ONE_DAY_MS;

  return {
    plan: user.subscriptionPlan || null,
    status: isActive ? 'active' : 'expired',
    startAt: user.subscriptionStartAt || null,
    endAt: user.subscriptionEndAt || null,
    daysLeft,
    canAccessOwnerFeatures: !!isActive,
    receiverUpiId: config.ownerSubscriptionReceiverUpi,
    pricing: {
      thirty_days: Number(config.ownerSubscriptionThirtyDaysAmount || 0),
      monthly: Number(config.ownerSubscriptionMonthlyAmount || 0),
      yearly: Number(config.ownerSubscriptionYearlyAmount || 0),
    },
    renewalReminder: {
      shouldNotify,
      message: shouldNotify
        ? 'Your owner subscription expires in less than 1 day. Renew now to keep dashboard and assignment features active.'
        : '',
    },
    paymentSummary: {
      totalPaid: Number(user.subscriptionTotalPaid || 0),
      lastPaidAmount: Number(user.subscriptionLastPaidAmount || 0),
      lastPaidAt: user.subscriptionLastPaidAt || null,
      lastPaymentProvider: user.subscriptionLastPaymentProvider || null,
      lastPaymentId: user.subscriptionLastPaymentId || null,
    },
    thirtyDayPlanEverActivated: !!user.thirtyDayPlanEverActivated,
  };
}

// ─── Register ───────────────────────────────────────────────────────────────
router.post('/register', authRateLimiter, upload.single('passDocument'), async (req, res) => {
  try {
    const { name, phone, email, password, role, assignedRoute, assignedBus, conductorUpiId, conductorUpiName, subscriptionPlan, ticketCategory } = req.body;
    if (!name || !phone || !password) {
      return res.status(400).json({ error: 'name, phone and password are required' });
    }

    const existing = await User.findOne({ phone });
    if (existing) {
      return res.status(409).json({ error: 'Phone number already registered' });
    }

    const userRole = ['passenger', 'conductor', 'owner', 'admin'].includes(role) ? role : 'passenger';
    
    let validTicketCategory = ticketCategory || 'adult';
    if (!['adult', 'student', 'free'].includes(validTicketCategory)) {
      validTicketCategory = 'adult';
    }

    if (userRole === 'passenger' && ['student', 'free'].includes(validTicketCategory)) {
      if (!req.file) {
        return res.status(400).json({ error: `A pass document is mandatory for ${validTicketCategory} category.` });
      }
    }

    let studentPassUrl = null;
    let studentPassKey = null;
    if (req.file) {
      const r2 = await uploadToR2(
        req.file.buffer,
        req.file.mimetype,
        req.file.originalname,
        `passes/${phone}`
      );
      studentPassUrl = r2.publicUrl;
      studentPassKey = r2.key;
    }

    const userData = { name, phone, email: email || null, password, role: userRole, ticketCategory: validTicketCategory, studentPassUrl, studentPassKey };

    if (userRole === 'owner') {
      if (!['thirty_days', 'monthly', 'yearly'].includes(subscriptionPlan)) {
        return res.status(400).json({ error: 'Owner registration requires a valid subscriptionPlan (thirty_days/monthly/yearly)' });
      }

      if (subscriptionPlan === 'thirty_days') {
        // Check by phone (catches returning owners re-registering)
        const phoneUsed = await User.findOne({ phone, thirtyDayPlanEverActivated: true });
        if (phoneUsed) {
          return res.status(400).json({ error: 'The 30-day plan can only be used once per phone number.' });
        }
        // Check by email if provided
        if (email) {
          const emailUsed = await User.findOne({ email: email.toLowerCase().trim(), thirtyDayPlanEverActivated: true });
          if (emailUsed) {
            return res.status(400).json({ error: 'The 30-day plan can only be used once per email address.' });
          }
        }
      }

      const startAt = new Date();
      userData.subscriptionPlan = subscriptionPlan;
      userData.subscriptionStatus = 'active';
      userData.subscriptionStartAt = startAt;
      userData.subscriptionEndAt = computeSubscriptionEnd(startAt, subscriptionPlan);
      userData.subscriptionReminderSentAt = null;
      if (subscriptionPlan === 'thirty_days') userData.thirtyDayPlanEverActivated = true;
    }

    // If conductor, store route & bus assignment + UPI details (all optional)
    if (userRole === 'conductor') {
      if (req.body.zone) userData.zone = req.body.zone;
      if (assignedRoute) userData.assignedRoute = assignedRoute;
      if (assignedBus) userData.assignedBus = assignedBus;
      if (conductorUpiId) userData.conductorUpiId = conductorUpiId;
      userData.conductorUpiName = conductorUpiName || name;
    }

    const user = await User.create(userData);

    // Link conductor to bus: allow multiple conductors per bus
    if (userRole === 'conductor' && assignedBus) {
      const bus = await Bus.findById(assignedBus);
      if (!bus) {
        return res.status(400).json({ error: 'Selected bus does not exist' });
      }
      // Optionally, assign route if not set
      if (assignedRoute && (!bus.route || bus.route.toString() !== assignedRoute)) {
        bus.route = assignedRoute;
      }
      // Add conductor if not already present
      if (!bus.conductors.map(id => id.toString()).includes(user._id.toString())) {
        bus.conductors.push(user._id);
      }
      await bus.save();
    }

    const token = jwt.sign(
      { id: user._id, name: user.name, phone: user.phone, role: user.role },
      config.jwtSecret,
      { expiresIn: '7d' },
    );

    let photoUrl = user.poyalooPassPhotoUrl || null;
    if (user.poyalooPassPhotoKey) {
      photoUrl = await getSignedProofUrl(user.poyalooPassPhotoKey);
    }

    res.status(201).json({
      message: 'Registration successful',
      token,
      user: {
        id: user._id, name: user.name, phone: user.phone, email: user.email, ticketCategory: user.ticketCategory || 'adult',
        role: user.role, wallet: user.wallet,
        assignedRoute: user.assignedRoute, assignedBus: user.assignedBus,
        conductorUpiId: user.conductorUpiId || '',
        conductorUpiName: user.conductorUpiName || '',
        totalEarnings: user.totalEarnings || 0,
        todayEarnings: user.todayEarnings || 0,
        ownerSubscription: getOwnerSubscriptionState(user),
        poyalooPassActive: user.poyalooPassActive || false,
        poyalooPassCardNumber: user.poyalooPassCardNumber || null,
        poyalooPassPhotoUrl: photoUrl,
        poyalooPassPhysicalCount: user.poyalooPassPhysicalCount || 0,
        poyalooPassPhysicalAddress: user.poyalooPassPhysicalAddress || '',
        poyalooPassCardBlocked: user.poyalooPassCardBlocked || false,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Login ────────────────────────────────────────────────────────────────
router.post('/login', authRateLimiter, async (req, res) => {
  try {
    const { phone, email, password } = req.body;
    if ((!phone && !email) || !password) {
      return res.status(400).json({ error: 'phone or email, and password are required' });
    }

    const query = phone ? { phone } : { email: email.toLowerCase().trim() };
    const user = await User.findOne(query);
    if (!user || !user.comparePassword(password)) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = jwt.sign(
      { id: user._id, name: user.name, phone: user.phone, role: user.role },
      config.jwtSecret,
      { expiresIn: '7d' },
    );

    let photoUrl = user.poyalooPassPhotoUrl || null;
    if (user.poyalooPassPhotoKey) {
      photoUrl = await getSignedProofUrl(user.poyalooPassPhotoKey);
    }

    res.json({
      token,
      user: {
        id: user._id, name: user.name, phone: user.phone, email: user.email, ticketCategory: user.ticketCategory || 'adult',
        role: user.role, wallet: user.wallet,
        conductorUpiId: user.conductorUpiId || '',
        conductorUpiName: user.conductorUpiName || '',
        totalEarnings: user.totalEarnings || 0,
        todayEarnings: user.todayEarnings || 0,
        ownerSubscription: getOwnerSubscriptionState(user),
        poyalooPassActive: user.poyalooPassActive || false,
        poyalooPassCardNumber: user.poyalooPassCardNumber || null,
        poyalooPassPhotoUrl: photoUrl,
        poyalooPassPhysicalCount: user.poyalooPassPhysicalCount || 0,
        poyalooPassPhysicalAddress: user.poyalooPassPhysicalAddress || '',
        poyalooPassCardBlocked: user.poyalooPassCardBlocked || false,
      },
    })  ;
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Profile ────────────────────────────────────────────────────────────
router.get('/me', authenticate, async (req, res) => {
  const user = await User.findById(req.user.id)
    .select('-password')
    .populate('assignedRoute', 'name code')
    .populate('assignedBus', 'registration');
  if (!user) return res.status(404).json({ error: 'User not found' });

  let shouldSave = false;

  if (user.role === 'owner') {
    const now = new Date();
    const hasExpired = user.subscriptionEndAt && new Date(user.subscriptionEndAt) <= now;
    if (hasExpired && user.subscriptionStatus !== 'expired') {
      user.subscriptionStatus = 'expired';
      shouldSave = true;
    }
  }

  // Reset today's earnings if date changed
  const today = new Date().toISOString().split('T')[0];
  if (user.lastEarningDate !== today && (user.role === 'conductor' || user.role === 'admin')) {
    user.todayEarnings = 0;
    user.lastEarningDate = today;
    shouldSave = true;
  }

  const ownerSubscription = getOwnerSubscriptionState(user);
  if (ownerSubscription?.renewalReminder?.shouldNotify) {
    const canResend = !user.subscriptionReminderSentAt
      || (new Date() - new Date(user.subscriptionReminderSentAt)) >= (20 * 60 * 60 * 1000);
    if (canResend) {
      user.subscriptionReminderSentAt = new Date();
      shouldSave = true;
    }
  }

  if (shouldSave) {
    await user.save();
  }

  let poyalooPassQrCode = null;
  if (user.poyalooPassActive && user.poyalooPassCardNumber) {
    const qrData = JSON.stringify({
      type: 'poyaloo_pass',
      cardNumber: user.poyalooPassCardNumber,
      userId: user._id
    });
    try {
      const QRCode = require('qrcode');
      poyalooPassQrCode = await QRCode.toDataURL(qrData, { width: 300, margin: 2 });
    } catch (e) {
      console.error('Error generating pass QR code', e);
    }
  }

  let photoUrl = user.poyalooPassPhotoUrl || null;
  if (user.poyalooPassPhotoKey) {
    photoUrl = await getSignedProofUrl(user.poyalooPassPhotoKey);
  }

  res.json({
    id: user._id, name: user.name, phone: user.phone, email: user.email,
    role: user.role, wallet: user.wallet, created_at: user.createdAt,
    assignedRoute: user.assignedRoute ? { id: user.assignedRoute._id, name: user.assignedRoute.name, code: user.assignedRoute.code } : null,
    assignedBus: user.assignedBus ? { id: user.assignedBus._id, registration: user.assignedBus.registration } : null,
    conductorUpiId: user.conductorUpiId || '',
    conductorUpiName: user.conductorUpiName || '',
    totalEarnings: user.totalEarnings || 0,
    todayEarnings: user.todayEarnings || 0,
    hidePhoneFromConductor: user.hidePhoneFromConductor || false,
    ticketCategory: user.ticketCategory || 'adult',
    studentPassUrl: user.studentPassUrl || null,
    ownerSubscription,
    poyalooPassActive: user.poyalooPassActive || false,
    poyalooPassCardNumber: user.poyalooPassCardNumber || null,
    poyalooPassPhotoUrl: photoUrl,
    poyalooPassPhysicalCount: user.poyalooPassPhysicalCount || 0,
    poyalooPassPhysicalAddress: user.poyalooPassPhysicalAddress || '',
    poyalooPassCardBlocked: user.poyalooPassCardBlocked || false,
    poyalooPassQrCode,
  });
});

// ─── Renew owner subscription ───────────────────────────────────────────────
router.post('/owner-subscription/renew', authenticate, authorize('owner'), async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user || user.role !== 'owner') {
      return res.status(404).json({ error: 'Owner not found' });
    }

    const plan = req.body?.subscriptionPlan || user.subscriptionPlan;
    if (!['thirty_days', 'monthly', 'yearly'].includes(plan)) {
      return res.status(400).json({ error: 'Valid subscriptionPlan is required (thirty_days/monthly/yearly)' });
    }

    if (plan === 'thirty_days' && user.thirtyDayPlanEverActivated) {
      return res.status(400).json({ error: 'The 30-day plan can only be used once. Please choose monthly or yearly.' });
    }

    const now = new Date();
    const startFrom = (user.subscriptionEndAt && new Date(user.subscriptionEndAt) > now)
      ? new Date(user.subscriptionEndAt)
      : now;

    user.subscriptionPlan = plan;
    user.subscriptionStatus = 'active';
    user.subscriptionStartAt = startFrom;
    user.subscriptionEndAt = computeSubscriptionEnd(startFrom, plan);
    user.subscriptionReminderSentAt = null;
    if (plan === 'thirty_days') user.thirtyDayPlanEverActivated = true;
    await user.save();

    return res.json({
      success: true,
      message: 'Owner subscription renewed successfully',
      ownerSubscription: getOwnerSubscriptionState(user),
    });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to renew owner subscription' });
  }
});

// ─── Create owner subscription payment order ──────────────────────────────
router.post('/owner-subscription/create-order', authenticate, authorize('owner'), async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user || user.role !== 'owner') {
      return res.status(404).json({ error: 'Owner not found' });
    }

    const plan = req.body?.subscriptionPlan;
    if (!['thirty_days', 'monthly', 'yearly'].includes(plan)) {
      return res.status(400).json({ error: 'Valid subscriptionPlan is required (thirty_days/monthly/yearly)' });
    }

    if (plan === 'thirty_days') {
      // Check flag first, then fall back to payment history for existing users whose flag wasn't set
      let usedThirtyDay = user.thirtyDayPlanEverActivated;
      if (!usedThirtyDay) {
        const pastPayment = await OwnerSubscriptionPayment.findOne({ owner: user._id, plan: 'thirty_days', status: 'success' });
        if (pastPayment) {
          user.thirtyDayPlanEverActivated = true;
          await user.save();
          usedThirtyDay = true;
        }
      }
      if (usedThirtyDay) {
        return res.status(400).json({ error: 'The 30-day plan is a one-time offer and has already been used on your account. Please choose the monthly or yearly plan to continue.' });
      }
    }

    const amount = getPlanAmount(plan);
    if (!amount || amount <= 0) {
      if (plan === 'thirty_days') {
        return res.status(400).json({ error: 'The 30-day plan is a one-time free trial. Please choose the monthly or yearly plan.' });
      }
      return res.status(400).json({ error: 'Invalid subscription amount configuration' });
    }

    const razorpay = getRazorpay();
    if (!razorpay) {
      return res.status(503).json({
        error: 'Payment gateway not configured',
        code: 'PAYMENT_GATEWAY_NOT_CONFIGURED',
        receiverUpiId: config.ownerSubscriptionReceiverUpi,
      });
    }

    const order = await razorpay.orders.create({
      amount: Math.round(amount * 100),
      currency: 'INR',
      receipt: `owner_sub_${user._id}_${Date.now()}`,
      notes: {
        user_id: String(user._id),
        purpose: 'owner_subscription',
        plan,
        receiver_upi: config.ownerSubscriptionReceiverUpi,
      },
    });

    user.ownerPendingSubscription = {
      orderId: order.id,
      plan,
      amount,
      createdAt: new Date(),
    };
    await user.save();

    return res.json({
      key: config.razorpayKeyId,
      order_id: order.id,
      amount: order.amount,
      currency: order.currency,
      subscriptionPlan: plan,
      amountInRupees: amount,
      receiverUpiId: config.ownerSubscriptionReceiverUpi,
    });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to create subscription payment order' });
  }
});

// ─── Verify owner subscription payment and activate ───────────────────────
router.post('/owner-subscription/verify-payment', authenticate, authorize('owner'), async (req, res) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body || {};
    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return res.status(400).json({ error: 'Missing payment verification fields' });
    }

    const user = await User.findById(req.user.id);
    if (!user || user.role !== 'owner') {
      return res.status(404).json({ error: 'Owner not found' });
    }

    const pending = user.ownerPendingSubscription || {};
    if (!pending.orderId || pending.orderId !== razorpay_order_id) {
      return res.status(400).json({ error: 'Subscription order mismatch' });
    }

    const expectedSignature = crypto
      .createHmac('sha256', config.razorpayKeySecret)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest('hex');

    if (expectedSignature !== razorpay_signature) {
      return res.status(400).json({ error: 'Payment verification failed' });
    }

    const plan = pending.plan;
    if (!['thirty_days', 'monthly', 'yearly'].includes(plan)) {
      return res.status(400).json({ error: 'Pending subscription plan is invalid' });
    }

    if (plan === 'thirty_days' && user.thirtyDayPlanEverActivated) {
      return res.status(400).json({ error: 'The 30-day plan can only be used once.' });
    }

    const now = new Date();
    const startFrom = (user.subscriptionEndAt && new Date(user.subscriptionEndAt) > now)
      ? new Date(user.subscriptionEndAt)
      : now;
    const paidAmount = Number(pending.amount || 0) > 0
      ? Number(pending.amount)
      : Number(getPlanAmount(plan));

    await OwnerSubscriptionPayment.create({
      owner: user._id,
      plan,
      amount: paidAmount,
      currency: 'INR',
      status: 'success',
      provider: 'razorpay',
      orderId: razorpay_order_id,
      paymentId: razorpay_payment_id,
      signature: razorpay_signature,
      paidAt: now,
      metadata: {
        startFrom,
        endAt: computeSubscriptionEnd(startFrom, plan),
      },
    });

    user.subscriptionPlan = plan;
    user.subscriptionStatus = 'active';
    user.subscriptionStartAt = startFrom;
    user.subscriptionEndAt = computeSubscriptionEnd(startFrom, plan);
    user.subscriptionReminderSentAt = null;
    user.subscriptionTotalPaid = Number(user.subscriptionTotalPaid || 0) + paidAmount;
    user.subscriptionLastPaidAmount = paidAmount;
    user.subscriptionLastPaidAt = now;
    user.subscriptionLastPaymentProvider = 'razorpay';
    user.subscriptionLastPaymentId = razorpay_payment_id;
    if (plan === 'thirty_days') user.thirtyDayPlanEverActivated = true;
    user.ownerPendingSubscription = {
      orderId: null,
      plan: null,
      amount: 0,
      createdAt: null,
    };
    await user.save();

    return res.json({
      success: true,
      message: 'Subscription payment successful. Owner features are now enabled.',
      ownerSubscription: getOwnerSubscriptionState(user),
    });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to verify subscription payment' });
  }
});

// ─── Dev fallback: activate owner subscription without gateway ─────────────
router.post('/owner-subscription/dev-activate', authenticate, authorize('owner'), async (req, res) => {
  try {
    if (process.env.NODE_ENV === 'production') {
      return res.status(403).json({ error: 'Dev activation is disabled in production' });
    }

    const user = await User.findById(req.user.id);
    if (!user || user.role !== 'owner') {
      return res.status(404).json({ error: 'Owner not found' });
    }

    const plan = req.body?.subscriptionPlan;
    if (!['thirty_days', 'monthly', 'yearly'].includes(plan)) {
      return res.status(400).json({ error: 'Valid subscriptionPlan is required (thirty_days/monthly/yearly)' });
    }

    if (plan === 'thirty_days' && user.thirtyDayPlanEverActivated) {
      return res.status(400).json({ error: 'The 30-day plan can only be used once.' });
    }

    const now = new Date();
    const startFrom = (user.subscriptionEndAt && new Date(user.subscriptionEndAt) > now)
      ? new Date(user.subscriptionEndAt)
      : now;
    const paidAmount = Number(getPlanAmount(plan));
    const devPaymentId = `DEV_${Date.now()}`;

    await OwnerSubscriptionPayment.create({
      owner: user._id,
      plan,
      amount: paidAmount,
      currency: 'INR',
      status: 'success',
      provider: 'dev_simulation',
      orderId: null,
      paymentId: devPaymentId,
      signature: null,
      paidAt: now,
      metadata: {
        mode: 'development',
        startFrom,
        endAt: computeSubscriptionEnd(startFrom, plan),
      },
    });

    user.subscriptionPlan = plan;
    user.subscriptionStatus = 'active';
    user.subscriptionStartAt = startFrom;
    user.subscriptionEndAt = computeSubscriptionEnd(startFrom, plan);
    user.subscriptionReminderSentAt = null;
    user.subscriptionTotalPaid = Number(user.subscriptionTotalPaid || 0) + paidAmount;
    user.subscriptionLastPaidAmount = paidAmount;
    user.subscriptionLastPaidAt = now;
    user.subscriptionLastPaymentProvider = 'dev_simulation';
    user.subscriptionLastPaymentId = devPaymentId;
    if (plan === 'thirty_days') user.thirtyDayPlanEverActivated = true;
    user.ownerPendingSubscription = {
      orderId: null,
      plan: null,
      amount: 0,
      createdAt: null,
    };
    await user.save();

    return res.json({
      success: true,
      message: 'Dev mode: subscription activated',
      ownerSubscription: getOwnerSubscriptionState(user),
    });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to activate subscription in dev mode' });
  }
});

// ─── Owner subscription status (backend inspection) ───────────────────────
router.get('/owner-subscription/status', authenticate, authorize('owner', 'admin'), async (req, res) => {
  try {
    const ownerId = req.user.role === 'admin'
      ? String(req.query.ownerId || '').trim()
      : req.user.id;

    if (req.user.role === 'admin' && !ownerId) {
      return res.status(400).json({ error: 'ownerId query is required for admin requests' });
    }

    const owner = await User.findById(ownerId).select('-password');
    if (!owner || owner.role !== 'owner') {
      return res.status(404).json({ error: 'Owner not found' });
    }

    const recentPayments = await OwnerSubscriptionPayment.find({ owner: owner._id, status: 'success' })
      .sort({ paidAt: -1 })
      .limit(5)
      .select('plan amount currency provider orderId paymentId paidAt createdAt');

    return res.json({
      owner: {
        id: owner._id,
        name: owner.name,
        phone: owner.phone,
        email: owner.email,
      },
      ownerSubscription: getOwnerSubscriptionState(owner),
      pendingPayment: owner.ownerPendingSubscription || null,
      recentPayments,
    });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to fetch owner subscription status' });
  }
});

// ─── Owner subscription payments history (backend inspection) ─────────────
router.get('/owner-subscription/payments', authenticate, authorize('owner', 'admin'), async (req, res) => {
  try {
    const ownerId = req.user.role === 'admin'
      ? String(req.query.ownerId || '').trim()
      : req.user.id;

    if (req.user.role === 'admin' && !ownerId) {
      return res.status(400).json({ error: 'ownerId query is required for admin requests' });
    }

    const owner = await User.findById(ownerId).select('role name phone email subscriptionTotalPaid subscriptionLastPaidAmount subscriptionLastPaidAt');
    if (!owner || owner.role !== 'owner') {
      return res.status(404).json({ error: 'Owner not found' });
    }

    const limit = Math.min(Math.max(parseInt(req.query.limit || '20', 10), 1), 100);
    const payments = await OwnerSubscriptionPayment.find({ owner: owner._id })
      .sort({ paidAt: -1 })
      .limit(limit)
      .select('plan amount currency status provider orderId paymentId paidAt metadata createdAt');

    return res.json({
      owner: {
        id: owner._id,
        name: owner.name,
        phone: owner.phone,
        email: owner.email,
      },
      paymentSummary: {
        totalPaid: Number(owner.subscriptionTotalPaid || 0),
        lastPaidAmount: Number(owner.subscriptionLastPaidAmount || 0),
        lastPaidAt: owner.subscriptionLastPaidAt || null,
      },
      count: payments.length,
      payments,
    });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to fetch owner subscription payments' });
  }
});

// ─── Update passenger privacy setting ─────────────────────────────────────--
router.put('/privacy', authenticate, async (req, res) => {
  try {
    if (req.user.role !== 'passenger') return res.status(403).json({ error: 'Only passengers can update this setting' });
    const { hidePhoneFromConductor, poyalooPassCardBlocked } = req.body;
    const updateFields = {};
    if (typeof hidePhoneFromConductor !== 'undefined') {
      updateFields.hidePhoneFromConductor = !!hidePhoneFromConductor;
    }
    if (typeof poyalooPassCardBlocked !== 'undefined') {
      updateFields.poyalooPassCardBlocked = !!poyalooPassCardBlocked;
    }
    const user = await User.findByIdAndUpdate(
      req.user.id,
      updateFields,
      { new: true }
    );
    res.json({
      success: true,
      hidePhoneFromConductor: user.hidePhoneFromConductor,
      poyalooPassCardBlocked: user.poyalooPassCardBlocked || false,
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update privacy setting' });
  }
});

// ─── Get Signed URL for Pass Document ───────────────────────────────────────
router.get('/pass-url', authenticate, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    
    let key = user.studentPassKey;
    if (!key && user.studentPassUrl) {
      // Try to extract key from public URL
      const publicPrefix = config.r2PublicUrl + '/';
      if (user.studentPassUrl.startsWith(publicPrefix)) {
        key = user.studentPassUrl.substring(publicPrefix.length);
        // Save the extracted key to the database for future use
        user.studentPassKey = key;
        await user.save();
      }
    }

    if (!key) {
      return res.status(404).json({ error: 'No pass document found' });
    }
    
    const signedUrl = await getSignedProofUrl(key);
    res.json({ success: true, signedUrl });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Update ticket category ─────────────────────────────────────────────────
router.put('/ticket-category', authenticate, async (req, res) => {
  try {
    const { ticketCategory } = req.body;
    const validCategories = ['adult', 'student', 'free'];
    if (!validCategories.includes(ticketCategory)) {
      return res.status(400).json({ error: 'Invalid ticket category. Must be adult, student, or free.' });
    }
    const user = await User.findByIdAndUpdate(
      req.user.id,
      { ticketCategory },
      { new: true }
    );
    res.json({ success: true, ticketCategory: user.ticketCategory });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Update conductor assignment (route & bus) ─────────────────────────────
router.put('/assignment', authenticate, authorize('conductor', 'admin'), async (req, res) => {
  try {
    const { routeId, busId } = req.body;
    if (!routeId || !busId) {
      return res.status(400).json({ error: 'routeId and busId are required' });
    }

    // Verify route and bus exist
    const route = await Route.findById(routeId);
    if (!route) return res.status(404).json({ error: 'Route not found' });

    const bus = await Bus.findById(busId);
    if (!bus) return res.status(404).json({ error: 'Bus not found' });

    // Check if bus is already assigned to another conductor
    if (bus.conductor && bus.conductor.toString() !== req.user.id) {
      return res.status(409).json({ error: 'This bus is already assigned to another conductor' });
    }

    // Remove conductor from previously assigned bus
    const user = await User.findById(req.user.id);
    if (user.assignedBus && user.assignedBus.toString() !== busId) {
      await Bus.findByIdAndUpdate(user.assignedBus, { conductor: null });
    }

    // Update user assignment
    await User.findByIdAndUpdate(req.user.id, { assignedRoute: routeId, assignedBus: busId });

    // Link conductor to the new bus and set the bus route
    await Bus.findByIdAndUpdate(busId, { conductor: req.user.id, route: routeId });

    const updatedUser = await User.findById(req.user.id)
      .select('-password')
      .populate('assignedRoute', 'name code')
      .populate('assignedBus', 'registration');

    res.json({
      message: 'Assignment updated successfully',
      assignedRoute: { id: updatedUser.assignedRoute._id, name: updatedUser.assignedRoute.name, code: updatedUser.assignedRoute.code },
      assignedBus: { id: updatedUser.assignedBus._id, registration: updatedUser.assignedBus.registration },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Update conductor UPI details ───────────────────────────────────────────
router.put('/upi', authenticate, async (req, res) => {
  try {
    const { conductorUpiId, conductorUpiName } = req.body;

    if (!conductorUpiId) {
      return res.status(400).json({ error: 'UPI ID is required' });
    }

    // Validate UPI ID format: xxx@xxx or 10-digit phone
    const upiRegex = /^[\w.\-]+@[\w]+$|^\d{10}@[\w]+$|^\d{10}$/;
    if (!upiRegex.test(conductorUpiId)) {
      return res.status(400).json({ error: 'Invalid UPI ID format. Use format like name@oksbi or 9876543210@paytm' });
    }

    const user = await User.findByIdAndUpdate(
      req.user.id,
      { conductorUpiId, conductorUpiName: conductorUpiName || '' },
      { new: true }
    );

    res.json({
      success: true,
      message: 'UPI details updated successfully',
      conductorUpiId: user.conductorUpiId,
      conductorUpiName: user.conductorUpiName,
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update UPI details' });
  }
});

// ─── Get conductor earnings ─────────────────────────────────────────────────
router.get('/earnings', authenticate, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user || (user.role !== 'conductor' && user.role !== 'admin')) {
      return res.status(403).json({ error: 'Conductor access only' });
    }

    // Reset today's earnings if date changed
    const today = new Date().toISOString().split('T')[0];
    if (user.lastEarningDate !== today) {
      user.todayEarnings = 0;
      user.lastEarningDate = today;
      await user.save();
    }

    // Get recent settlements
    const WalletTransaction = require('../models/WalletTransaction');
    const recentSettlements = await WalletTransaction.find({
      conductor_id: user._id,
      type: 'settlement',
      payment_status: 'success'
    })
      .sort({ createdAt: -1 })
      .limit(20);

    res.json({
      conductorUpiId: user.conductorUpiId,
      conductorUpiName: user.conductorUpiName,
      totalEarnings: user.totalEarnings,
      todayEarnings: user.todayEarnings,
      recentSettlements,
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to get earnings' });
  }
});

// ─── Forgot Password ─────────────────────────────────────────────────────────
router.post('/forgot-password', authRateLimiter, async (req, res) => {
  try {
    console.log('📧 Forgot password request for:', req.body.email);
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email is required' });

    const user = await User.findOne({ email: email.toLowerCase().trim() });
    // Always return the same message to prevent email enumeration
    if (!user) {
      console.log('⚠️  User not found:', email);
      return res.json({ message: 'If that email is registered, a reset link has been sent.' });
    }

    console.log('✅ User found:', user.email);
    const token = crypto.randomBytes(32).toString('hex');
    user.passwordResetToken = token;
    user.passwordResetExpires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour
    await user.save();

    const resetUrl = `${config.appBaseUrl}/reset-password.html?token=${token}`;
    const html = `
      <div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:24px;">
        <h2 style="color:#1d4ed8;">Password Reset Request</h2>
        <p>Hi <strong>${user.name}</strong>,</p>
        <p>We received a request to reset your ScanAndGo password. Click the button below — the link is valid for <strong>1 hour</strong>.</p>
        <p style="margin:24px 0;">
          <a href="${resetUrl}" style="background:#1d4ed8;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:bold;">Reset My Password</a>
        </p>
        <p style="color:#6b7280;font-size:0.875rem;">If you did not request this, you can safely ignore this email. Your password will not change.</p>
        <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0;"/>
        <p style="color:#9ca3af;font-size:0.8rem;">ScanAndGo – Smart Bus Ticketing, Kerala</p>
      </div>
    `;

    console.log('🚀 Calling sendEmailViaResend for:', user.email);
    await sendEmailViaResend(user.email, 'ScanAndGo – Reset Your Password', html);
    console.log('✅ Email sent via Resend!');
    res.json({ message: 'If that email is registered, a reset link has been sent.' });
  } catch (err) {
    console.error('❌ Forgot password email error:', err.message, err.stack);
    res.status(500).json({ error: 'Failed to send reset email. Please try again later.' });
  }
});

// ─── Reset Password ───────────────────────────────────────────────────────────
router.post('/reset-password/:token', authRateLimiter, async (req, res) => {
  try {
    const { token } = req.params;
    const { password } = req.body;

    if (!password) return res.status(400).json({ error: 'New password is required' });

    if (!PASSWORD_REGEX.test(password)) {
      return res.status(400).json({
        error: 'Password must be at least 8 characters, include 1 uppercase letter, 1 number, and 1 special character (e.g. @, #, !)',
      });
    }

    const user = await User.findOne({
      passwordResetToken: token,
      passwordResetExpires: { $gt: new Date() },
    });

    if (!user) {
      return res.status(400).json({ error: 'Reset link is invalid or has expired. Please request a new one.' });
    }

    user.password = password; // pre-save hook hashes it
    user.passwordResetToken = null;
    user.passwordResetExpires = null;
    await user.save();

    // Send confirmation email via Resend
    const confirmHtml = `
      <div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:24px;">
        <h2 style="color:#059669;">Password Changed</h2>
        <p>Hi <strong>${user.name}</strong>,</p>
        <p>Your ScanAndGo password was successfully changed on <strong>${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}</strong>.</p>
        <p>You can now log in using:</p>
        <ul>
          <li>Your <strong>email</strong> (${user.email}) + new password</li>
          <li>Your <strong>mobile number</strong> (${user.phone}) + new password</li>
        </ul>
        <p style="color:#dc2626;">If you did not make this change, please contact us immediately — your account may be at risk.</p>
        <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0;"/>
        <p style="color:#9ca3af;font-size:0.8rem;">ScanAndGo – Smart Bus Ticketing, Kerala</p>
      </div>
    `;
    
    await sendEmailViaResend(user.email, 'ScanAndGo – Password Changed Successfully', confirmHtml);
    res.json({ message: 'Password reset successfully. You can now log in with your email or mobile number.' });
  } catch (err) {
    console.error('❌ Password reset confirmation email error:', err.message);
    res.status(500).json({ error: 'Password reset failed. Please try again.' });
  }
});

// ─── Add wallet balance ─────────────────────────────────────────────────────
router.post('/wallet/recharge', authenticate, async (req, res) => {
  const { amount } = req.body;
  if (!amount || amount <= 0) return res.status(400).json({ error: 'Valid amount required' });

  const user = await User.findByIdAndUpdate(req.user.id, { $inc: { wallet: amount } }, { new: true });
  res.json({ message: `₹${amount} added`, wallet: user.wallet });
});

// ─── Purchase Poyaloo Pass ──────────────────────────────────────────────────
router.post('/poyaloo-pass/purchase', authenticate, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (user.poyalooPassActive) {
      return res.status(400).json({ error: 'You already have an active Poyaloo Pass' });
    }

    const { paymentMethod } = req.body;
    const passPrice = 150;

    if (paymentMethod === 'wallet') {
      if (user.wallet < passPrice) {
        return res.status(400).json({ error: `Insufficient wallet balance. Poyaloo Pass costs ₹${passPrice}, your balance: ₹${user.wallet}` });
      }
      user.wallet -= passPrice;
      
      const WalletTransaction = require('../models/WalletTransaction');
      // Record debit transaction
      await WalletTransaction.create({
        user: user._id,
        type: 'debit',
        amount: passPrice,
        balance_after: user.wallet,
        description: 'Poyaloo Bus Pass Remote Purchase',
        payment_method: 'wallet',
        payment_status: 'success',
      });
    } else {
      const WalletTransaction = require('../models/WalletTransaction');
      // Simulate direct payment (UPI/Card/Netbanking)
      const fakePaymentId = 'pay_' + crypto.randomBytes(12).toString('hex');
      await WalletTransaction.create({
        user: user._id,
        type: 'debit',
        amount: passPrice,
        balance_after: user.wallet,
        description: 'Poyaloo Bus Pass Remote Purchase (Direct Pay)',
        payment_method: paymentMethod || 'upi',
        payment_id: fakePaymentId,
        payment_status: 'success',
      });
    }

    // Generate unique 11-digit card number
    const min = 10000000000;
    const max = 99999999999;
    let cardNumber;
    let isUnique = false;
    while (!isUnique) {
      cardNumber = String(Math.floor(Math.random() * (max - min + 1)) + min);
      const existing = await User.findOne({ poyalooPassCardNumber: cardNumber });
      if (!existing) {
        isUnique = true;
      }
    }

    user.poyalooPassActive = true;
    user.poyalooPassCardNumber = cardNumber;
    await user.save();

    res.json({
      success: true,
      message: 'Poyaloo Pass purchased successfully!',
      cardNumber,
      wallet: user.wallet
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Upload Poyaloo Pass Photo ──────────────────────────────────────────────
router.post('/poyaloo-pass/photo', authenticate, upload.single('photo'), async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (!user.poyalooPassActive) {
      return res.status(400).json({ error: 'Please purchase a Poyaloo Pass first before uploading photo' });
    }
    if (!req.file) {
      return res.status(400).json({ error: 'No photo file provided' });
    }

    // Delete old photo if it exists to clean up R2
    if (user.poyalooPassPhotoKey) {
      if (user.poyalooPassPhotoKey.startsWith('local:')) {
        const fs = require('fs');
        const path = require('path');
        const filename = user.poyalooPassPhotoKey.split('local:')[1];
        const filepath = path.join(__dirname, '..', '..', 'public', 'uploads', filename);
        try {
          if (fs.existsSync(filepath)) {
            fs.unlinkSync(filepath);
          }
        } catch (err) {
          console.error('Error deleting local fallback file:', err);
        }
      } else {
        const { deleteFromR2 } = require('../services/r2Upload');
        try {
          await deleteFromR2(user.poyalooPassPhotoKey);
        } catch (err) {
          console.error('Error deleting old pass photo key from R2:', err);
        }
      }
    }

    let photoUrl = '';
    let photoKey = '';
    try {
      const r2 = await uploadToR2(
        req.file.buffer,
        req.file.mimetype,
        req.file.originalname,
        `passes/${user.phone}`
      );
      photoUrl = r2.publicUrl;
      photoKey = r2.key;
    } catch (r2Error) {
      console.warn('R2 upload failed, falling back to local storage:', r2Error.message);
      const fs = require('fs');
      const path = require('path');
      const { randomUUID } = require('crypto');

      const uploadsDir = path.join(__dirname, '..', '..', 'public', 'uploads');
      if (!fs.existsSync(uploadsDir)) {
        fs.mkdirSync(uploadsDir, { recursive: true });
      }

      const ext = req.file.mimetype.split('/')[1] || 'png';
      const filename = `pass-${user.phone}-${randomUUID()}.${ext}`;
      const filepath = path.join(uploadsDir, filename);

      fs.writeFileSync(filepath, req.file.buffer);
      photoUrl = `/uploads/${filename}`;
      photoKey = `local:${filename}`;
    }

    user.poyalooPassPhotoUrl = photoUrl;
    user.poyalooPassPhotoKey = photoKey;
    await user.save();

    let signedUrl = photoUrl;
    if (photoKey && !photoKey.startsWith('local:')) {
      signedUrl = await getSignedProofUrl(photoKey);
    }

    res.json({
      success: true,
      photoUrl: signedUrl,
      message: 'Pass photo uploaded successfully!'
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Order Poyaloo Pass Physical Card ───────────────────────────────────────
router.post('/poyaloo-pass/physical-card', authenticate, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (!user.poyalooPassActive) {
      return res.status(400).json({ error: 'Please purchase a Poyaloo Pass first' });
    }

    const { shippingAddress } = req.body;
    if (!shippingAddress || !shippingAddress.trim()) {
      return res.status(400).json({ error: 'Shipping address is required' });
    }

    const isFirstTime = (user.poyalooPassPhysicalCount || 0) === 0;
    const cost = isFirstTime ? 0 : 40;

    if (cost > 0) {
      if (user.wallet < cost) {
        return res.status(400).json({ error: `Insufficient wallet balance to order physical card. Cost: ₹${cost}, Balance: ₹${user.wallet}` });
      }
      user.wallet -= cost;

      const WalletTransaction = require('../models/WalletTransaction');
      // Record transaction
      await WalletTransaction.create({
        user: user._id,
        type: 'debit',
        amount: cost,
        balance_after: user.wallet,
        description: `Order physical Poyaloo Pass card (Order #${user.poyalooPassPhysicalCount + 1})`,
        payment_method: 'wallet',
        payment_status: 'success',
      });
    }

    user.poyalooPassPhysicalCount = (user.poyalooPassPhysicalCount || 0) + 1;
    user.poyalooPassPhysicalAddress = shippingAddress;
    await user.save();

    res.json({
      success: true,
      message: isFirstTime ? 'Your Kerala Traveler physical card has been ordered successfully! (First order is FREE)' : `Your Kerala Traveler physical card has been ordered successfully! ₹${cost} deducted from wallet.`,
      physicalCount: user.poyalooPassPhysicalCount,
      wallet: user.wallet
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Stream Poyaloo Pass Photo (Proxy to bypass CORS/Direct R2 rules) ───────
router.get('/poyaloo-pass/photo-stream', authenticate, async (req, res) => {
  try {
    const User = require('../models/User');
    const user = await User.findById(req.user.id);
    if (!user || !user.poyalooPassPhotoKey) {
      return res.status(404).send('No photo uploaded');
    }

    const key = user.poyalooPassPhotoKey;
    if (key.startsWith('local:')) {
      const fs = require('fs');
      const path = require('path');
      const filename = key.split('local:')[1];
      const filepath = path.join(__dirname, '..', '..', 'public', 'uploads', filename);

      if (!fs.existsSync(filepath)) {
        return res.status(404).send('File not found');
      }
      res.setHeader('Content-Type', 'image/png');
      return fs.createReadStream(filepath).pipe(res);
    } else {
      const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');
      const config = require('../config');
      const r2Client = new S3Client({
        region: 'auto',
        endpoint: config.r2Endpoint,
        credentials: {
          accessKeyId:     config.r2AccessKeyId,
          secretAccessKey: config.r2SecretAccessKey,
        },
      });

      const response = await r2Client.send(new GetObjectCommand({
        Bucket: config.r2BucketName,
        Key:    key,
      }));

      res.setHeader('Content-Type', response.ContentType || 'image/png');
      response.Body.pipe(res);
    }
  } catch (err) {
    console.error('Error streaming pass photo:', err);
    res.status(500).send(err.message);
  }
});

module.exports = router;