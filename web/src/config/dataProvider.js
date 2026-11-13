/**
 * Single application-level data source selector.
 *
 * `go` is the production mode. `hybrid` exists only while the migration is
 * being completed, and `supabase` keeps the legacy path available locally.
 */
const configured = String(import.meta.env.VITE_DATA_PROVIDER || '').trim().toLowerCase()

export const DATA_PROVIDER = ['go', 'hybrid', 'supabase'].includes(configured)
  ? configured
  : 'hybrid'

export const IS_GO_MODE = DATA_PROVIDER === 'go'
export const IS_SUPABASE_MODE = DATA_PROVIDER === 'supabase'

