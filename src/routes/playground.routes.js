const express = require('express');
const ctrl = require('../controllers/playground.controller');
const { requireAuth, requireAdmin } = require('../middleware/auth');

const router = express.Router();

router.post('/onboard', requireAuth, ctrl.onboard);
router.get('/me', requireAuth, ctrl.getMine);
router.get('/onboardings', requireAuth, requireAdmin, ctrl.list);
router.get('/onboardings/count', ctrl.count);

module.exports = router;
