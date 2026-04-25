const express = require('express');
const ctrl = require('../controllers/playground.controller');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

router.post('/onboard', requireAuth, ctrl.onboard);
router.get('/me', requireAuth, ctrl.getMine);
router.get('/onboardings', ctrl.list);
router.get('/onboardings/count', ctrl.count);

module.exports = router;
