const crypto = require('crypto');

/* Hash de contraseña con scrypt (KDF robusto incluido en Node, sin dependencias
   nativas extra). Formato almacenado: "<salt_hex>:<hash_hex>". */
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  if (!stored || typeof stored !== 'string' || !stored.includes(':')) return false;
  const [salt, hash] = stored.split(':');
  try {
    const hashBuf = Buffer.from(hash, 'hex');
    const testBuf = crypto.scryptSync(String(password), salt, 64);
    if (hashBuf.length !== testBuf.length) return false;
    return crypto.timingSafeEqual(hashBuf, testBuf);
  } catch (e) {
    return false;
  }
}

module.exports = { hashPassword, verifyPassword };
