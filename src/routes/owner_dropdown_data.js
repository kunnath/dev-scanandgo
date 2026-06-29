const express = require('express');
const router = express.Router();
const Bus = require('../models/Bus');
const Route = require('../models/Route');
const User = require('../models/User');
const { authenticate, requireActiveOwnerSubscription } = require('../middleware/auth');

// =============================================
// DROPDOWN DATA ENDPOINTS - THE CORE SOLUTION
// =============================================

// GET /api/owner/dropdown-data
// Returns ALL data needed to populate assignment form dropdowns
// This is the key endpoint that connects frontend to backend data
router.get('/dropdown-data', authenticate, requireActiveOwnerSubscription, async (req, res) => {
  try {
    const ownerId = req.user.id;
    
    console.log('[DEBUG] Fetching dropdown data for owner:', ownerId);
    
    // FETCH FULL USER DATA (including ownedRoutes and ownedConductors arrays)
    const ownerUser = await User.findById(ownerId)
      .select('ownedRoutes ownedConductors name phone')
      .lean();
    
    if (!ownerUser) {
      return res.status(404).json({ 
        success: false,
        error: 'Owner user not found' 
      });
    }
    
    console.log('[DEBUG] Owner data:', {
      name: ownerUser.name,
      ownedRoutes: ownerUser.ownedRoutes?.length || 0,
      ownedConductors: ownerUser.ownedConductors?.length || 0
    });
    
    // FETCH 1: OWNER'S BUSES (including conductors array)
    const buses = await Bus.find({ owner: ownerId })
      .select('registration _id type capacity status zone conductors')
      .lean();
    
    console.log('[DEBUG] Found buses:', buses.length);
    console.log('[DEBUG] Buses with conductors:', buses.map(b => ({ 
      reg: b.registration, 
      conductors: b.conductors?.length || 0 
    })));
    
    // Format buses for dropdown selection
    const formattedBuses = buses.map(bus => ({
      value: bus._id.toString(), // The actual ID to send to backend
      label: `${bus.registration} (${bus.type.toUpperCase()}, ${bus.capacity} seats)`,
      // Additional data for display/tooltips
      details: {
        registration: bus.registration,
        type: bus.type,
        capacity: bus.capacity,
        status: bus.status,
        zone: bus.zone
      }
    }));
    
    // FETCH 2: ALL AVAILABLE ROUTES (not just owner's portfolio)
    // Owner should be able to assign buses to any active route in the system
    const allRoutes = await Route.find({ 
      active: true 
    })
    .select('name code _id base_fare per_km_fare zone')
    .sort({ zone: 1, name: 1 }) // Sort by zone then name
    .lean();
    
    console.log('[DEBUG] Found routes:', allRoutes.length);
    console.log('[DEBUG] All available routes fetched from database');
    
    // Format routes for dropdown selection
    const formattedRoutes = allRoutes.map(route => ({
      value: route._id.toString(), // The actual ID to send to backend
      label: `${route.name} (${route.code})`,
      details: {
        name: route.name,
        code: route.code,
        baseFare: route.base_fare,
        perKmFare: route.per_km_fare,
        zone: route.zone
      }
    }));
    
    // FETCH 3: OWNER'S CONDUCTORS (from portfolio)
    const ownedConductors = await User.find({ 
      _id: { $in: ownerUser.ownedConductors || [] },
      role: 'conductor' 
    })
    .select('name phone conductorUpiId conductorUpiName totalEarnings todayEarnings assignedBus assignedRoute')
    .lean();
    
    console.log('[DEBUG] Found conductors:', ownedConductors.length);
    console.log('[DEBUG] Owner ownedConductors array:', ownerUser.ownedConductors);
    console.log('[DEBUG] Conductor details:', ownedConductors.map(c => ({ name: c.name, phone: c.phone })));
    
    // Get currently assigned conductor IDs to show status
    const assignedConductorIds = new Set();
    buses.forEach(bus => {
      if (bus.conductors && Array.isArray(bus.conductors)) {
        bus.conductors.forEach(conductorId => {
          assignedConductorIds.add(conductorId.toString());
        });
      }
    });
    
    // Format conductors for dropdown selection
    const formattedConductors = ownedConductors.map(conductor => {
      const isAssigned = assignedConductorIds.has(conductor._id.toString());
      return {
        value: conductor._id.toString(), // The actual ID to send to backend
        label: `${conductor.name} (${conductor.phone})${isAssigned ? ' [ASSIGNED]' : ''}`,
        details: {
          name: conductor.name,
          phone: conductor.phone,
          upiId: conductor.conductorUpiId,
          upiName: conductor.conductorUpiName,
          totalEarnings: conductor.totalEarnings,
          todayEarnings: conductor.todayEarnings,
          isAssigned: isAssigned,
          assignedBus: conductor.assignedBus ? {
            id: conductor.assignedBus.toString()
          } : null,
          assignedRoute: conductor.assignedRoute ? {
            id: conductor.assignedRoute.toString()
          } : null
        }
      }
    });
    
    // RESPONSE WITH ALL DATA NEEDED FOR DROPDOWNS
    res.json({
      success: true,
      data: {
        buses: formattedBuses,
        routes: formattedRoutes,
        conductors: {
          all: formattedConductors,
          assigned: formattedConductors.filter(c => c.details.isAssigned),
          available: formattedConductors.filter(c => !c.details.isAssigned)
        }
      },
      // Summary for UI headers/counters
      summary: {
        totalBuses: formattedBuses.length,
        totalRoutes: formattedRoutes.length,
        totalConductors: formattedConductors.length,
        availableConductors: formattedConductors.filter(c => !c.details.isAssigned).length
      }
    });
  } catch (err) {
    console.error('[ERROR] Failed to fetch dropdown data:', err);
    res.status(500).json({ 
      success: false,
      error: 'Failed to load dropdown data', 
      details: err.message 
    });
  }
});

