const express = require('express');
const ctrl = require('../controllers/support.controller');

const router = express.Router();

router.post('/', ctrl.create);
router.get('/', ctrl.list);
router.get('/:id', ctrl.get);
router.patch('/:id/status', ctrl.updateStatus);

module.exports = router;
