const { OAuth2Client } = require('google-auth-library');
const ApiError = require('../utils/ApiError');

let client = null;

function getClient() {
  if (client) return client;
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) {
    throw new ApiError(503, 'GOOGLE_CLIENT_ID is not configured on the server');
  }
  client = new OAuth2Client(clientId);
  return client;
}

function decodeJwtPayload(token) {
  const parts = String(token).split('.');
  if (parts.length !== 3) throw new ApiError(400, 'Malformed Google credential');
  const json = Buffer.from(parts[1], 'base64url').toString('utf8');
  return JSON.parse(json);
}

function computeInitials(name = '', email = '') {
  const source = name.trim() || (email.split('@')[0] || '');
  const parts = source.split(/\s+|\./).filter(Boolean);
  if (!parts.length) return '?';
  const first = parts[0][0] || '';
  const second = parts.length > 1 ? parts[parts.length - 1][0] : '';
  return (first + second).toUpperCase();
}

async function verifyGoogleCredential(credential) {
  if (!credential || typeof credential !== 'string') {
    throw new ApiError(400, 'credential is required');
  }

  const verifyEnabled = String(process.env.GOOGLE_OAUTH_VERIFY || 'true').toLowerCase() !== 'false';

  let payload;
  if (verifyEnabled) {
    try {
      const ticket = await getClient().verifyIdToken({
        idToken: credential,
        audience: process.env.GOOGLE_CLIENT_ID,
      });
      payload = ticket.getPayload();
    } catch (err) {
      throw new ApiError(401, 'Invalid Google credential', err && err.message);
    }
  } else {
    payload = decodeJwtPayload(credential);
  }

  if (!payload || !payload.sub || !payload.email) {
    throw new ApiError(401, 'Google credential missing required claims');
  }

  if (verifyEnabled && payload.email_verified === false) {
    throw new ApiError(401, 'Google email is not verified');
  }

  const name = payload.name || [payload.given_name, payload.family_name].filter(Boolean).join(' ');

  return {
    sub: payload.sub,
    email: String(payload.email).toLowerCase(),
    emailVerified: payload.email_verified !== false,
    name: name || '',
    picture: payload.picture || '',
    initials: computeInitials(name, payload.email),
    givenName: payload.given_name || '',
    familyName: payload.family_name || '',
    locale: payload.locale || '',
  };
}

module.exports = { verifyGoogleCredential, computeInitials };
