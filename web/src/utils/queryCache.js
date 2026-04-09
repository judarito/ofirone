const CACHE_PREFIX = 'query_cache::'
const CACHE_VERSION = 1

const memoryCache = new Map()
const pendingLoads = new Map()

const canUseSessionStorage = () => (
  typeof window !== 'undefined' &&
  typeof window.sessionStorage !== 'undefined'
)

const getScopedKey = (tenantId, key) => {
  const scope = tenantId || 'global'
  return `${scope}::${key}`
}

const getStorageKey = (scopedKey) => `${CACHE_PREFIX}${scopedKey}`

const isEntryShapeValid = (entry) => (
  entry &&
  entry.version === CACHE_VERSION &&
  typeof entry.key === 'string' &&
  Object.prototype.hasOwnProperty.call(entry, 'data')
)

const isExpired = (entry, now = Date.now()) => (
  !entry?.expiresAt || now >= entry.expiresAt
)

const isStale = (entry, now = Date.now()) => (
  !entry?.staleAt || now >= entry.staleAt
)

const normalizeTags = (tags) => (
  Array.isArray(tags)
    ? [...new Set(tags.map((tag) => String(tag || '').trim()).filter(Boolean))]
    : []
)

const safeParse = (rawValue) => {
  if (!rawValue) return null
  try {
    const parsed = JSON.parse(rawValue)
    return isEntryShapeValid(parsed) ? parsed : null
  } catch (_error) {
    return null
  }
}

class QueryCache {
  _saveToMemory(entry) {
    memoryCache.set(entry.key, entry)
  }

  _saveToSession(entry, storage) {
    if (storage !== 'session' || !canUseSessionStorage()) return
    try {
      window.sessionStorage.setItem(getStorageKey(entry.key), JSON.stringify(entry))
    } catch (error) {
      console.warn('No se pudo guardar cache en sessionStorage:', error.message)
    }
  }

  _removeFromSession(scopedKey) {
    if (!canUseSessionStorage()) return
    try {
      window.sessionStorage.removeItem(getStorageKey(scopedKey))
    } catch (_error) {
      // No-op
    }
  }

  _readFromSession(scopedKey, storage) {
    if (storage !== 'session' || !canUseSessionStorage()) return null

    const entry = safeParse(window.sessionStorage.getItem(getStorageKey(scopedKey)))
    if (!entry) {
      this._removeFromSession(scopedKey)
      return null
    }

    if (isExpired(entry)) {
      this._removeFromSession(scopedKey)
      return null
    }

    memoryCache.set(scopedKey, entry)
    return entry
  }

  _getEntry(scopedKey, storage) {
    const memoryEntry = memoryCache.get(scopedKey)
    if (memoryEntry) {
      if (isExpired(memoryEntry)) {
        memoryCache.delete(scopedKey)
      } else {
        return memoryEntry
      }
    }

    return this._readFromSession(scopedKey, storage)
  }

  _buildEntry(scopedKey, data, options = {}) {
    const ttlMs = Math.max(0, Number(options.ttlMs || 0))
    const swrMs = Math.max(0, Number(options.swrMs || 0))
    const now = Date.now()

    return {
      version: CACHE_VERSION,
      key: scopedKey,
      tenantId: options.tenantId || null,
      data,
      tags: normalizeTags(options.tags),
      storage: options.storage || 'memory',
      fetchedAt: now,
      staleAt: now + ttlMs,
      expiresAt: now + ttlMs + swrMs,
    }
  }

  async _loadAndStore(scopedKey, loader, options = {}) {
    const pending = pendingLoads.get(scopedKey)
    if (pending) return pending

    const task = (async () => {
      const data = await loader()
      const shouldCache = typeof options.shouldCache === 'function'
        ? options.shouldCache(data)
        : true

      if (shouldCache && Number(options.ttlMs || 0) > 0) {
        const entry = this._buildEntry(scopedKey, data, options)
        this._saveToMemory(entry)
        this._saveToSession(entry, options.storage)
      }

      return data
    })()

    pendingLoads.set(scopedKey, task)

    try {
      return await task
    } finally {
      pendingLoads.delete(scopedKey)
    }
  }

  _refreshInBackground(scopedKey, loader, options = {}) {
    if (pendingLoads.has(scopedKey)) return
    this._loadAndStore(scopedKey, loader, options).catch((error) => {
      console.warn('Background cache refresh failed:', error?.message || error)
    })
  }

