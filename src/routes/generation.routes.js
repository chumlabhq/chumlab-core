const express = require('express');
const ctrl = require('../controllers/generation.controller');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

router.get('/health', ctrl.health);
router.get('/runs', requireAuth, ctrl.listRuns);
router.get('/runs/:id', requireAuth, ctrl.getRun);

module.exports = router;
