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

// History is chat-centric (Phase 10): each row is a chat, its summary derived
// from that chat's LATEST run — title, component type, gate status, size. Rows
// map 1:1 to chats; a chat with no delivered run yet falls back to its own
// title and null meta.
exports.listChats = asyncHandler(async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit, 10) || 30, 100);
  const filter = { userId: req.user._id };
  // Cursor pagination for the sidebar recents: `cursor` is the updatedAt of the
  // last row already shown; the next page is everything strictly older. Absent
  // cursor = first page (backward compatible).
  if (req.query.cursor) {
    const cursor = new Date(req.query.cursor);
    if (!Number.isNaN(cursor.getTime())) filter.updatedAt = { $lt: cursor };
  }

  // Fetch one extra to know whether an older page exists.
  const rows = await Chat.find(filter).sort({ updatedAt: -1 }).limit(limit + 1);
  const hasMore = rows.length > limit;
  const chats = hasMore ? rows.slice(0, limit) : rows;

  const chatIds = chats.map((c) => c._id);
  const runs = await PipelineRun.find({ userId: req.user._id, chatId: { $in: chatIds } })
    .sort({ createdAt: -1 })
    .select('chatId title componentType gatesPassed sizeKb status createdAt');

  // First run seen per chat is the newest (sorted desc).
  const latestByChat = new Map();
  for (const r of runs) {
    const key = String(r.chatId);
    if (!latestByChat.has(key)) latestByChat.set(key, r);
  }

  const enriched = chats.map((c) => {
    const run = latestByChat.get(String(c._id));
    return {
      id: c._id,
      _id: c._id,
      title: (run && run.title) || c.title,
      componentType: run ? run.componentType : null,
      gatesPassed: run ? run.gatesPassed : null,
      sizeKb: run ? run.sizeKb : null,
      status: run ? run.status : null,
      updatedAt: c.updatedAt,
      createdAt: c.createdAt,
    };
  });

  const nextCursor =
    hasMore && chats.length ? chats[chats.length - 1].updatedAt.toISOString() : null;

  res.json({ success: true, chats: enriched, nextCursor, hasMore });
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
