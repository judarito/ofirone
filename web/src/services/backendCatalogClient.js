import { getBackendSession } from './backendAuthClient'
const BASE=(import.meta.env.VITE_BACKEND_API_URL||'').replace(/\/+$/,'')
async function request(path,method='GET',body){const token=getBackendSession()?.accessToken;if(!BASE||!token)throw new Error(!BASE?'VITE_BACKEND_API_URL no configurado.':'Sesión requerida para catálogo.');const r=await fetch(`${BASE}${path}`,{method,headers:{accept:'application/json','content-type':'application/json',authorization:`Bearer ${token}`},...(body?{body:JSON.stringify(body)}:{})});const p=await r.json().catch(()=>({}));if(!r.ok)throw new Error(p?.message||`Backend respondió ${r.status}.`);return p}
export const createBackendProduct=p=>request('/api/v1/products','POST',p)
export const listBackendProducts=(q={})=>request(`/api/v1/products?${new URLSearchParams({limit:String(q.limit||100),...(q.search?{search:q.search}:{})})}`)
export const updateBackendProduct=(id,p)=>request(`/api/v1/products/${id}`,'PATCH',p)
export const deleteBackendProduct=id=>request(`/api/v1/products/${id}`,'DELETE')
export const createBackendVariant=v=>request('/api/v1/variants','POST',v)
export const updateBackendVariant=(id,v)=>request(`/api/v1/variants/${id}`,'PATCH',v)
export const deleteBackendVariant=id=>request(`/api/v1/variants/${id}`,'DELETE')
