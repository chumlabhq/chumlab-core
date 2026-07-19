const { test, before, after } = require('node:test');
const assert = require('node:assert');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const playgroundCtrl = require('../src/controllers/playground.controller');
const chatCtrl = require('../src/controllers/chat.controller');
const Chat = require('../src/models/Chat');
const PipelineRun = require('../src/models/PipelineRun');

let mongod;

before(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
});

after(async () => {
  await mongoose.disconnect();
  if (mongod) await mongod.stop();
});

// Invoke an asyncHandler-wrapped controller directly. Resolves with the JSON
// body on success; rejects with the ApiError the handler threw (asyncHandler
// funnels it to next).
function invoke(handler, req) {
  return new Promise((resolve, reject) => {
    const res = {
      statusCode: 200,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(body) {
        resolve({ statusCode: this.statusCode, body });
      },
    };
    handler(req, res, (err) => (err ? reject(err) : resolve({ next: true })));
  });
}

const newId = () => new mongoose.Types.ObjectId();

test('settings GET returns defaults, PATCH round-trips and persists', async () => {
  const uid = newId();

  const g1 = await invoke(playgroundCtrl.getSettings, { user: { _id: uid } });
  assert.deepEqual(g1.body.settings, { previewTheme: 'light', previewDevice: 'fill' });

  const patched = await invoke(playgroundCtrl.patchSettings, {
    user: { _id: uid },
    body: { previewTheme: 'dark', previewDevice: 'tablet' },
  });
  assert.deepEqual(patched.body.settings, { previewTheme: 'dark', previewDevice: 'tablet' });

  const g2 = await invoke(playgroundCtrl.getSettings, { user: { _id: uid } });
  assert.deepEqual(g2.body.settings, { previewTheme: 'dark', previewDevice: 'tablet' });

  // A partial patch leaves the untouched field intact.
  const g3 = await invoke(playgroundCtrl.patchSettings, {
    user: { _id: uid },
    body: { previewTheme: 'system' },
  });
  assert.equal(g3.body.settings.previewTheme, 'system');
  assert.equal(g3.body.settings.previewDevice, 'tablet');
});

test('settings PATCH rejects an invalid value', async () => {
  await assert.rejects(
    () => invoke(playgroundCtrl.patchSettings, { user: { _id: newId() }, body: { previewTheme: 'neon' } }),
    /previewTheme must be one of/
  );
  await assert.rejects(
    () => invoke(playgroundCtrl.patchSettings, { user: { _id: newId() }, body: { previewDevice: 'watch' } }),
    /previewDevice must be one of/
  );
});

test('chat list is enriched from each chat\'s latest run', async () => {
  const uid = newId();
  const chat = await Chat.create({ userId: uid, title: 'raw fallback title' });

  const older = await PipelineRun.create({
    userId: uid,
    chatId: chat._id,
    status: 'done',
    title: 'first attempt',
    componentType: 'card',
    sizeKb: 1.0,
    gatesPassed: false,
  });
  // Force the first run to be strictly older so "latest" is unambiguous.
  await PipelineRun.updateOne({ _id: older._id }, { $set: { createdAt: new Date(Date.now() - 60000) } });

  await PipelineRun.create({
    userId: uid,
    chatId: chat._id,
    status: 'done',
    title: '6-digit OTP verification input',
    componentType: 'otp',
    sizeKb: 4.1,
    gatesPassed: true,
  });

  const res = await invoke(chatCtrl.listChats, { user: { _id: uid }, query: {} });
  const rows = res.body.chats;
  assert.equal(rows.length, 1);

  const row = rows[0];
  assert.equal(row.title, '6-digit OTP verification input', 'latest run title wins');
  assert.equal(row.componentType, 'otp');
  assert.equal(row.sizeKb, 4.1);
  assert.equal(row.gatesPassed, true);
  assert.equal(row.status, 'done');
  assert.ok(row.updatedAt, 'carries the chat updatedAt');
});

test('chat list paginates by updatedAt cursor', async () => {
  const uid = newId();
  const make = async (title, ageMs) => {
    const c = await Chat.create({ userId: uid, title });
    // Bypass the timestamp plugin so the override sticks.
    await Chat.updateOne(
      { _id: c._id },
      { $set: { updatedAt: new Date(Date.now() - ageMs) } },
      { timestamps: false }
    );
    return c;
  };
  await make('newest', 0);
  await make('middle', 60000);
  await make('oldest', 120000);

  const page1 = await invoke(chatCtrl.listChats, { user: { _id: uid }, query: { limit: '2' } });
  assert.equal(page1.body.chats.length, 2);
  assert.equal(page1.body.chats[0].title, 'newest');
  assert.equal(page1.body.hasMore, true);
  assert.ok(page1.body.nextCursor);

  const page2 = await invoke(chatCtrl.listChats, {
    user: { _id: uid },
    query: { limit: '2', cursor: page1.body.nextCursor },
  });
  assert.equal(page2.body.chats.length, 1);
  assert.equal(page2.body.chats[0].title, 'oldest');
  assert.equal(page2.body.hasMore, false);
  assert.equal(page2.body.nextCursor, null);
});

test('a chat with no runs falls back to its own title with null meta', async () => {
  const uid = newId();
  const chat = await Chat.create({ userId: uid, title: 'no runs yet' });

  const res = await invoke(chatCtrl.listChats, { user: { _id: uid }, query: {} });
  const row = res.body.chats.find((c) => String(c._id) === String(chat._id));
  assert.ok(row);
  assert.equal(row.title, 'no runs yet');
  assert.equal(row.componentType, null);
  assert.equal(row.gatesPassed, null);
  assert.equal(row.sizeKb, null);
});
