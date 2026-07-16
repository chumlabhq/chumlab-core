const express = require('express');
const ctrl = require('../controllers/chat.controller');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

router.get('/', requireAuth, ctrl.listChats);
router.post('/', requireAuth, ctrl.createChat);
router.get('/:id', requireAuth, ctrl.getChat);
router.delete('/:id', requireAuth, ctrl.deleteChat);
router.get('/:id/messages', requireAuth, ctrl.listMessages);

module.exports = router;
