import { Router } from 'express';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { User } from '../models/User';
import { Driver } from '../models/Driver';
import { Guest } from '../models/Guest';
import { asyncHandler } from '../middleware/asyncHandler';
import { validate } from '../middleware/validate';
import { requireAuth } from '../middleware/auth';
import { signToken } from '../middleware/auth';
import { UnauthorizedError, NotFoundError } from '../utils/errors';
import { AuditLog } from '../models/AuditLog';

export const authRouter = Router();

const loginSchema = z.object({
  body: z.object({
    identifier: z.string().min(1), // email or phone
    password: z.string().min(1)
  })
});

authRouter.post(
  '/login',
  validate({ body: loginSchema.shape.body }),
  asyncHandler(async (req, res) => {
    const { identifier, password } = req.body as { identifier: string; password: string };
    const id = identifier.trim().toLowerCase();

    const user = await User.findOne({
      isActive: true,
      $or: [{ email: id }, { phone: identifier.trim() }]
    });
    if (!user) throw new UnauthorizedError('Invalid credentials');

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) throw new UnauthorizedError('Invalid credentials');

    user.lastLoginAt = new Date();
    await user.save();

    const token = signToken({
      sub: user._id.toString(),
      role: user.role as 'admin' | 'driver',
      driverId: user.driverId ? user.driverId.toString() : undefined
    });

    await AuditLog.create({ actorId: user._id, actorRole: user.role, action: 'login', entityType: 'User', entityId: user._id });

    res.json({ ok: true, data: { token, role: user.role, name: user.name } });
  })
);

const guestLoginSchema = z.object({
  body: z.object({
    bookingRef: z.string().min(1),
    phone: z.string().min(1)
  })
});

authRouter.post(
  '/guest/login',
  validate({ body: guestLoginSchema.shape.body }),
  asyncHandler(async (req, res) => {
    const { bookingRef, phone } = req.body as { bookingRef: string; phone: string };

    const guest = await Guest.findOne({ bookingRef: bookingRef.trim().toUpperCase(), phone: phone.trim() });
    if (!guest) throw new UnauthorizedError('Invalid booking reference or phone number');

    const token = signToken({ sub: guest._id.toString(), role: 'guest', guestId: guest._id.toString() });

    res.json({ ok: true, data: { token, role: 'guest', name: guest.name } });
  })
);

authRouter.get(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { role, sub, driverId, guestId } = req.user!;

    if (role === 'admin') {
      const user = await User.findById(sub).select('-passwordHash');
      if (!user) throw new NotFoundError('User');
      res.json({ ok: true, data: { role, user } });
      return;
    }

    if (role === 'driver') {
      const driver = await Driver.findById(driverId);
      if (!driver) throw new NotFoundError('Driver');
      res.json({ ok: true, data: { role, driver } });
      return;
    }

    const guest = await Guest.findById(guestId);
    if (!guest) throw new NotFoundError('Guest');
    res.json({ ok: true, data: { role, guest } });
  })
);

authRouter.post(
  '/logout',
  requireAuth,
  asyncHandler(async (req, res) => {
    await AuditLog.create({ actorId: req.user!.sub, actorRole: req.user!.role, action: 'logout', entityType: 'User', entityId: req.user!.sub });
    res.json({ ok: true, data: { loggedOut: true } });
  })
);
