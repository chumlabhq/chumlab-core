const express = require('express');
const ctrl = require('../controllers/admin.controller');
const { requireAuth, requireAdmin } = require('../middleware/auth');

const router = express.Router();

router.patch(
  '/playground/onboardings/:id/status',
  requireAuth,
  requireAdmin,
  ctrl.updateOnboardingStatus
);

module.exports = router;
