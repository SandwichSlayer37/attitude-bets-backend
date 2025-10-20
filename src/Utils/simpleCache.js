// src/utils/simpleCache.js
const cache = new Map();

function setCache(key, value, ttlMs = 60000) {
  cache.set(key, { value, expires: Date.now() + ttlMs });
  return value;
}

function getCache(key) {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() > hit.expires) {
    cache.delete(key);
    return null;
  }
  return hit.value;
}

module.exports = { setCache, getCache };