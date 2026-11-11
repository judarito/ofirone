const BASE = import.meta.env.VITE_BACKEND_API_URL || ''
export const USE_BACKEND_PURCHASES = import.meta.env.VITE_USE_BACKEND_PURCHASES === 'true'
const sessionKey = 'ofirone_backend_session'
function token(){ try{return JSON.parse(localStorage.getItem(sessionKey)||'null')?.accessToken||''}catch(_){return ''} }
async function request(path, options={}){ const response=await fetch(`${BASE.replace(/\/+$/,'')}${path}`,{...options,headers:{accept:'application/json',...(options.body?{'content-type':'application/json'}:{}),authorization:`Bearer ${token()}`,...options.headers}}); const data=await response.json().catch(()=>({})); if(!response.ok) throw new Error(data.message||`Backend respondió ${response.status}.`); return data }
export async function listBackendPurchases({limit=20,afterPurchasedAt='',afterId=''}={}){ return request(`/api/v1/purchases?limit=${limit}${afterPurchasedAt?`&after_purchased_at=${encodeURIComponent(afterPurchasedAt)}&after_id=${encodeURIComponent(afterId)}`:''}`) }
export async function createBackendPurchase(payload){ return request('/api/v1/purchases',{method:'POST',body:JSON.stringify(payload)}) }
export async function getBackendPurchase(id){ return request(`/api/v1/purchases/${encodeURIComponent(id)}`) }
export async function cancelBackendPurchase(id){ return request(`/api/v1/purchases/${encodeURIComponent(id)}`,{method:'POST'}) }
