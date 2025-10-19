// src/utils/simpleCache.js
const cache = new Map();

function setCache(key, value, ttlMs = 60000) {
  cache.set(key, { value, expires: Date.now() + ttlMs });
  return value;
}

function getCache(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expires) {
    cache.delete(key);
    return null;
  }
  return entry.value;
}

module.exports = { setCache, getCache };
