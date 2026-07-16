const Chat = require('../models/Chat');
const Message = require('../models/Message');
const PipelineRun = require('../models/PipelineRun');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');

async function ownedChat(req) {
  const chat = await Chat.findById(req.params.id);
  if (!chat || !chat.userId.equals(req.user._id)) throw new ApiError(404, 'Chat not found');
  return chat;
}

exports.listChats = asyncHandler(async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
  const chats = await Chat.find({ userId: req.user._id }).sort({ updatedAt: -1 }).limit(limit);
  res.json({ success: true, chats });
});

exports.createChat = asyncHandler(async (req, res) => {
  const title = String((req.body && req.body.title) || '').trim().slice(0, 200);
  const chat = await Chat.create({ userId: req.user._id, title });
  res.status(201).json({ success: true, chat });
});

exports.getChat = asyncHandler(async (req, res) => {
  const chat = await ownedChat(req);
  res.json({ success: true, chat });
});

exports.deleteChat = asyncHandler(async (req, res) => {
  const chat = await ownedChat(req);
  await Message.deleteMany({ chatId: chat._id });
  await PipelineRun.deleteMany({ chatId: chat._id });
  await chat.deleteOne();
  res.json({ success: true });
});

exports.listMessages = asyncHandler(async (req, res) => {
  const chat = await ownedChat(req);
  const messages = await Message.find({ chatId: chat._id }).sort({ createdAt: 1 }).limit(200);
  res.json({ success: true, messages });
});
