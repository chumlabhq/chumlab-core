const express = require('express');
const ctrl = require('../controllers/auth.controller');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

router.get('/google/login', ctrl.googleLogin);
router.get('/google/callback', ctrl.googleCallback);
router.get('/me', requireAuth, ctrl.me);
router.post('/logout', ctrl.logout);

module.exports = router;
