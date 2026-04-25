const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const User = require('../models/User');

function computeInitials(name = '', email = '') {
  const source = String(name).trim() || String(email).split('@')[0] || '';
  const parts = source.split(/\s+|\./).filter(Boolean);
  if (!parts.length) return '?';
  const first = parts[0][0] || '';
  const last = parts.length > 1 ? parts[parts.length - 1][0] : '';
  return (first + last).toUpperCase();
}

function initPassport() {
  const clientID = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const callbackURL =
    process.env.GOOGLE_CALLBACK_URL ||
    `${process.env.APP_URL || 'http://localhost:5000'}/api/auth/google/callback`;

  if (!clientID || !clientSecret) {
    console.warn(
      '[chumlab-be] GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET not set - /api/auth/google/* will fail',
    );
    return;
  }

  passport.use(
    new GoogleStrategy(
      { clientID, clientSecret, callbackURL },
      async (_accessToken, _refreshToken, profile, done) => {
        try {
          const sub = profile.id;
          const email = String(
            (profile.emails && profile.emails[0] && profile.emails[0].value) || '',
          ).toLowerCase();

          if (!email) return done(new Error('Google did not return an email'));

          const name =
            profile.displayName ||
            [profile.name && profile.name.givenName, profile.name && profile.name.familyName]
              .filter(Boolean)
              .join(' ');
          const picture = profile.photos && profile.photos[0] && profile.photos[0].value;
          const initials = computeInitials(name, email);

          const update = {
            googleSub: sub,
            email,
            name,
            picture,
            initials,
            lastLoginAt: new Date(),
          };

          // Upsert by googleSub (primary), or by email if a record exists with the same
          // email but no googleSub (rare; allows linking after switching auth providers).
          let user = await User.findOneAndUpdate(
            { googleSub: sub },
            { $set: update },
            { new: true },
          );
          if (!user) {
            user = await User.findOneAndUpdate(
              { email },
              { $set: update },
              { new: true, upsert: true, setDefaultsOnInsert: true },
            );
          }
          done(null, user);
        } catch (err) {
          done(err);
        }
      },
    ),
  );
}

module.exports = initPassport;
