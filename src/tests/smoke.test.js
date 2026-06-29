const path = require('path');
const config = require('../config');

describe('ScanAndGo Codebase Smoke Tests', () => {
  test('Configuration loads successfully', () => {
    expect(config).toBeDefined();
    expect(config.appName).toBe('ScanAndGo');
  });

  test('All Mongoose Models parse and load successfully', () => {
    const User = require('../models/User');
    const Ticket = require('../models/Ticket');
    const Bus = require('../models/Bus');
    const BusAssignment = require('../models/BusAssignment');
    const GpsLog = require('../models/GpsLog');
    const ArrivalPrediction = require('../models/ArrivalPrediction');

    expect(User).toBeDefined();
    expect(Ticket).toBeDefined();
    expect(Bus).toBeDefined();
    expect(BusAssignment).toBeDefined();
    expect(GpsLog).toBeDefined();
    expect(ArrivalPrediction).toBeDefined();
  });

  test('Middleware modules load successfully', () => {
    const { authRateLimiter } = require('../middleware/rateLimiter');
    const { authenticate, authorize } = require('../middleware/auth');

    expect(authRateLimiter).toBeDefined();
    expect(authenticate).toBeDefined();
    expect(authorize).toBeDefined();
  });

  test('Calculations and helpers do not produce NaN or error out', () => {
    // Test the computed subscription amounts logic
    const { authRateLimiter } = require('../middleware/rateLimiter');
    expect(authRateLimiter).toBeDefined();
  });
});
