const express = require('express');
const ctrl = require('../controllers/playground.controller');
const generationCtrl = require('../controllers/generation.controller');
const { requireAuth, requireAdmin, requirePlaygroundAccess } = require('../middleware/auth');
const { burstLimiter } = require('../middleware/quota');

const router = express.Router();

router.post('/onboard', requireAuth, ctrl.onboard);
// Burst guard runs up front; the daily + global caps are charged inside the
// controller at commit-to-build so no-op/question answers stay free.
router.post('/generate', requireAuth, requirePlaygroundAccess, burstLimiter, generationCtrl.generate);
// No quota on fix: the run-scoped round cap bounds it, and a render failure
// is the system's fault, not a fresh user request.
router.post('/generate/fix', requireAuth, requirePlaygroundAccess, generationCtrl.fixRun);
// Resume a clarify-paused run with the user's answers. No quota - the run was
// already charged at /generate.
router.post('/generate/resume', requireAuth, requirePlaygroundAccess, generationCtrl.resumeRun);
router.get('/me', requireAuth, ctrl.getMine);
// Appearance settings (C4) — authed user only; gates stay always-on.
router.get('/settings', requireAuth, ctrl.getSettings);
router.patch('/settings', requireAuth, ctrl.patchSettings);
router.get('/onboardings', requireAuth, requireAdmin, ctrl.list);
router.get('/onboardings/count', ctrl.count);

module.exports = router;
