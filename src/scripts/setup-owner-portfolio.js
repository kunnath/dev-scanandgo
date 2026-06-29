#!/usr/bin/env node

require('dotenv').config();
const mongoose = require('mongoose');

const Bus = require('../models/Bus');
const User = require('../models/User');

function parseArgs(argv) {
  const args = {
    ownerId: null,
    ownerPhone: null,
    buses: [],
    zone: null,
    dryRun: false,
  };

  for (let i = 2; i < argv.length; i += 1) {
    const token = argv[i];

    if (token === '--owner-id') {
      args.ownerId = argv[i + 1] || null;
      i += 1;
      continue;
    }

    if (token === '--owner-phone') {
      args.ownerPhone = argv[i + 1] || null;
      i += 1;
      continue;
    }

    if (token === '--buses') {
      const value = argv[i + 1] || '';
      args.buses = value
        .split(',')
        .map((r) => r.trim())
        .filter(Boolean);
      i += 1;
      continue;
    }

    if (token === '--zone') {
      args.zone = (argv[i + 1] || '').trim().toLowerCase() || null;
      i += 1;
      continue;
    }

    if (token === '--dry-run') {
      args.dryRun = true;
      continue;
    }
  }

  return args;
}

function printUsage() {
  console.log('\nUsage:');
  console.log('  node setup-owner-portfolio.js --owner-phone 9999999999 --buses KL-13-AAA-1000,KL-13-AAB-1001');
  console.log('  node setup-owner-portfolio.js --owner-id 67f00abcde1234567890abcd --buses KL-13-AAA-1000,KL-13-AAB-1001');
  console.log('  node setup-owner-portfolio.js --owner-phone 9999999999 --zone kannur');
  console.log('');
  console.log('Options:');
  console.log('  --owner-phone <phone>   Owner phone number');
  console.log('  --owner-id <id>         Owner Mongo ObjectId');
  console.log('  --buses <reg1,reg2>     Comma-separated bus registrations to map');
  console.log('  --zone <zone>           Map all buses in a zone (e.g. kannur, trivandrum)');
  console.log('  --dry-run               Show what would change without saving');
  console.log('');
}

function normalizeUniqueObjectIds(values) {
  return Array.from(new Set((values || []).filter(Boolean).map((v) => String(v))));
}

async function main() {
  const args = parseArgs(process.argv);

  if (!process.env.MONGODB_URI) {
    throw new Error('MONGODB_URI is missing in .env');
  }

  if (!args.ownerId && !args.ownerPhone) {
    printUsage();
    throw new Error('Provide either --owner-id or --owner-phone');
  }

  if (args.ownerId && !mongoose.Types.ObjectId.isValid(args.ownerId)) {
    throw new Error('Invalid --owner-id (must be ObjectId)');
  }

  if (args.buses.length === 0 && !args.zone) {
    printUsage();
    throw new Error('Provide either --buses or --zone');
  }

  await mongoose.connect(process.env.MONGODB_URI);

  const ownerQuery = args.ownerId
    ? { _id: args.ownerId, role: 'owner' }
    : { phone: args.ownerPhone, role: 'owner' };

  const owner = await User.findOne(ownerQuery);
  if (!owner) {
    throw new Error('Owner not found with given identity');
  }

  const busQuery = {};
  if (args.buses.length > 0) {
    busQuery.registration = { $in: args.buses };
  } else if (args.zone) {
    busQuery.zone = args.zone;
  }

  const buses = await Bus.find(busQuery).select('_id registration route conductors owner zone').lean();

  if (buses.length === 0) {
    throw new Error('No matching buses found for given --buses/--zone');
  }

  const foundRegs = new Set(buses.map((b) => b.registration));
  const missingRegs = args.buses.filter((reg) => !foundRegs.has(reg));

  const busIds = buses.map((b) => b._id);

  // Gather owner portfolio updates from selected buses.
  const routeIdsFromBuses = normalizeUniqueObjectIds(buses.map((b) => b.route).filter(Boolean));
  const conductorIdsFromBuses = normalizeUniqueObjectIds(
    buses.flatMap((b) => (Array.isArray(b.conductors) ? b.conductors : [])).filter(Boolean)
  );

  const currentOwnedRoutes = normalizeUniqueObjectIds(owner.ownedRoutes || []);
  const currentOwnedConductors = normalizeUniqueObjectIds(owner.ownedConductors || []);

  const nextOwnedRoutes = normalizeUniqueObjectIds([...currentOwnedRoutes, ...routeIdsFromBuses]);
  const nextOwnedConductors = normalizeUniqueObjectIds([...currentOwnedConductors, ...conductorIdsFromBuses]);

  console.log('\nOwner:', owner.name, '| phone:', owner.phone);
  console.log('Matched buses:', buses.length);
  if (args.zone) console.log('Zone filter:', args.zone);
  if (missingRegs.length > 0) console.log('Bus registrations not found:', missingRegs.join(', '));

  if (args.dryRun) {
    console.log('\n[dry-run] No database writes performed.');
    console.log('[dry-run] Would map buses to owner field');
    console.log('[dry-run] Would update owner portfolio counts:', {
      ownedRoutesBefore: currentOwnedRoutes.length,
      ownedRoutesAfter: nextOwnedRoutes.length,
      ownedConductorsBefore: currentOwnedConductors.length,
      ownedConductorsAfter: nextOwnedConductors.length,
    });
    await mongoose.disconnect();
    return;
  }

  const busUpdate = await Bus.updateMany(
    { _id: { $in: busIds } },
    { $set: { owner: owner._id } }
  );

  owner.ownedRoutes = nextOwnedRoutes;
  owner.ownedConductors = nextOwnedConductors;
  await owner.save();

  console.log('\nDone: owner portfolio mapped successfully.');
  console.log('Buses modified:', busUpdate.modifiedCount);
  console.log('Owner portfolio:', {
    ownedRoutes: owner.ownedRoutes.length,
    ownedConductors: owner.ownedConductors.length,
  });

  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error('\nFailed:', err.message);
  try {
    await mongoose.disconnect();
  } catch (disconnectErr) {
    // ignore disconnect error
  }
  process.exit(1);
});
