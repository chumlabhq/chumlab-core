const express = require('express');
const ctrl = require('../controllers/payment.controller');

const router = express.Router();

router.post('/create-order', ctrl.createOrder);
router.post('/verify-payment', ctrl.verifyPayment);
router.get('/orders/:id', ctrl.getOrder);

router.post(
  '/razorpay/webhook',
  express.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf.toString('utf8');
    },
  }),
  ctrl.razorpayWebhook
);

module.exports = router;
