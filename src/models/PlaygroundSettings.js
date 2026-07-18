const mongoose = require('mongoose');

// Phase 10 · per-user playground appearance (C4). Appearance only in v1 — gates
// stay always-on and are NOT user-disableable (Decision 2), so no gate flags
// live here. Defaults when absent: light / mobile.
const PREVIEW_THEMES = ['light', 'dark', 'system'];
const PREVIEW_DEVICES = ['mobile', 'tablet', 'fill'];

const DEFAULTS = { previewTheme: 'light', previewDevice: 'mobile' };

const playgroundSettingsSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true,
      index: true,
    },
    previewTheme: { type: String, enum: PREVIEW_THEMES, default: DEFAULTS.previewTheme },
    previewDevice: { type: String, enum: PREVIEW_DEVICES, default: DEFAULTS.previewDevice },
  },
  { timestamps: true }
);

const PlaygroundSettings = mongoose.model('PlaygroundSettings', playgroundSettingsSchema);

PlaygroundSettings.PREVIEW_THEMES = PREVIEW_THEMES;
PlaygroundSettings.PREVIEW_DEVICES = PREVIEW_DEVICES;
PlaygroundSettings.DEFAULTS = DEFAULTS;

module.exports = PlaygroundSettings;
