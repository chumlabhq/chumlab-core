const mongoose = require('mongoose');

const STATUSES = ['queued', 'running', 'needs_input', 'done', 'error'];

const pipelineRunSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    chatId: { type: mongoose.Schema.Types.ObjectId, ref: 'Chat', required: true, index: true },
    status: { type: String, enum: STATUSES, default: 'queued', index: true },
    stages: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

const PipelineRun = mongoose.model('PipelineRun', pipelineRunSchema);

PipelineRun.STATUSES = STATUSES;

module.exports = PipelineRun;
