import { User } from '../../models/User';
import { Driver } from '../../models/Driver';
import { Guest } from '../../models/Guest';
import { EventConfig } from '../../models/EventConfig';
import { signToken } from '../../middleware/auth';
import { toGeoPoint } from '../../utils/geo';
let counter = 0;
function unique() {
  counter += 1;
  return counter;
}
export async function makeDriver(name = 'Test Driver') {
  const n = unique();
  const phone = `9${String(n).padStart(9, '0')}`;
  const user = await User.create({
    name,
    phone,
    role: 'driver',
    passwordHash: 'x',
    isActive: true
  });
  const driver = await Driver.create({
    userId: user._id,
    name,
    phone,
    vehicle: {
      number: `KA-${n}`,
      model: 'Sedan',
      colour: 'White',
      type: 'sedan'
    },
    capacity: {
      seats: 4,
      luggage: 3
    },
    status: 'idle',
    currentLocation: toGeoPoint({
      lat: 18.55,
      lng: 73.85
    }),
    predictedFreeAt: new Date(),
    predictedFreeLocation: toGeoPoint({
      lat: 18.55,
      lng: 73.85
    }),
    isActive: true
  });
  await User.updateOne({
    _id: user._id
  }, {
    $set: {
      driverId: driver._id
    }
  });
  const token = signToken({
    sub: user._id.toString(),
    role: 'driver',
    driverId: driver._id.toString()
  });
  return {
    user,
    driver,
    token
  };
}
export async function makeGuest(name = 'Test Guest') {
  const n = unique();
  const guest = await Guest.create({
    bookingRef: `EVT-${n}`,
    name,
    phone: `7${String(n).padStart(9, '0')}`,
    groupSize: 1,
    luggageCount: 1,
    priorityTier: 1,
    status: 'registered'
  });
  const token = signToken({
    sub: guest._id.toString(),
    role: 'guest',
    guestId: guest._id.toString()
  });
  return {
    guest,
    token
  };
}
export async function makeAdmin(name = 'Test Admin') {
  const suffix = unique();
  const user = await User.create({
    name,
    email: `admin${suffix}@test.com`,
    role: 'admin',
    passwordHash: 'x',
    isActive: true
  });
  const token = signToken({
    sub: user._id.toString(),
    role: 'admin'
  });
  return {
    user,
    token
  };
}

/** DispatchEngine/GreedyMatcher require an EventConfig singleton to exist. */
export async function makeEventConfig() {
  return EventConfig.findOneAndUpdate({
    singleton: 'singleton'
  }, {
    $setOnInsert: {
      singleton: 'singleton',
      name: 'Test Event',
      timezone: 'Asia/Kolkata',
      startAt: new Date('2026-08-10T00:00:00+05:30'),
      endAt: new Date('2026-08-14T23:59:00+05:30')
    }
  }, {
    upsert: true,
    new: true
  });
}
