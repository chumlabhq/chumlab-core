const mongoose = require('mongoose');

const STATUSES = ['queued', 'running', 'needs_input', 'done', 'error'];
const VERIFY_STATUSES = ['passed', 'passed_after_fix', 'delivered_with_warnings'];

const pipelineRunSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    chatId: { type: mongoose.Schema.Types.ObjectId, ref: 'Chat', required: true, index: true },
    status: { type: String, enum: STATUSES, default: 'queued', index: true },
    fixRounds: { type: Number, default: 0 },
    verifyStatus: { type: String, enum: VERIFY_STATUSES, default: null },
    stages: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

const PipelineRun = mongoose.model('PipelineRun', pipelineRunSchema);

PipelineRun.STATUSES = STATUSES;
PipelineRun.VERIFY_STATUSES = VERIFY_STATUSES;

module.exports = PipelineRun;
