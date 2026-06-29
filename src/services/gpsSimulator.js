/**
 * GPS Simulator – simulates bus movement along routes for development.
 * In production, this would be replaced by real GPS device data pushed via the API.
 */
const Bus = require('../models/Bus');
const Route = require('../models/Route');
const GpsLog = require('../models/GpsLog');
const ArrivalPrediction = require('../models/ArrivalPrediction');
const config = require('../config');
const fs = require('fs');
const path = require('path');

// Removed hardcoded JSON timings - using Bus start_time and stop_time fields now.

class GPSSimulator {
  constructor(io, routeVerifier) {
    this.io = io;
    this.routeVerifier = routeVerifier || null;
    this.intervalId = null;
    this._initialised = new Set(); // buses already initialised for route verification
  }

  start() {
    if (!config.gpsSimulation) return;
    console.log('🛰  GPS Simulator started (dev mode)');
    this.intervalId = setInterval(() => this.tick(), config.gpsUpdateIntervalMs);
  }

  stop() {
    if (this.intervalId) clearInterval(this.intervalId);
  }

  async tick() {
    try {
      // Activate/Deactivate buses according to their dynamic schedule
      const now = new Date();
      const nowStr = now.toTimeString().slice(0, 5); // 'HH:MM'

      // Stop running buses whose stop_time has passed
      const runningBusesToStop = await Bus.find({ 
        status: 'running', 
        gps_enabled: true, 
        stop_time: { $lt: nowStr, $ne: null } 
      });
      for (const bus of runningBusesToStop) {
        await Bus.findByIdAndUpdate(bus._id, {
          status: 'idle',
          latitude: null,
          longitude: null,
          speed_kmh: 0,
          heading: 0,
          last_stop: null,
          next_stop: null,
        });
        console.log(`Deactivated bus ${bus.registration} at ${nowStr} (stop time: ${bus.stop_time})`);
      }

      // Start idle buses whose start_time <= now <= stop_time
      const idleBusesToStart = await Bus.find({ 
        status: 'idle', 
        gps_enabled: true,
        start_time: { $lte: nowStr, $ne: null },
        $or: [
          { stop_time: { $gte: nowStr } },
          { stop_time: null }
        ]
      });
      for (const bus of idleBusesToStart) {
        await Bus.findByIdAndUpdate(bus._id, {
          status: 'running',
          latitude: null,
          longitude: null,
          speed_kmh: 0,
          heading: 0,
          last_gps_update: now,
          last_stop: null,
          next_stop: null,
        });
        console.log(`Activated bus ${bus.registration} at ${nowStr} (schedule: ${bus.start_time} - ${bus.stop_time})`);
      }

      // Simulate movement for all running buses
      const buses = await Bus.find({ status: 'running', gps_enabled: true }).lean();
      for (const bus of buses) {
        if (!bus.route) continue;
        const route = await Route.findById(bus.route).populate('stops.stop').lean();
        if (!route || !route.stops || route.stops.length < 2) continue;
        // Initialise route verification for this bus (once)
        const busKey = bus._id.toString();
        if (this.routeVerifier && !this._initialised.has(busKey)) {
          await this.routeVerifier.initBusTracking(bus._id, bus.route);
          this._initialised.add(busKey);
        }
        const routeStops = route.stops.sort((a, b) => a.stop_order - b.stop_order);
        
        // Find all running buses for this route to space them out if initialized
        const routeBuses = buses.filter(b => b.route && b.route.toString() === route._id.toString())
                                .sort((a, b) => a.registration.localeCompare(b.registration));
        const busIndex = routeBuses.findIndex(b => b._id.toString() === bus._id.toString());
        
        let currentIdx = 0;
        if (bus.next_stop) {
          currentIdx = routeStops.findIndex(rs => rs.stop && rs.stop._id.toString() === bus.next_stop.toString());
          if (currentIdx === -1) currentIdx = 0;
        } else if (busIndex !== -1) {
          // Space them out evenly upon initial startup/load
          currentIdx = Math.floor((busIndex * routeStops.length) / routeBuses.length) % routeStops.length;
        }
        
        const nextStopEntry = routeStops[currentIdx];
        if (!nextStopEntry || !nextStopEntry.stop) continue;
        const targetLat = nextStopEntry.stop.latitude;
        const targetLng = nextStopEntry.stop.longitude;
        let lat = bus.latitude;
        let lng = bus.longitude;
        if (lat === null || lng === null) {
          const startStop = routeStops[currentIdx].stop;
          if (startStop) {
            lat = startStop.latitude;
            lng = startStop.longitude;
          }
        }
        const step = 0.001; // Fixed step size for strict route following
        const dlat = targetLat - lat;
        const dlng = targetLng - lng;
        const dist = Math.sqrt(dlat * dlat + dlng * dlng);
        if (dist < 0.001) {
          lat = targetLat;
          lng = targetLng;
          const nextIdx = (currentIdx + 1) % routeStops.length;
          const lastStopId = routeStops[currentIdx].stop._id;
          const nextStopId = routeStops[nextIdx].stop._id;
          await Bus.findByIdAndUpdate(bus._id, { last_stop: lastStopId, next_stop: nextStopId });
          this.io.to(`route:${bus.route}`).emit('bus:stop-arrived', {
            busId: bus._id,
            stopId: lastStopId,
            stopName: routeStops[currentIdx].stop.name,
            timestamp: new Date().toISOString(),
          });
        } else {
          lat += (dlat / dist) * step;
          lng += (dlng / dist) * step;
        }
        //const speed = 15 + Math.random() * 30;
        const speed = 20 + Math.random() * 40; // Speeds between 40 and 80 km/h
        const heading = Math.atan2(dlng, dlat) * (180 / Math.PI);
        const now2 = new Date();
        await Bus.findByIdAndUpdate(bus._id, {
          latitude: lat, longitude: lng,
          speed_kmh: Math.round(speed),
          heading,
          last_gps_update: now2,
        });
        await GpsLog.create({
          bus: bus._id, latitude: lat, longitude: lng,
          speed_kmh: Math.round(speed), heading,
        });
        // Feed GPS to Route Verifier
        if (this.routeVerifier) {
          await this.routeVerifier.onGpsUpdate(bus._id, lat, lng, Date.now());
        }
        const verStatus = this.routeVerifier ? this.routeVerifier.getStatus(bus._id) : null;
        this.io.to(`route:${bus.route}`).emit('bus:location', {
          busId: bus._id,
          registration: bus.registration,
          latitude: lat,
          longitude: lng,
          speed: Math.round(speed),
          heading,
          nextStop: nextStopEntry.stop.name,
          timestamp: now2.toISOString(),
          routeVerified: verStatus?.status === 'verified',
          routeStatus: verStatus?.status || 'pending',
          matchedStops: verStatus?.matchedCount || 0,
        });
        // Debug: Log first emission for verification
        if (!this._emittedBuses) this._emittedBuses = new Set();
        if (!this._emittedBuses.has(bus._id.toString())) {
          console.log(`[GPS] Emitting location for bus ${bus.registration} to route:${bus.route}`);
          this._emittedBuses.add(bus._id.toString());
        }
        await this.updatePredictions(bus, routeStops, currentIdx, speed);
      }
    } catch (err) {
      console.error('GPS Simulator tick error:', err.message);
    }
  }

  async updatePredictions(bus, routeStops, currentIdx, speed) {
    await ArrivalPrediction.deleteMany({ bus: bus._id });

    let accumulatedTime = 0;
    const now = Date.now();
    const bulkOps = [];

    for (let i = currentIdx; i < routeStops.length; i++) {
      if (i > currentIdx) {
        const prevStop = routeStops[i - 1];
        const currStop = routeStops[i];
        const segmentKm = currStop.distance_from_start_km - prevStop.distance_from_start_km;
        const timeHours = segmentKm / Math.max(speed, 10);
        accumulatedTime += timeHours * 3600 * 1000;
      }

      const predictedArrival = new Date(now + accumulatedTime);
      const confidence = Math.max(0.5, 0.95 - (i - currentIdx) * 0.05);

      bulkOps.push({
        bus: bus._id,
        stop: routeStops[i].stop._id,
        predicted_arrival: predictedArrival,
        confidence,
      });
    }

    if (bulkOps.length > 0) {
      await ArrivalPrediction.insertMany(bulkOps);
    }
  }
}

module.exports = GPSSimulator;