// =============================================
// ENHANCED ASSIGNMENT ENDPOINT
// =============================================

// POST /api/owner/assign-from-dropdowns
// Handles assignment when user selects from dropdowns
router.post('/assign-from-dropdowns', authenticate, requireActiveOwnerSubscription, async (req, res) => {
  try {
    const { busId, routeId, conductorId } = req.body;
    
    // Validation
    if (!busId || !routeId || !conductorId) {
      return res.status(400).json({ 
        success: false,
        error: 'Please select bus, route, and conductor from the lists' 
      });
    }

    const ownerId = req.user.id;
    
    // Fetch owner to get ownedConductors array
    const ownerUser = await User.findById(ownerId).select('ownedConductors');
    if (!ownerUser) {
      return res.status(404).json({ success: false, error: 'Owner not found' });
    }
    
    // Find and validate bus (by ID from dropdown)
    let bus = await Bus.findById(busId);
    if (!bus) {
      return res.status(404).json({ 
        success: false,
        error: `Bus not found: ${busId}` 
      });
    }

    // CRITICAL: Verify ownership
    if (bus.owner.toString() !== ownerId.toString()) {
      return res.status(403).json({ 
        success: false,
        error: `Access denied. You do not own bus: ${bus.registration}` 
      });
    }

    // Find and validate route (by ID from dropdown)
    let route = await Route.findById(routeId);
    if (!route) {
      return res.status(404).json({ 
        success: false,
        error: `Route not found: ${routeId}` 
      });
    }

    // Find and validate conductor (by ID from dropdown)
    let conductor = await User.findById(conductorId);
    if (!conductor) {
      return res.status(404).json({ 
        success: false,
        error: `Conductor not found: ${conductorId}` 
      });
    }

    // Verify conductor ownership
    const conductorOwned = ownerUser.ownedConductors.some(
      id => id.toString() === conductor._id.toString()
    );
    if (!conductorOwned) {
      return res.status(403).json({ 
        success: false,
        error: `Access denied. Conductor ${conductor.name} is not in your portfolio` 
      });
    }

    // Check if conductor is already assigned to another owner's bus
    const conductorAssignedElsewhere = await Bus.findOne({ 
      conductors: conductor._id,
      owner: { $ne: ownerId }
    });
    
    if (conductorAssignedElsewhere) {
      return res.status(409).json({ 
        success: false,
        error: `Conductor ${conductor.name} is already assigned to another owner's bus` 
      });
    }

    // Check if already assigned to this bus (idempotent - safe to call multiple times)
    if (!bus.conductors) bus.conductors = [];
    const alreadyAssignedToThisBus = bus.conductors.some(
      id => id.toString() === conductor._id.toString()
    );
    
    if (!alreadyAssignedToThisBus) {
      bus.conductors.push(conductor._id);
    }

    // Assign route to bus
    bus.route = route._id;
    await bus.save();

    // Assign to conductor
    conductor.assignedBus = bus._id;
    conductor.assignedRoute = route._id;
    await conductor.save();

    // RETURN RICH RESPONSE FOR UI FEEDBACK
    const populatedBus = await Bus.findById(bus._id)
      .populate('route', 'name code')
      .populate('conductors', 'name phone');
      
    const populatedConductor = await User.findById(conductor._id)
      .select('name phone conductorUpiId conductorUpiName');

    res.json({ 
      success: true,
      message: 'Assignment completed successfully!',
      assignment: {
        bus: {
          id: populatedBus._id,
          registration: populatedBus.registration,
          type: populatedBus.type,
          capacity: populatedBus.capacity,
          route: populatedBus.route ? {
            id: populatedBus.route._id,
            name: populatedBus.route.name,
            code: populatedBus.route.code
          } : null,
          conductorCount: populatedBus.conductors.length
        },
        route: {
          id: populatedBus.route._id,
          name: populatedBus.route.name,
          code: populatedBus.route.code,
          baseFare: populatedBus.route.base_fare,
          perKmFare: populatedBus.route.per_km_fare
        },
        conductor: {
          id: populatedConductor._id,
          name: populatedConductor.name,
          phone: populatedConductor.phone,
          upiId: populatedConductor.conductorUpiId,
          upiName: populatedConductor.conductorUpiName
        }
      }
    });
  } catch (err) {
    console.error('[ERROR] Assignment from dropdowns failed:', err);
    res.status(500).json({ 
      success: false,
      error: 'Assignment failed', 
      details: err.message 
    });
  }
});

