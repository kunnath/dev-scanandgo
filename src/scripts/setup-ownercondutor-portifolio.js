#!/usr/bin/env node

require('dotenv').config();
const mongoose = require('mongoose');

const User = require('./src/models/User');
const Bus = require('./src/models/Bus');

function parseArgs(argv) {
  const args = {
    ownerId: null,
    ownerPhone: null,
    conductorPhones: [],
    conductorIds: [],
    fromOwnerBuses: false,
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

    if (token === '--conductor-phones') {
      const value = argv[i + 1] || '';
      args.conductorPhones = value
        .split(',')
        .map((v) => v.trim())
        .filter(Boolean);
      i += 1;
      continue;
    }

    if (token === '--conductor-ids') {
      const value = argv[i + 1] || '';
      args.conductorIds = value
        .split(',')
        .map((v) => v.trim())
        .filter(Boolean);
      i += 1;
      continue;
    }

    if (token === '--from-owner-buses') {
      args.fromOwnerBuses = true;
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
  console.log('  node setup-ownerconductor-portfolio.js --owner-phone 9999999999 --conductor-phones 9000000010,9000000011');
  console.log('  node setup-ownerconductor-portfolio.js --owner-id 67f00abcde1234567890abcd --conductor-ids 67f00aaa...,67f00bbb...');
  console.log('  node setup-ownerconductor-portfolio.js --owner-phone 9999999999 --from-owner-buses');
  console.log('');
  console.log('Options:');
  console.log('  --owner-phone <phone>          Owner phone number');
  console.log('  --owner-id <id>                Owner Mongo ObjectId');
  console.log('  --conductor-phones <p1,p2>     Comma-separated conductor phone numbers');
  console.log('  --conductor-ids <id1,id2>      Comma-separated conductor ObjectIds');
  console.log('  --from-owner-buses             Pull conductors from buses owned by this owner');
  console.log('  --dry-run                      Show changes without saving');
  console.log('');
}

function normalizeUniqueObjectIds(values) {
  return Array.from(new Set((values || []).filter(Boolean).map((v) => String(v))));
}

async function resolveConductors(args, owner) {
  const collectedIds = [];

  if (args.conductorPhones.length > 0) {
    const conductorsByPhone = await User.find({
      role: 'conductor',
      phone: { $in: args.conductorPhones },
    }).select('_id phone name').lean();

    const foundPhones = new Set(conductorsByPhone.map((c) => c.phone));
    const missingPhones = args.conductorPhones.filter((p) => !foundPhones.has(p));
    if (missingPhones.length > 0) {
      console.log('Conductor phones not found:', missingPhones.join(', '));
    }

    collectedIds.push(...conductorsByPhone.map((c) => c._id));
  }

  if (args.conductorIds.length > 0) {
    const validIds = args.conductorIds.filter((id) => mongoose.Types.ObjectId.isValid(id));
    const invalidIds = args.conductorIds.filter((id) => !mongoose.Types.ObjectId.isValid(id));

    if (invalidIds.length > 0) {
      console.log('Invalid conductor ObjectIds:', invalidIds.join(', '));
    }

    if (validIds.length > 0) {
      const conductorsById = await User.find({
        _id: { $in: validIds },
        role: 'conductor',
      }).select('_id phone name').lean();

      const foundIds = new Set(conductorsById.map((c) => String(c._id)));
      const missingIds = validIds.filter((id) => !foundIds.has(String(id)));
      if (missingIds.length > 0) {
        console.log('Conductor IDs not found (or not role conductor):', missingIds.join(', '));
      }

      collectedIds.push(...conductorsById.map((c) => c._id));
    }
  }

  if (args.fromOwnerBuses) {
    const buses = await Bus.find({ owner: owner._id })
      .select('conductors')
      .lean();

    const busConductorIds = buses
      .flatMap((b) => (Array.isArray(b.conductors) ? b.conductors : []))
      .filter(Boolean);

    collectedIds.push(...busConductorIds);
  }

  return normalizeUniqueObjectIds(collectedIds);
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

  if (
    args.conductorPhones.length === 0 &&
    args.conductorIds.length === 0 &&
    !args.fromOwnerBuses
  ) {
    printUsage();
    throw new Error('Provide conductors via --conductor-phones or --conductor-ids or --from-owner-buses');
  }

  if (args.ownerId && !mongoose.Types.ObjectId.isValid(args.ownerId)) {
    throw new Error('Invalid --owner-id (must be ObjectId)');
  }

  await mongoose.connect(process.env.MONGODB_URI);

  const ownerQuery = args.ownerId
    ? { _id: args.ownerId, role: 'owner' }
    : { phone: args.ownerPhone, role: 'owner' };

  const owner = await User.findOne(ownerQuery);
  if (!owner) {
    throw new Error('Owner not found with given identity');
  }

  const foundConductorIds = await resolveConductors(args, owner);
  if (foundConductorIds.length === 0) {
    throw new Error('No conductors found from provided options');
  }

  const currentOwnedConductors = normalizeUniqueObjectIds(owner.ownedConductors || []);
  const nextOwnedConductors = normalizeUniqueObjectIds([
    ...currentOwnedConductors,
    ...foundConductorIds,
  ]);

  console.log('\nOwner:', owner.name, '| phone:', owner.phone);
  console.log('Current ownedConductors:', currentOwnedConductors.length);
  console.log('Found conductors to add:', foundConductorIds.length);
  console.log('Next ownedConductors:', nextOwnedConductors.length);

  if (args.dryRun) {
    console.log('\n[dry-run] No database writes performed.');
    await mongoose.disconnect();
    return;
  }

  owner.ownedConductors = nextOwnedConductors;
  await owner.save();

  console.log('\nDone: owner conductor portfolio updated successfully.');
  console.log('Owner portfolio:', {
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