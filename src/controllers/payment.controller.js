const crypto = require('crypto');
const { getRazorpay } = require('../config/razorpay');
const Order = require('../models/Order');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');

const MIN_AMOUNT_PAISE = 100;

exports.createOrder = asyncHandler(async (req, res) => {
  const { amount, currency = 'INR', receipt, notes = {}, customer = {} } = req.body || {};

  const amountPaise = Number(amount);
  if (!Number.isFinite(amountPaise) || amountPaise < MIN_AMOUNT_PAISE) {
    throw new ApiError(400, `amount must be a number >= ${MIN_AMOUNT_PAISE} paise`);
  }

  const finalReceipt = String(receipt || `rcpt_${Date.now()}`).slice(0, 40);

  let rzpOrder;
  try {
    rzpOrder = await getRazorpay().orders.create({
      amount: Math.floor(amountPaise),
      currency,
      receipt: finalReceipt,
      notes,
    });
  } catch (err) {
    const status = err && err.statusCode === 401 ? 401 : 500;
    const message =
      status === 401
        ? 'Razorpay authentication failed - check API keys'
        : 'Failed to create Razorpay order';
    throw new ApiError(status, message, err && (err.error || err.message));
  }

  await Order.create({
    razorpayOrderId: rzpOrder.id,
    receipt: rzpOrder.receipt,
    amount: rzpOrder.amount,
    currency: rzpOrder.currency,
    status: 'created',
    notes,
    customer,
  });

  res.status(201).json({
    success: true,
    order_id: rzpOrder.id,
    amount: rzpOrder.amount,
    currency: rzpOrder.currency,
    receipt: rzpOrder.receipt,
    key_id: process.env.RAZORPAY_KEY_ID,
  });
});

exports.verifyPayment = asyncHandler(async (req, res) => {
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body || {};

  if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
    throw new ApiError(400, 'razorpay_order_id, razorpay_payment_id and razorpay_signature are required');
  }

  const expectedSignature = crypto
    .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
    .update(`${razorpay_order_id}|${razorpay_payment_id}`)
    .digest('hex');

  const provided = Buffer.from(String(razorpay_signature), 'utf8');
  const expected = Buffer.from(expectedSignature, 'utf8');

  const isValid =
    provided.length === expected.length && crypto.timingSafeEqual(provided, expected);

  if (!isValid) {
    await Order.findOneAndUpdate(
      { razorpayOrderId: razorpay_order_id },
      { status: 'failed', failureReason: 'signature_mismatch' }
    );
    throw new ApiError(400, 'Invalid payment signature');
  }

  const order = await Order.findOneAndUpdate(
    { razorpayOrderId: razorpay_order_id },
    {
      status: 'paid',
      razorpayPaymentId: razorpay_payment_id,
      razorpaySignature: razorpay_signature,
    },
    { new: true }
  );

  res.json({
    success: true,
    message: 'Payment verified',
    order_id: razorpay_order_id,
    payment_id: razorpay_payment_id,
    order,
  });
});

exports.getOrder = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const order = await Order.findOne({ razorpayOrderId: id });
  if (!order) throw new ApiError(404, 'Order not found');
  res.json({ success: true, order });
});

exports.razorpayWebhook = asyncHandler(async (req, res) => {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!secret) {
    return res.status(503).json({ success: false, message: 'Webhook secret not configured' });
  }

  const signature = req.headers['x-razorpay-signature'];
  const expected = crypto
    .createHmac('sha256', secret)
    .update(req.rawBody || JSON.stringify(req.body))
    .digest('hex');

  if (!signature || signature !== expected) {
    return res.status(400).json({ success: false, message: 'Invalid webhook signature' });
  }

  const event = req.body && req.body.event;
  const payload = req.body && req.body.payload;

  if (event === 'payment.captured' && payload && payload.payment) {
    const p = payload.payment.entity;
    await Order.findOneAndUpdate(
      { razorpayOrderId: p.order_id },
      { status: 'paid', razorpayPaymentId: p.id }
    );
  } else if (event === 'payment.failed' && payload && payload.payment) {
    const p = payload.payment.entity;
    await Order.findOneAndUpdate(
      { razorpayOrderId: p.order_id },
      { status: 'failed', failureReason: p.error_description || 'payment_failed' }
    );
  }

  res.json({ success: true });
});
