import { createLookupsRepositoryAdapter } from '../../../shared/contracts/lookupsRepository.js'
import backendLookupsRepository from './adapters/backendLookups.repository'
import supabaseLookupsRepository from './adapters/supabaseLookups.repository'

const lookupsService = createLookupsRepositoryAdapter({
  primary: backendLookupsRepository,
  fallback: supabaseLookupsRepository,
  usePrimary: import.meta.env.VITE_USE_BACKEND_LOOKUPS === 'true',
})

export default lookupsService
