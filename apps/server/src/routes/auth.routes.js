"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.authRouter = void 0;
var _express = require("express");
var _zod = require("zod");
var _bcryptjs = _interopRequireDefault(require("bcryptjs"));
var _User = require("../models/User");
var _Driver = require("../models/Driver");
var _Guest = require("../models/Guest");
var _asyncHandler = require("../middleware/asyncHandler");
var _validate = require("../middleware/validate");
var _auth = require("../middleware/auth");
var _errors = require("../utils/errors");
var _AuditLog = require("../models/AuditLog");
function _interopRequireDefault(e) {
  return e && e.__esModule ? e : {
    default: e
  };
}
const authRouter = (0, _express.Router)();
exports.authRouter = authRouter;
const loginSchema = _zod.z.object({
  body: _zod.z.object({
    identifier: _zod.z.string().min(1),
    // email or phone
    password: _zod.z.string().min(1)
  })
});
authRouter.post('/login', (0, _validate.validate)({
  body: loginSchema.shape.body
}), (0, _asyncHandler.asyncHandler)(async (req, res) => {
  const {
    identifier,
    password
  } = req.body;
  const id = identifier.trim().toLowerCase();
  const user = await _User.User.findOne({
    isActive: true,
    $or: [{
      email: id
    }, {
      phone: identifier.trim()
    }]
  });
  if (!user) throw new _errors.UnauthorizedError('Invalid credentials');
  const ok = await _bcryptjs.default.compare(password, user.passwordHash);
  if (!ok) throw new _errors.UnauthorizedError('Invalid credentials');
  user.lastLoginAt = new Date();
  await user.save();
  const token = (0, _auth.signToken)({
    sub: user._id.toString(),
    role: user.role,
    driverId: user.driverId ? user.driverId.toString() : undefined
  });
  await _AuditLog.AuditLog.create({
    actorId: user._id,
    actorRole: user.role,
    action: 'login',
    entityType: 'User',
    entityId: user._id
  });
  res.json({
    ok: true,
    data: {
      token,
      role: user.role,
      name: user.name
    }
  });
}));
const guestLoginSchema = _zod.z.object({
  body: _zod.z.object({
    bookingRef: _zod.z.string().min(1),
    phone: _zod.z.string().min(1)
  })
});
authRouter.post('/guest/login', (0, _validate.validate)({
  body: guestLoginSchema.shape.body
}), (0, _asyncHandler.asyncHandler)(async (req, res) => {
  const {
    bookingRef,
    phone
  } = req.body;
  const guest = await _Guest.Guest.findOne({
    bookingRef: bookingRef.trim().toUpperCase(),
    phone: phone.trim()
  });
  if (!guest) throw new _errors.UnauthorizedError('Invalid booking reference or phone number');
  const token = (0, _auth.signToken)({
    sub: guest._id.toString(),
    role: 'guest',
    guestId: guest._id.toString()
  });
  res.json({
    ok: true,
    data: {
      token,
      role: 'guest',
      name: guest.name
    }
  });
}));
authRouter.get('/me', _auth.requireAuth, (0, _asyncHandler.asyncHandler)(async (req, res) => {
  const {
    role,
    sub,
    driverId,
    guestId
  } = req.user;
  if (role === 'admin') {
    const user = await _User.User.findById(sub).select('-passwordHash');
    if (!user) throw new _errors.StaleSessionError('User');
    res.json({
      ok: true,
      data: {
        role,
        user
      }
    });
    return;
  }
  if (role === 'driver') {
    const driver = await _Driver.Driver.findById(driverId);
    if (!driver) throw new _errors.StaleSessionError('Driver');
    res.json({
      ok: true,
      data: {
        role,
        driver
      }
    });
    return;
  }
  const guest = await _Guest.Guest.findById(guestId);
  if (!guest) throw new _errors.StaleSessionError('Guest');
  res.json({
    ok: true,
    data: {
      role,
      guest
    }
  });
}));
authRouter.post('/logout', _auth.requireAuth, (0, _asyncHandler.asyncHandler)(async (req, res) => {
  await _AuditLog.AuditLog.create({
    actorId: req.user.sub,
    actorRole: req.user.role,
    action: 'logout',
    entityType: 'User',
    entityId: req.user.sub
  });
  res.json({
    ok: true,
    data: {
      loggedOut: true
    }
  });
}));
