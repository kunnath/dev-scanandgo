const express = require('express');
const crypto = require('crypto');
const User = require('../models/User');
const WalletTransaction = require('../models/WalletTransaction');
const { authenticate } = require('../middleware/auth');
const config = require('../config');

const router = express.Router();

/**
 * Helper: get Razorpay instance (only when keys are configured)
 */
function getRazorpay() {
  if (!config.razorpayKeyId || config.razorpayKeyId === 'PLACEHOLDER') return null;
  const Razorpay = require('razorpay');
  return new Razorpay({
    key_id: config.razorpayKeyId,
    key_secret: config.razorpayKeySecret,
  });
}

// ─── GET /api/wallet — Get wallet balance + recent transactions ─────────────
router.get('/', authenticate, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('wallet');
    const transactions = await WalletTransaction.find({ user: req.user.id })
      .sort('-createdAt')
      .limit(50)
      .lean();

    res.json({
      balance: user.wallet,
      transactions: transactions.map(t => ({
        id: t._id,
        type: t.type,
        amount: t.amount,
        balance_after: t.balance_after,
        description: t.description,
        payment_method: t.payment_method,
        payment_status: t.payment_status,
        created_at: t.createdAt,
      })),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/wallet/create-order — Create Razorpay order for UPI payment ──
router.post('/create-order', authenticate, async (req, res) => {
  try {
    const { amount } = req.body;
    const amountNum = parseFloat(amount);
    if (!amountNum || amountNum < 1 || amountNum > 10000) {
      return res.status(400).json({ error: 'Amount must be between ₹1 and ₹10,000' });
    }

    const razorpay = getRazorpay();
    if (!razorpay) {
      return res.status(503).json({ error: 'Payment gateway not configured. Use simulation mode.' });
    }

    const amountPaise = Math.round(amountNum * 100);
    const order = await razorpay.orders.create({
      amount: amountPaise,
      currency: 'INR',
      receipt: `wallet_${req.user.id}_${Date.now()}`,
      notes: { user_id: req.user.id, purpose: 'wallet_topup' },
    });

    // Record pending transaction
    const user = await User.findById(req.user.id);
    await WalletTransaction.create({
      user: req.user.id,
      type: 'credit',
      amount: amountNum,
      balance_after: user.wallet, // not yet credited
      description: 'Wallet top-up via UPI',
      payment_method: 'upi',
      order_id: order.id,
      payment_status: 'pending',
    });

    res.json({
      order_id: order.id,
      amount: amountPaise,
      currency: 'INR',
      key: config.razorpayKeyId,
    });
  } catch (err) {
    console.error('Razorpay order error:', err);
    res.status(500).json({ error: 'Payment gateway error. Please try again.' });
  }
});

// ─── POST /api/wallet/verify-payment — Verify Razorpay signature & credit ───
router.post('/verify-payment', authenticate, async (req, res) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;
    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return res.status(400).json({ error: 'Missing payment details' });
    }

    // Verify signature
    const body = razorpay_order_id + '|' + razorpay_payment_id;
    const expectedSignature = crypto
      .createHmac('sha256', config.razorpayKeySecret)
      .update(body)
      .digest('hex');

    if (expectedSignature !== razorpay_signature) {
      await WalletTransaction.findOneAndUpdate(
        { order_id: razorpay_order_id, user: req.user.id },
        { payment_status: 'failed' },
      );
      return res.status(400).json({ error: 'Payment verification failed' });
    }

    // Find the pending transaction
    const txn = await WalletTransaction.findOne({
      order_id: razorpay_order_id,
      user: req.user.id,
      payment_status: 'pending',
    });
    if (!txn) {
      return res.status(400).json({ error: 'Transaction not found or already processed' });
    }

    // Credit wallet atomically
    const user = await User.findByIdAndUpdate(
      req.user.id,
      { $inc: { wallet: txn.amount } },
      { new: true },
    );

    // Update transaction
    txn.payment_status = 'success';
    txn.payment_id = razorpay_payment_id;
    txn.balance_after = user.wallet;
    await txn.save();

    res.json({
      success: true,
      message: `₹${txn.amount} added to wallet`,
      balance: user.wallet,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/wallet/add — Simulate UPI payment (dev/test mode) ────────────
router.post('/add', authenticate, async (req, res) => {
  if (process.env.NODE_ENV === 'production') {
    return res.status(403).json({ error: 'Simulation endpoints are disabled in production mode.' });
  }
  try {
    const { amount } = req.body;
    const amountNum = parseFloat(amount);
    if (!amountNum || amountNum < 1 || amountNum > 10000) {
      return res.status(400).json({ error: 'Amount must be between ₹1 and ₹10,000' });
    }

    // Credit wallet atomically
    const user = await User.findByIdAndUpdate(
      req.user.id,
      { $inc: { wallet: amountNum } },
      { new: true },
    );

    // Record transaction
    const fakePaymentId = 'sim_' + crypto.randomBytes(12).toString('hex');
    await WalletTransaction.create({
      user: req.user.id,
      type: 'credit',
      amount: amountNum,
      balance_after: user.wallet,
      description: 'Wallet top-up via UPI',
      payment_method: 'upi',
      payment_id: fakePaymentId,
      payment_status: 'success',
    });

    res.json({
      success: true,
      message: `₹${amountNum} added to wallet`,
      balance: user.wallet,
      payment_id: fakePaymentId,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/wallet/transactions — Get transaction history ─────────────────
router.get('/transactions', authenticate, async (req, res) => {
  try {
    const transactions = await WalletTransaction.find({
      user: req.user.id,
      payment_status: { $in: ['success', 'failed'] },
    })
      .sort('-createdAt')
      .limit(50)
      .lean();

    res.json(transactions.map(t => ({
      id: t._id,
      type: t.type,
      amount: t.amount,
      balance_after: t.balance_after,
      description: t.description,
      payment_method: t.payment_method,
      payment_status: t.payment_status,
      created_at: t.createdAt,
    })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/wallet/recharge-pass — Recharge pass card & wallet by 11-digit card number ──
router.post('/recharge-pass', authenticate, async (req, res) => {
  if (process.env.NODE_ENV === 'production') {
    return res.status(403).json({ error: 'Pass card recharge simulation is disabled in production.' });
  }
  try {
    const { cardNumber, amount, paymentMethod } = req.body;
    const amountNum = parseFloat(amount);
    if (!amountNum || amountNum < 1 || amountNum > 10000) {
      return res.status(400).json({ error: 'Amount must be between ₹1 and ₹10,000' });
    }
    if (!cardNumber) {
      return res.status(400).json({ error: 'Card number is required' });
    }
    
    // Normalize card number by removing spaces
    const cleanCardNumber = cardNumber.replace(/\s+/g, '');
    if (cleanCardNumber.length !== 11 || isNaN(cleanCardNumber)) {
      return res.status(400).json({ error: 'Card number must be exactly 11 digits' });
    }

    // Find user and credit pass owner's wallet atomically
    const passUser = await User.findOneAndUpdate(
      { poyalooPassCardNumber: cleanCardNumber, poyalooPassActive: true },
      { $inc: { wallet: amountNum } },
      { new: true }
    );
    if (!passUser) {
      return res.status(404).json({ error: 'No active passenger card found with this Poyaloo Pass card number' });
    }

    // Record credit transaction
    const fakePaymentId = 'sim_' + crypto.randomBytes(12).toString('hex');
    await WalletTransaction.create({
      user: passUser._id,
      type: 'credit',
      amount: amountNum,
      balance_after: passUser.wallet,
      description: `Poyaloo Pass Recharge (Card #${cleanCardNumber})`,
      payment_method: paymentMethod || 'upi',
      payment_id: fakePaymentId,
      payment_status: 'success',
    });

    res.json({
      success: true,
      message: `₹${amountNum} recharged successfully to card #${cleanCardNumber}!`,
      cardOwner: passUser.name,
      wallet: passUser.wallet,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
