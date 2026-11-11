// Limitador de tasa simple en memoria (ventana fija deslizante por clave).
// Suficiente para el gateway inicial; en producción multi-instancia se
// reemplaza por uno compartido (Redis/Postgres) conservando esta interfaz.

export function createRateLimiter({ max = 300, windowMs = 60_000, now = () => Date.now() } = {}) {
  const buckets = new Map(); // key -> { count, windowStart }

  function prune(currentNow) {
    for (const [key, bucket] of buckets) {
      if (currentNow - bucket.windowStart >= windowMs) buckets.delete(key);
    }
  }

  function allow(key, currentNow = now()) {
    prune(currentNow);
    const bucket = buckets.get(key);
    if (!bucket || currentNow - bucket.windowStart >= windowMs) {
      buckets.set(key, { count: 1, windowStart: currentNow });
      return { allowed: true, retryAfterMs: 0 };
    }
    if (bucket.count >= max) {
      return {
        allowed: false,
        retryAfterMs: Math.max(0, bucket.windowStart + windowMs - currentNow),
      };
    }
    bucket.count += 1;
    return { allowed: true, retryAfterMs: 0 };
  }

  return { allow, _buckets: buckets };
}
