const express = require('express');
const router = express.Router();
const { ZONES } = require('../zones');

// GET /api/zones – list all available zones
router.get('/', (req, res) => {
  res.json({ zones: Object.values(ZONES) });
});

// GET /api/zones/:key – get single zone info
router.get('/:key', (req, res) => {
  const zone = ZONES[req.params.key];
  if (!zone) return res.status(404).json({ error: 'Zone not found' });
  res.json(zone);
});

module.exports = router;
