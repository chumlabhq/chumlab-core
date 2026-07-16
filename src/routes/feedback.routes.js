const express = require('express');
const ctrl = require('../controllers/feedback.controller');
const { requireAuth, requireAdmin } = require('../middleware/auth');

const router = express.Router();

router.post('/', ctrl.create);
router.get('/', requireAuth, requireAdmin, ctrl.list);
router.get('/:id', requireAuth, requireAdmin, ctrl.get);

module.exports = router;
