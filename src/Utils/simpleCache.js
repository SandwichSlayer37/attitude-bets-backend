// src/utils/simpleCache.js
const cache = {};

function setCache(key, value, ttlSeconds = 600) {
  cache[key] = { value, expires: Date.now() + ttlSeconds * 1000 };
  return value;
}

function getCache(key) {
  const item = cache[key];
  if (!item) return null;
  if (Date.now() > item.expires) {
    delete cache[key];
    return null;
  }
  return item.value;
}

module.exports = { setCache, getCache };