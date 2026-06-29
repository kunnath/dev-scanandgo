/**
 * Route Verification Service
 *
 * Validates that a conductor is actually following their assigned route by
 * comparing real-time GPS coordinates against known route stop locations.
 *
 * Rules:
 *   - Each route stop has a GPS coordinate (lat/lng).
 *   - When the conductor's GPS is within STOP_RADIUS_METERS (100 m) of a stop,
 *     that stop is "matched".
 *   - After requiredStops (total route stops - 3) stops are matched, the bus is confirmed
 *     on-route.
   *   - If the bus was verified (matched stops >= requiredStops) but then misses stops, it is
 *     marked as "delayed" (bus on way, delay expected) — NOT off-route.
 *   - If the bus was NEVER verified (< requiredStops matched) and misses stops, it is
 *     flagged as off-route / cancelled.
 *   - Passengers are notified in real-time via Socket.IO.
 */

const Bus = require('../models/Bus');
const Route = require('../models/Route');

// ── Configuration ─────────────────────────────────────────────────────────
const STOP_RADIUS_METERS     = 100;  // GPS must be within 100 m of a stop
const MAX_MISSED_CONSECUTIVE = 3;    // 3 consecutive misses → off-route (only if not verified)
const VERIFICATION_TIMEOUT   = 10 * 60 * 1000; // 10 min to match at least 1 stop

class RouteVerifier {
  /**
   * @param {import('socket.io').Server} io
   */
  constructor(io) {
    this.io = io;
    /** @type {Map<string, BusTracking>} busId → tracking state */
    this.busTracking = new Map();
    this._intervalId = null;
  }

  /* ------------------------------------------------------------------ */
  /*  Lifecycle                                                          */
  /* ------------------------------------------------------------------ */

  start() {
    console.log('🛤️  Route Verifier started');
    // Periodic sweep for buses that never matched any stop
    this._intervalId = setInterval(() => this._periodicCheck(), 60_000);
  }

  stop() {
    if (this._intervalId) clearInterval(this._intervalId);
  }

  /* ------------------------------------------------------------------ */
  /*  Public API                                                         */
  /* ------------------------------------------------------------------ */

  /**
   * Initialise tracking when a bus (conductor) starts a trip.
   */
  async initBusTracking(busId, routeId) {
    try {
      const route = await Route.findById(routeId).populate('stops.stop').lean();
      if (!route || !route.stops || route.stops.length < 10) {
        console.warn(`Route ${routeId} has < 10 stops — cannot verify`);
        return;
      }

      const sortedStops = route.stops
        .filter(s => s.stop && s.stop.latitude != null && s.stop.longitude != null)
        .sort((a, b) => a.stop_order - b.stop_order)
        .map((s, idx) => ({
          index: idx,
          stopId: s.stop._id.toString(),
          name: s.stop.name,
          latitude: s.stop.latitude,
          longitude: s.stop.longitude,
          distFromStartKm: s.distance_from_start_km || 0,
        }));

      if (sortedStops.length < 3) {
        console.warn(`Route ${routeId}: only ${sortedStops.length} stops with GPS — skipping`);
        return;
      }

      const key = busId.toString();

      this.busTracking.set(key, {
        routeId: routeId.toString(),
        routeStops: sortedStops,
        matchedStops: [],
        matchedStopIds: new Set(),
        nextExpectedIdx: 0,
        consecutiveMisses: 0,
        status: 'pending', // pending | verified | delayed | off-route
        startedAt: Date.now(),
        lastMatchTime: null,
        gpsHistory: [],
        requiredStops: Math.max(1, sortedStops.length - 3),
      });

      console.log(`🛤️  Bus ${key} tracking initialised — ${sortedStops.length} stops on route`);

      this._emitRouteStatus(key, {
        status: 'pending',
        matchedStops: 0,
        requiredStops: Math.max(1, sortedStops.length - 3),
        message: 'Bus started. Verifying route…',
      });
    } catch (err) {
      console.error(`routeVerifier.initBusTracking error:`, err.message);
    }
  }

