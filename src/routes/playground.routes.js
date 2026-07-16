const express = require('express');
const ctrl = require('../controllers/playground.controller');
const generationCtrl = require('../controllers/generation.controller');
const { requireAuth, requireAdmin, requirePlaygroundAccess } = require('../middleware/auth');
const { perUserQuota } = require('../middleware/quota');

const router = express.Router();

router.post('/onboard', requireAuth, ctrl.onboard);
router.post('/generate', requireAuth, requirePlaygroundAccess, perUserQuota, generationCtrl.generate);
// No quota on fix: the run-scoped round cap bounds it, and a render failure
// is the system's fault, not a fresh user request.
router.post('/generate/fix', requireAuth, requirePlaygroundAccess, generationCtrl.fixRun);
router.get('/me', requireAuth, ctrl.getMine);
router.get('/onboardings', requireAuth, requireAdmin, ctrl.list);
router.get('/onboardings/count', ctrl.count);

module.exports = router;
