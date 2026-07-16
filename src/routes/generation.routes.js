const express = require('express');
const ctrl = require('../controllers/generation.controller');
const { requireAuth, requirePlaygroundAccess } = require('../middleware/auth');
const { perUserQuota } = require('../middleware/quota');

const router = express.Router();

router.get('/health', ctrl.health);
// Same gate chain the real generate stream gets in Phase 3.
router.get('/stream-test', requireAuth, requirePlaygroundAccess, perUserQuota, ctrl.streamTest);

module.exports = router;
