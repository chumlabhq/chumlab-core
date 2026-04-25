const passport = require('passport');
const asyncHandler = require('../utils/asyncHandler');
const { COOKIE_NAME, cookieOptions, signToken } = require('../middleware/auth');

function defaultFallbackUrl() {
  return `${process.env.FRONTEND_URL || 'http://localhost:5173'}/oauth/google`;
}

function encodeState(payload) {
  return Buffer.from(JSON.stringify(payload)).toString('base64url');
}

function decodeState(state) {
  try {
    return JSON.parse(Buffer.from(String(state), 'base64url').toString('utf8'));
  } catch {
    return {};
  }
}

function appendQuery(url, params) {
  const sep = url.includes('?') ? '&' : '?';
  const qs = Object.entries(params)
    .filter(([, v]) => v != null && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join('&');
  return qs ? `${url}${sep}${qs}` : url;
}

exports.googleLogin = (req, res, next) => {
  const fallbackUrl = req.query.fallbackUrl || defaultFallbackUrl();
  const flow = req.query.flow || '';
  const state = encodeState({ fallbackUrl, flow });
  passport.authenticate('google', {
    session: false,
    scope: ['profile', 'email'],
    state,
    prompt: 'select_account',
  })(req, res, next);
};

exports.googleCallback = (req, res, next) => {
  passport.authenticate('google', { session: false }, (err, user) => {
    const { fallbackUrl = defaultFallbackUrl(), flow = '' } = decodeState(req.query.state);

    if (err || !user) {
      const reason = (err && err.message) || 'auth_failed';
      return res.redirect(appendQuery(fallbackUrl, { error: reason, flow }));
    }

    let token;
    try {
      token = signToken(user);
    } catch (e) {
      return res.redirect(appendQuery(fallbackUrl, { error: 'signing_failed', flow }));
    }
    res.cookie(COOKIE_NAME, token, cookieOptions());

    return res.redirect(appendQuery(fallbackUrl, { flow }));
  })(req, res, next);
};

exports.me = asyncHandler(async (req, res) => {
  res.json({
    success: true,
    user: {
      _id: req.user._id,
      email: req.user.email,
      name: req.user.name,
      picture: req.user.picture,
      initials: req.user.initials,
    },
  });
});

exports.logout = (_req, res) => {
  res.clearCookie(COOKIE_NAME, { ...cookieOptions(), maxAge: 0 });
  res.json({ success: true });
};
