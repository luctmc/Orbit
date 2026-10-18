import type { ContextUsage } from '@orbit/protocol'
const count=(v:unknown):v is number=>Number.isSafeInteger(v)&&Number(v)>=0
const percentage=(v:unknown):v is number=>typeof v==='number'&&Number.isFinite(v)&&v>=0
export function unavailableContext(source:string,observedAt=Date.now()):ContextUsage{return {kind:'unavailable',usedTokens:null,capacityTokens:null,percent:null,categories:[],source,observedAt}}
export function claudeContext(raw:any,now:number):ContextUsage{
 const capacity=count(raw?.context_window_size)&&raw.context_window_size>0?raw.context_window_size:null
 if(percentage(raw?.used_percentage))return {kind:'measured',usedTokens:null,capacityTokens:capacity,percent:raw.used_percentage,categories:[],source:'claude:context_window.used_percentage',observedAt:now}
 const current=raw?.current_usage
 const keys=['input_tokens','cache_creation_input_tokens','cache_read_input_tokens'] as const
 if(capacity&&current&&keys.every(k=>count(current[k]))){const used=keys.reduce((sum,k)=>sum+current[k],0);return {kind:'estimated',usedTokens:used,capacityTokens:capacity,percent:Math.round(used/capacity*100),categories:[],source:'claude:current_usage',observedAt:now}}
 return unavailableContext('claude:context_window',now)
}
export function codexContext(info:any,now:number):ContextUsage{
 const capacity=info?.model_context_window,used=info?.last_token_usage?.input_tokens
 if(!count(capacity)||capacity<=0||!count(used))return unavailableContext('codex:last_token_usage',now)
 return {kind:'estimated',usedTokens:used,capacityTokens:capacity,percent:Math.round(used/capacity*100),categories:[],source:'codex:last_token_usage',observedAt:now}
}
