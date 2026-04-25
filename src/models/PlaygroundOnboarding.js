const mongoose = require('mongoose');

const ROLES = ['student', 'developer', 'designer', 'founder', 'company', 'other'];
const BUDGET_TIERS = ['none', 'low', 'medium', 'high', 'enterprise'];

const playgroundOnboardingSchema = new mongoose.Schema(
  {
    googleSub: { type: String, required: true, unique: true, index: true },
    user: {
      name: { type: String, required: true, trim: true, maxlength: 120 },
      email: { type: String, required: true, trim: true, lowercase: true, maxlength: 200, index: true },
      initials: { type: String, trim: true, maxlength: 4 },
      picture: { type: String, trim: true, maxlength: 500 },
    },
    role: { type: String, enum: ROLES, required: true },
    context: { type: String, required: true, trim: true, maxlength: 80 },
    contextLabel: { type: String, required: true, trim: true, maxlength: 200 },
    budgetTier: { type: String, enum: BUDGET_TIERS, required: true },
    budgetLabel: { type: String, required: true, trim: true, maxlength: 200 },
    organization: { type: String, trim: true, maxlength: 200, default: '' },
    phone: { type: String, trim: true, maxlength: 32, default: '' },
    requirements: { type: String, trim: true, maxlength: 500, default: '' },
    position: { type: Number, index: true },
    status: {
      type: String,
      enum: ['waiting', 'invited', 'onboarded', 'rejected'],
      default: 'waiting',
      index: true,
    },
    invitedAt: { type: Date, default: null },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

const PlaygroundOnboarding = mongoose.model('PlaygroundOnboarding', playgroundOnboardingSchema);

PlaygroundOnboarding.ROLES = ROLES;
PlaygroundOnboarding.BUDGET_TIERS = BUDGET_TIERS;

module.exports = PlaygroundOnboarding;
