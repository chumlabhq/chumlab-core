const express = require('express');
const ctrl = require('../controllers/generation.controller');

const router = express.Router();

router.get('/health', ctrl.health);
router.get('/stream-test', ctrl.streamTest);

module.exports = router;
