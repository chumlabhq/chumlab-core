const Razorpay = require('razorpay');

let instance = null;

function getRazorpay() {
  if (instance) return instance;

  const key_id = process.env.RAZORPAY_KEY_ID;
  const key_secret = process.env.RAZORPAY_KEY_SECRET;

  if (!key_id || !key_secret) {
    throw new Error('RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET must be set in environment');
  }

  instance = new Razorpay({ key_id, key_secret });
  return instance;
}

module.exports = { getRazorpay };
