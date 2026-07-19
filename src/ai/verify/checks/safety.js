// Track C — content-safety gate (backstop). The Router's intent screen is the
// primary defense; this scans the DELIVERED code as defense-in-depth in case the
// Router mis-passes. Deliberately narrow to avoid false-positives on legitimate
// login / payment / signup components — the harmful *purpose/content* is the
// trigger, never the component type. Two checks:
//   (1) hateful / harassing language in the output;
//   (2) real-brand impersonation in a credential-capture context (phishing).

// Unambiguous slurs / hate terms. Word-bounded, case-insensitive. Kept minimal;
// this is a floor, not a comprehensive filter.
const HATE_TERMS = [
  'nigger',
  'nigga',
  'faggot',
  'kike',
  'chink',
  'spic',
  'wetback',
  'tranny',
  'retard',
  'coon',
];

// Frequently-impersonated brands. A match alone means nothing (a real "Sign in
// with Google" is fine) — it only counts alongside a password field AND phishing
// threat/urgency language.
const BRANDS = [
  'paypal',
  'chase',
  'apple',
  'microsoft',
  'google',
  'amazon',
  'netflix',
  'bank of america',
  'wells fargo',
  'citibank',
  'coinbase',
  'venmo',
  'instagram',
  'facebook',
  'whatsapp',
];

// Phishing-specific threat/urgency language — NOT ordinary login/signup copy
// (so "confirm your password" on a signup form does not trip this).
const PHISH_SIGNALS = [
  /unusual (activity|sign.?in|login)/i,
  /account (has been |was |is )?(suspended|locked|disabled|limited|restricted)/i,
  /re-?activate your account/i,
  /your account will be (closed|suspended|deleted|terminated)/i,
  /verify your (identity|account|information) to (avoid|prevent|restore|unlock|keep)/i,
  /confirm your identity to (unlock|restore|avoid)/i,
  /update your (payment|billing) (info|information|details) to avoid/i,
];

function checkSafety(code) {
  const failures = [];

  for (const term of HATE_TERMS) {
    if (new RegExp(`\\b${term}\\b`, 'i').test(code)) {
      failures.push('Generated content contains hateful or harassing language — not permitted.');
      break;
    }
  }

  const hasPassword = /type\s*=\s*["']password["']/i.test(code) || /\bpassword\b/i.test(code);
  const brand = BRANDS.find((b) =>
    new RegExp(`\\b${b.replace(/ /g, '\\s+')}\\b`, 'i').test(code)
  );
  const phishing = PHISH_SIGNALS.some((re) => re.test(code));
  if (hasPassword && brand && phishing) {
    failures.push(
      `Looks like credential-harvesting impersonation of "${brand}" — brand-impersonation phishing is not permitted.`
    );
  }

  return failures;
}

module.exports = { checkSafety, HATE_TERMS, BRANDS };