  /**
   * Feed every GPS update into the verifier.
   */
  async onGpsUpdate(busId, latitude, longitude, timestamp) {
    const key = busId.toString();
    const t = this.busTracking.get(key);
    if (!t || t.status === 'off-route') return;

    // If bus was delayed but now sends GPS near a stop again, restore to verified
    if (t.status === 'delayed') {
      t.status = 'verified';
      t.consecutiveMisses = 0;
    }

    const now = timestamp || Date.now();

    // Keep a small GPS history
    t.gpsHistory.push({ lat: latitude, lng: longitude, time: now });
    if (t.gpsHistory.length > 60) t.gpsHistory.shift();

    // ── Check proximity to all unmatched stops ──
    const nearby = [];
    for (const stop of t.routeStops) {
      if (t.matchedStopIds.has(stop.stopId)) continue;
      const dist = this._haversineMeters(latitude, longitude, stop.latitude, stop.longitude);
      if (dist <= STOP_RADIUS_METERS) {
        nearby.push({ stop, distance: dist });
      }
    }

    if (nearby.length > 0) {
      // Prefer the next expected stop (route order)
      nearby.sort((a, b) => a.stop.index - b.stop.index);
      const nearest = nearby[0];

      // Match immediately when within radius — no dwell time needed.
      // The 100 m radius + 3-stop minimum is strong enough validation.
      this._confirmStopMatch(t, nearest.stop, key, nearest.distance);
    } else {
      this._checkMissedStops(t, latitude, longitude, key);
    }
  }

  /**
   * Clean up when conductor ends trip.
   */
  removeBusTracking(busId) {
    this.busTracking.delete(busId.toString());
  }

  /**
   * Return current verification state (used by REST/Socket).
   */
  getStatus(busId) {
    const t = this.busTracking.get(busId.toString());
    if (!t) return null;
    return {
      status: t.status,
      matchedStops: t.matchedStops,
      matchedCount: t.matchedStops.length,
      requiredCount: t.requiredStops,
      consecutiveMisses: t.consecutiveMisses,
      totalRouteStops: t.routeStops.length,
    };
  }

  /* ------------------------------------------------------------------ */
  /*  Internal helpers                                                   */
  /* ------------------------------------------------------------------ */

  _confirmStopMatch(t, stop, busKey, distance) {
    if (t.matchedStopIds.has(stop.stopId)) return;

    t.matchedStops.push({
      stopId: stop.stopId,
      name: stop.name,
      index: stop.index,
      matchedAt: Date.now(),
      distanceMeters: Math.round(distance),
    });
    t.matchedStopIds.add(stop.stopId);
    t.lastMatchTime = Date.now();
    t.nextExpectedIdx = Math.max(t.nextExpectedIdx, stop.index + 1);
    t.consecutiveMisses = 0;

    console.log(
      `✅ Bus ${busKey} matched stop "${stop.name}" ` +
      `(${t.matchedStops.length}/${t.requiredStops} required)`
    );

    // If already verified/delayed and matches a new stop → restore to verified
    if (t.matchedStops.length >= t.requiredStops && t.status !== 'verified') {
      const wasDelayed = t.status === 'delayed';
      t.status = 'verified';
      console.log(
        wasDelayed
          ? `🟢 Bus ${busKey} RESTORED to verified (matched stop "${stop.name}")`
          : `🟢 Bus ${busKey} VERIFIED on route ${t.routeId}`
      );

      Bus.findByIdAndUpdate(busKey, {
        route_verified: true,
        route_verification_status: 'verified',
        route_verified_at: new Date(),
        verified_stops_count: t.matchedStops.length,
      }).catch(() => {});

      this._emitRouteStatus(busKey, {
        status: 'verified',
        matchedStops: t.matchedStops.length,
        message: 'Bus confirmed on route ✅',
      });
    } else {
      this._emitRouteStatus(busKey, {
        status: t.status,
        matchedStops: t.matchedStops.length,
        requiredStops: t.requiredStops,
        lastMatchedStop: stop.name,
        message: `Verifying route… ${t.matchedStops.length}/${t.requiredStops} stops confirmed`,
      });
    }
  }

