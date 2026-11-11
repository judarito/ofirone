import { getBackendSession } from './backendAuthClient'
const BASE_URL=(import.meta.env.VITE_BACKEND_API_URL||'').replace(/\/+$/,'')
async function request(path,options={}){const token=getBackendSession()?.accessToken;if(!BASE_URL)throw new Error('VITE_BACKEND_API_URL no configurado.');if(!token)throw new Error('Sesión requerida para CXC.');const r=await fetch(`${BASE_URL}${path}`,{...options,headers:{accept:'application/json','content-type':'application/json',authorization:`Bearer ${token}`,...(options.headers||{})}});const p=await r.json().catch(()=>({}));if(!r.ok)throw new Error(p?.message||`Backend respondió ${r.status}.`);return p}
export const listBackendReceivables=({limit=25,afterId}={})=>{const q=new URLSearchParams({limit:String(limit)});if(afterId)q.set('after_id',afterId);return request(`/api/v1/receivables?${q}`)}
export const createBackendReceivablePayment=(payload)=>request('/api/v1/receivables/payments',{method:'POST',body:JSON.stringify(payload)})
export const getBackendReceivable=(accountId)=>request(`/api/v1/receivables/${encodeURIComponent(accountId)}`)
export const upsertBackendReceivable=(payload)=>request('/api/v1/receivables',{method:'PUT',body:JSON.stringify(payload)})
export const createBackendReceivableCharge=(payload)=>request('/api/v1/receivables/charges',{method:'POST',body:JSON.stringify(payload)})
export const listBackendReceivableMovements=({accountId,limit=25,afterOccurredAt,afterId}={})=>{const q=new URLSearchParams({limit:String(limit)});if(afterOccurredAt)q.set('after_occurred_at',afterOccurredAt);if(afterId)q.set('after_id',afterId);return request(`/api/v1/receivables/${encodeURIComponent(accountId)}/movements?${q}`)}
export const getBackendReceivableSummary=()=>request('/api/v1/receivables/summary')