// =============================================
// BUSES WITH CONDUCTORS ENDPOINT
// =============================================

// GET /api/owner/buses-with-conductors
// Returns all buses owned by the owner with assigned conductor details
// Used for displaying the buses table in the profile page
router.get('/buses-with-conductors', authenticate, requireActiveOwnerSubscription, async (req, res) => {
  try {
    const ownerId = req.user.id;
    
    console.log('[DEBUG] Fetching buses with conductors for owner:', ownerId);
    
    // Fetch owner's buses with populated conductors
    const buses = await Bus.find({ owner: ownerId })
      .select('registration _id type capacity status zone route')
      .populate('conductors', 'name phone')
      .populate('route', 'name code')
      .lean();

    console.log('[DEBUG] Found buses:', buses.length);

    // Format the response
    const formattedBuses = buses.map(bus => ({
      id: bus._id,
      registration: bus.registration,
      type: bus.type,
      capacity: bus.capacity,
      status: bus.status,
      zone: bus.zone,
      route: bus.route ? {
        id: bus.route._id,
        name: bus.route.name,
        code: bus.route.code
      } : null,
      conductors: (bus.conductors || []).map(c => ({
        id: c._id,
        name: c.name,
        phone: c.phone
      }))
    }));

    res.json({ 
      success: true, 
      buses: formattedBuses 
    });
  } catch (err) {
    console.error('[ERROR] Failed to fetch buses with conductors:', err);
    res.status(500).json({ 
      success: false,
      error: 'Failed to load buses', 
      details: err.message 
    });
  }
});

module.exports = router;
