// CJS stub for nanoid v5 (pure ESM, uses import.meta — incompatible with Metro).
// Uses crypto.getRandomValues when available, falls back to Math.random.
const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

function nanoid(size) {
  size = size || 21;
  var id = '';
  var bytes;
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    bytes = crypto.getRandomValues(new Uint8Array(size));
    for (var i = 0; i < size; i++) {
      id += CHARS[bytes[i] & 63];
    }
  } else {
    for (var j = 0; j < size; j++) {
      id += CHARS[Math.floor(Math.random() * 64)];
    }
  }
  return id;
}

module.exports = nanoid;
module.exports.nanoid = nanoid;
module.exports.default = nanoid;
