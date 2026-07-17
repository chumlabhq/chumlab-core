const ApiError = require('../utils/ApiError');

// v1 inlines images as base64 in the generation request (an Anthropic image
// block on the user turn) - no upload/store service. The route-scoped JSON
// limit on /generate accommodates the payload; nginx limits are Phase 10.
// This module owns validation + shaping the image into model/message form.
const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

// Accepts { mediaType, data } where data is raw base64 or a data URL.
// Returns { mediaType, data } with the data-URL prefix stripped, or throws.
function normalizeImage(image) {
  if (!image) return null;
  const { mediaType, data } = image;
  if (!ALLOWED_IMAGE_TYPES.includes(mediaType)) {
    throw new ApiError(400, `image type must be one of ${ALLOWED_IMAGE_TYPES.join(', ')}`);
  }
  if (typeof data !== 'string' || !data) {
    throw new ApiError(400, 'image data is required');
  }
  const base64 = data.includes(',') ? data.slice(data.indexOf(',') + 1) : data;
  if (base64.length * 0.75 > MAX_IMAGE_BYTES) {
    throw new ApiError(400, 'image is too large - downscale before sending');
  }
  return { mediaType, data: base64 };
}

function toImageBlock(image) {
  return {
    type: 'image',
    source: { type: 'base64', media_type: image.mediaType, data: image.data },
  };
}

// A user-turn content value: a plain string when there's no image, or a
// multimodal [image, text] block array when there is.
function toUserContent(text, image) {
  if (!image) return text;
  return [toImageBlock(image), { type: 'text', text }];
}

module.exports = { ALLOWED_IMAGE_TYPES, normalizeImage, toImageBlock, toUserContent };