  async getOrLoad(key, loader, options = {}) {
    const scopedKey = getScopedKey(options.tenantId, key)
    const storage = options.storage || 'memory'

    if (options.forceRefresh) {
      return this._loadAndStore(scopedKey, loader, options)
    }

    const cachedEntry = this._getEntry(scopedKey, storage)
    if (cachedEntry) {
      if (!isStale(cachedEntry)) {
        return cachedEntry.data
      }

      if (Number(options.swrMs || 0) > 0) {
        this._refreshInBackground(scopedKey, loader, options)
        return cachedEntry.data
      }
    }

    return this._loadAndStore(scopedKey, loader, options)
  }

  prime(key, data, options = {}) {
    const ttlMs = Math.max(0, Number(options.ttlMs || 0))
    if (ttlMs <= 0) return data

    const scopedKey = getScopedKey(options.tenantId, key)
    const entry = this._buildEntry(scopedKey, data, options)
    this._saveToMemory(entry)
    this._saveToSession(entry, options.storage)
    return data
  }

  peek(key, options = {}) {
    const scopedKey = getScopedKey(options.tenantId, key)
    const entry = this._getEntry(scopedKey, options.storage || 'memory')
    if (!entry) return null
    if (!options.allowStale && isStale(entry)) return null
    return entry.data
  }

  invalidate(key, options = {}) {
    const scopedKey = getScopedKey(options.tenantId, key)
    memoryCache.delete(scopedKey)
    pendingLoads.delete(scopedKey)
    this._removeFromSession(scopedKey)
  }

  invalidateByTags(tags, options = {}) {
    const normalizedTags = normalizeTags(tags)
    if (normalizedTags.length === 0) return

    for (const [scopedKey, entry] of memoryCache.entries()) {
      if (options.tenantId && entry.tenantId !== options.tenantId) continue
      if (entry.tags?.some((tag) => normalizedTags.includes(tag))) {
        this.invalidate(entry.key.replace(/^[^:]+::/, ''), { tenantId: entry.tenantId })
      }
    }

    if (!canUseSessionStorage()) return

    const keysToRemove = []
    for (let index = 0; index < window.sessionStorage.length; index += 1) {
      const storageKey = window.sessionStorage.key(index)
      if (!storageKey?.startsWith(CACHE_PREFIX)) continue
      const entry = safeParse(window.sessionStorage.getItem(storageKey))
      if (!entry) {
        keysToRemove.push(storageKey)
        continue
      }
      if (options.tenantId && entry.tenantId !== options.tenantId) continue
      if (entry.tags?.some((tag) => normalizedTags.includes(tag))) {
        keysToRemove.push(storageKey)
      }
    }

    keysToRemove.forEach((storageKey) => {
      try {
        window.sessionStorage.removeItem(storageKey)
      } catch (_error) {
        // No-op
      }
    })
  }

  clearTenantScope(tenantId) {
    if (!tenantId) return

    for (const [scopedKey, entry] of memoryCache.entries()) {
      if (entry.tenantId === tenantId) {
        memoryCache.delete(scopedKey)
        pendingLoads.delete(scopedKey)
      }
    }

    if (!canUseSessionStorage()) return

    const keysToRemove = []
    for (let index = 0; index < window.sessionStorage.length; index += 1) {
      const storageKey = window.sessionStorage.key(index)
      if (!storageKey?.startsWith(CACHE_PREFIX)) continue
      const entry = safeParse(window.sessionStorage.getItem(storageKey))
      if (!entry || entry.tenantId === tenantId) {
        keysToRemove.push(storageKey)
      }
    }

    keysToRemove.forEach((storageKey) => {
      try {
        window.sessionStorage.removeItem(storageKey)
      } catch (_error) {
        // No-op
      }
    })
  }

  clearAll() {
    memoryCache.clear()
    pendingLoads.clear()

    if (!canUseSessionStorage()) return

    const keysToRemove = []
    for (let index = 0; index < window.sessionStorage.length; index += 1) {
      const storageKey = window.sessionStorage.key(index)
      if (storageKey?.startsWith(CACHE_PREFIX)) {
        keysToRemove.push(storageKey)
      }
    }

    keysToRemove.forEach((storageKey) => {
      try {
        window.sessionStorage.removeItem(storageKey)
      } catch (_error) {
        // No-op
      }
    })
  }
}

export default new QueryCache()
