const express = require('express');
const ctrl = require('../controllers/feedback.controller');

const router = express.Router();

router.post('/', ctrl.create);
router.get('/', ctrl.list);
router.get('/:id', ctrl.get);

module.exports = router;
