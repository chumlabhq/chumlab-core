const jwt = require('jsonwebtoken');
const User = require('../models/User');
const ApiError = require('../utils/ApiError');

const COOKIE_NAME = 'chumlab_token';
const COOKIE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

function isProd() {
  return process.env.NODE_ENV === 'production';
}

function cookieOptions() {
  const prod = isProd();
  return {
    httpOnly: true,
    secure: prod,
    sameSite: prod ? 'none' : 'lax',
    maxAge: COOKIE_MAX_AGE_MS,
    path: '/',
  };
}

function signToken(user) {
  if (!process.env.JWT_SECRET) {
    throw new ApiError(500, 'JWT_SECRET is not configured on the server');
  }
  return jwt.sign(
    { sub: String(user._id), email: user.email },
    process.env.JWT_SECRET,
    { expiresIn: '30d' },
  );
}

async function requireAuth(req, _res, next) {
  try {
    const token = req.cookies && req.cookies[COOKIE_NAME];
    if (!token) throw new ApiError(401, 'Not authenticated');
    if (!process.env.JWT_SECRET) {
      throw new ApiError(500, 'JWT_SECRET is not configured on the server');
    }

    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch {
      throw new ApiError(401, 'Invalid or expired token');
    }

    const user = await User.findById(decoded.sub);
    if (!user) throw new ApiError(401, 'User no longer exists');

    req.user = user;
    next();
  } catch (err) {
    next(err);
  }
}

module.exports = {
  COOKIE_NAME,
  COOKIE_MAX_AGE_MS,
  cookieOptions,
  signToken,
  requireAuth,
};
