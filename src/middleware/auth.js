const jwt = require('jsonwebtoken');
const config = require('../config');
const User = require('../models/User');

/** Verify JWT and attach user to req */
function authenticate(req, res, next) {
  let token = null;
  const header = req.headers.authorization;
  if (header && header.startsWith('Bearer ')) {
    token = header.slice(7);
  } else if (req.query && req.query.token) {
    token = req.query.token;
  }

  if (!token) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  try {
    const payload = jwt.verify(token, config.jwtSecret);
    req.user = payload;         // { id, name, phone, role }
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

/** Role-based access control */
function authorize(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    next();
  };
}

async function requireActiveOwnerSubscription(req, res, next) {
  try {
    if (!req.user || req.user.role !== 'owner') {
      return res.status(403).json({ error: 'Access denied. Owner role required.' });
    }

    const owner = await User.findById(req.user.id).select('subscriptionStatus subscriptionEndAt');
    if (!owner) {
      return res.status(404).json({ error: 'Owner not found' });
    }

    const now = new Date();
    const hasExpired = owner.subscriptionEndAt && owner.subscriptionEndAt <= now;

    if (hasExpired && owner.subscriptionStatus !== 'expired') {
      owner.subscriptionStatus = 'expired';
      await owner.save();
    }

    const isActive = owner.subscriptionStatus === 'active' && owner.subscriptionEndAt && owner.subscriptionEndAt > now;
    if (!isActive) {
      return res.status(403).json({
        error: 'Owner subscription expired. Please renew to access dashboard and assignments.',
        code: 'OWNER_SUBSCRIPTION_EXPIRED',
      });
    }

    next();
  } catch {
    return res.status(500).json({ error: 'Failed to validate owner subscription' });
  }
}

module.exports = { authenticate, authorize, requireActiveOwnerSubscription };
