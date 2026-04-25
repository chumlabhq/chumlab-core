const express = require('express');
const ctrl = require('../controllers/playground.controller');

const router = express.Router();

router.post('/auth/google', ctrl.googleAuth);
router.post('/onboard', ctrl.onboard);
router.get('/onboardings', ctrl.list);
router.get('/onboardings/count', ctrl.count);

module.exports = router;