  _checkMissedStops(t, lat, lng, busKey) {
    if (t.nextExpectedIdx >= t.routeStops.length) return;

    const expected = t.routeStops[t.nextExpectedIdx];
    if (!expected) return;

    const nextNext = t.routeStops[t.nextExpectedIdx + 1];
    if (!nextNext) return;

    const distToExpected = this._haversineMeters(lat, lng, expected.latitude, expected.longitude);
    const distToNextNext = this._haversineMeters(lat, lng, nextNext.latitude, nextNext.longitude);

    // Bus is closer to the stop AFTER the one we expected → likely skipped
    if (distToNextNext < distToExpected && distToExpected > STOP_RADIUS_METERS * 3) {
      // Before matching ANY stop, just advance silently — bus may start mid-route
      if (t.matchedStops.length === 0) {
        t.nextExpectedIdx++;
        return;
      }

      t.consecutiveMisses++;
      t.nextExpectedIdx++;

      console.log(
        `⚠️  Bus ${busKey} missed stop "${expected.name}" ` +
        `(${t.consecutiveMisses} consecutive misses)`
      );

      if (t.consecutiveMisses >= MAX_MISSED_CONSECUTIVE) {
        this._flagOffRoute(t, busKey);
      }
    }
  }

  async _flagOffRoute(t, busKey) {
    // ── If bus was already verified (stops matched >= required), NEVER mark off-route.
    //    Instead show "delayed" — bus is on way but may be taking a detour.
    if (t.matchedStops.length >= t.requiredStops) {
      // Only emit delayed if not already in delayed state (avoid spam)
      if (t.status === 'delayed') return;

      t.status = 'delayed';
      t.consecutiveMisses = 0; // reset so it doesn't keep firing
      console.log(`🟡 Bus ${busKey} DELAYED on route ${t.routeId} (verified but missing stops)`);

      try {
        await Bus.findByIdAndUpdate(busKey, {
          route_verification_status: 'delayed',
        });
      } catch (err) {
        console.error('DB update error (delayed):', err.message);
      }

      this._emitRouteStatus(busKey, {
        status: 'delayed',
        matchedStops: t.matchedStops.length,
        message: 'Bus on way, delay expected.',
      });
      return;
    }

    // ── Bus was NEVER verified (< 3 stops matched) → truly off-route
    t.status = 'off-route';
    console.log(`❌ Bus ${busKey} flagged OFF-ROUTE on route ${t.routeId}`);

    try {
      await Bus.findByIdAndUpdate(busKey, {
        route_verified: false,
        route_verification_status: 'off-route',
        route_deviation_at: new Date(),
      });
    } catch (err) {
      console.error('DB update error (off-route):', err.message);
    }

    // Notify all passengers on this route
    this._emitRouteStatus(busKey, {
      status: 'off-route',
      matchedStops: t.matchedStops.length,
      message: 'This bus is not following the expected route. Service cancelled.',
    });

    this.io.to(`route:${t.routeId}`).emit('bus:cancelled', {
      busId: busKey,
      routeId: t.routeId,
      reason: 'Route deviation detected — bus is not following the assigned route.',
      cancelledAt: new Date().toISOString(),
    });
  }

  /**
   * Periodic sweep — flag buses that haven't matched any stop after timeout.
   */
  _periodicCheck() {
    const now = Date.now();
    for (const [busKey, t] of this.busTracking) {
      if (t.status !== 'pending') continue;
      if (t.matchedStops.length === 0 && now - t.startedAt > VERIFICATION_TIMEOUT) {
        console.log(`⏱  Bus ${busKey} timed out with 0 matches — flagging off-route`);
        this._flagOffRoute(t, busKey);
      }
    }
  }

  /* ------------------------------------------------------------------ */
  /*  Emitter helper                                                     */
  /* ------------------------------------------------------------------ */

  _emitRouteStatus(busKey, payload) {
    const t = this.busTracking.get(busKey);
    const routeId = t ? t.routeId : null;
    const fullPayload = { busId: busKey, routeId, ...payload };

    if (routeId) this.io.to(`route:${routeId}`).emit('bus:route-status', fullPayload);
    this.io.to(`bus:${busKey}`).emit('bus:route-status', fullPayload);
  }

  /* ------------------------------------------------------------------ */
  /*  Haversine — returns distance between two points in **metres**      */
  /* ------------------------------------------------------------------ */

  _haversineMeters(lat1, lng1, lat2, lng2) {
    const R = 6_371_000; // Earth radius in metres
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLng = ((lng2 - lng1) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos((lat1 * Math.PI) / 180) *
        Math.cos((lat2 * Math.PI) / 180) *
        Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }
}

module.exports = RouteVerifier;
