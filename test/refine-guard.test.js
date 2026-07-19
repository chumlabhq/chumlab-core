const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

// Stub the two external seams BEFORE requiring the controller, which destructures
// runPipeline at load (same ordering the orchestrator integration test relies on).
// - runPipeline is faked so "the pipeline ran" is just a call count, no LLM.
// - anthropic.sendMessage is the classifier's only call; each test drives it, and
//   a flag proves whether the classifier was invoked at all.
const anthropic = require('../src/ai/anthropic');
const orchestrator = require('../src/ai/orchestrator');

let pipelineCalls = 0;
orchestrator.runPipeline = async () => {
  pipelineCalls += 1;
  return {
    status: 'ok',
    text: '```tsx\nexport default () => null;\n```',
    roundsUsed: 0,
    verifyStatus: 'passed',
    attempts: [],
    qaVerdict: null,
    deliverMeta: null,
    timeline: null,
  };
};

let classifierInvoked = false;
let sendMessageImpl = async () => {
  throw new Error('sendMessageImpl not configured for this test');
};
anthropic.sendMessage = async (...args) => {
  classifierInvoked = true;
  return sendMessageImpl(...args);
};

const generationCtrl = require('../src/controllers/generation.controller');
const Chat = require('../src/models/Chat');
const Message = require('../src/models/Message');

let mongod;

before(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
});

after(async () => {
  await mongoose.disconnect();
  if (mongod) await mongod.stop();
});

beforeEach(() => {
  pipelineCalls = 0;
  classifierInvoked = false;
});

const newId = () => new mongoose.Types.ObjectId();

// Drive an SSE controller directly: capture the emitted events and resolve when
// the handler ends the stream (or rejects if it funnels an error to next).
function invokeSSE(handler, req) {
  return new Promise((resolve, reject) => {
    const res = {
      headers: {},
      events: [],
      ended: false,
      setHeader(k, v) {
        this.headers[k] = v;
      },
      flushHeaders() {},
      write(chunk) {
        const m = /^data: (.*)\n\n$/s.exec(chunk);
        if (m) this.events.push(JSON.parse(m[1]));
      },
      end() {
        this.ended = true;
        resolve(this);
      },
      status() {
        return this;
      },
      json() {},
    };
    handler(req, res, (err) => (err ? reject(err) : resolve(res)));
  });
}

async function seedChatWithComponent(uid) {
  const chat = await Chat.create({ userId: uid, title: 'Pricing card' });
  await Message.create({ chatId: chat._id, role: 'user', content: 'build a pricing card' });
  await Message.create({
    chatId: chat._id,
    role: 'assistant',
    content:
      '```tsx\nexport default function Pricing(){ return <div className="border-accent">Popular</div>; }\n```',
  });
  return chat;
}

const req = (uid, body) => ({ user: { _id: uid }, body });

test('refine edit → pipeline runs, no answer turn', async () => {
  const uid = newId();
  const chat = await seedChatWithComponent(uid);
  sendMessageImpl = async () => JSON.stringify({ intent: 'edit' });

  const res = await invokeSSE(generationCtrl.generate, req(uid, {
    chatId: String(chat._id),
    prompt: 'make the badge smaller',
  }));

  assert.equal(classifierInvoked, true, 'classifier runs on the refine path');
  assert.equal(pipelineCalls, 1, 'the full pipeline runs for a real edit');
  assert.ok(!res.events.some((e) => e.payload && e.payload.outcome === 'answer'));
});

test('genuine no-op → answer turn, no rebuild', async () => {
  const uid = newId();
  const chat = await seedChatWithComponent(uid);
  const reply = 'The middle tier is already highlighted — accent border + Popular badge.';
  sendMessageImpl = async () => JSON.stringify({ intent: 'noop', message: reply });

  const res = await invokeSSE(generationCtrl.generate, req(uid, {
    chatId: String(chat._id),
    prompt: 'highlight the middle tier',
  }));

  assert.equal(pipelineCalls, 0, 'no rebuild for a no-op');
  const answer = res.events.find((e) => e.payload && e.payload.outcome === 'answer');
  assert.ok(answer, 'an answer router event is emitted');
  assert.equal(answer.stage, 'router');
  assert.equal(answer.status, 'done');
  assert.equal(answer.payload.message, reply);

  const assistant = await Message.findOne({ chatId: chat._id, role: 'assistant' }).sort({
    createdAt: -1,
  });
  assert.equal(assistant.content, reply, 'the answer is persisted as an assistant turn');
});

test('question → answer turn, no rebuild', async () => {
  const uid = newId();
  const chat = await seedChatWithComponent(uid);
  const reply = 'It uses an accent border to mark the popular tier.';
  sendMessageImpl = async () => JSON.stringify({ intent: 'question', message: reply });

  const res = await invokeSSE(generationCtrl.generate, req(uid, {
    chatId: String(chat._id),
    prompt: 'why is the middle one highlighted?',
  }));

  assert.equal(pipelineCalls, 0, 'no rebuild for a question');
  assert.ok(res.events.some((e) => e.payload && e.payload.outcome === 'answer'));
});

test('ambiguous classification → edit → pipeline runs', async () => {
  const uid = newId();
  const chat = await seedChatWithComponent(uid);
  // Unrecognised intent — classifyFollowup degrades this to edit.
  sendMessageImpl = async () => JSON.stringify({ intent: 'maybe', message: 'x' });

  const res = await invokeSSE(generationCtrl.generate, req(uid, {
    chatId: String(chat._id),
    prompt: 'tweak it a bit',
  }));

  assert.equal(pipelineCalls, 1, 'anything ambiguous rebuilds');
  assert.ok(!res.events.some((e) => e.payload && e.payload.outcome === 'answer'));
});

test('classifier failure on the refine path → edit → pipeline runs', async () => {
  const uid = newId();
  const chat = await seedChatWithComponent(uid);
  sendMessageImpl = async () => {
    throw new Error('boom');
  };

  await invokeSSE(generationCtrl.generate, req(uid, {
    chatId: String(chat._id),
    prompt: 'make it blue',
  }));

  assert.equal(pipelineCalls, 1, 'a classifier failure never blocks the rebuild');
});

test('fresh build (no prior code) never invokes the classifier', async () => {
  const uid = newId();
  sendMessageImpl = async () => JSON.stringify({ intent: 'noop', message: 'should not be used' });

  const res = await invokeSSE(generationCtrl.generate, req(uid, {
    prompt: 'build a pricing card',
  }));

  assert.equal(classifierInvoked, false, 'first build skips the guard entirely');
  assert.equal(pipelineCalls, 1, 'the pipeline runs as today');
  assert.ok(!res.events.some((e) => e.payload && e.payload.outcome === 'answer'));
});
