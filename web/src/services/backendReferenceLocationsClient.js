import { getBackendSession } from './backendAuthClient'
const configuredBase=import.meta.env.VITE_BACKEND_API_URL||''
const base=configuredBase==='/'?'':configuredBase.replace(/\/+$/,'')
async function request(kind,id,method='GET',body,query={}){const token=getBackendSession()?.accessToken;if(!configuredBase||!token)throw new Error(!configuredBase?'VITE_BACKEND_API_URL no configurado.':'Sesión requerida para maestros.');const p=new URLSearchParams({limit:String(query.limit||25)});if(query.afterId)p.set('after_id',query.afterId);const r=await fetch(`${base}/api/v1/${kind}${id?`/${id}`:''}${method==='GET'&&!id?`?${p}`:''}`,{method,headers:{accept:'application/json',authorization:`Bearer ${token}`,...(body?{'content-type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});if(r.status===204)return null;const out=await r.json().catch(()=>({}));if(!r.ok)throw new Error(out.message||`Backend respondió ${r.status}.`);return out}
const client=kind=>({list:q=>request(kind,null,'GET',undefined,q),get:id=>request(kind,id),create:b=>request(kind,null,'POST',b),update:(id,b)=>request(kind,id,'PATCH',b),deactivate:id=>request(kind,id,'DELETE')})
export const backendLocations=client('locations')
export const backendPaymentMethods=client('payment-methods')
