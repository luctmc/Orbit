export const PLUGIN_RUNTIME_LIMITS={messageBytes:64*1024,queued:16,timeoutMs:2000,eventsPerSecond:100} as const
/** Static trusted controller satisfies the app CSP; no plugin source is inserted into HTML. */
export function pluginDocument(assetUrl:string):string {
 const url=new URL(assetUrl)
 if(!['http:','https:','tauri:'].includes(url.protocol)||url.pathname!=='/orbit-plugin-host.js'||/[<>"'\\]/.test(assetUrl))throw new Error('URL do host de plugins inválida')
 return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src ${url.href} blob:; worker-src blob:; connect-src 'none'; img-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-src 'none'"><style>body{margin:0;padding:12px;color:#dedee4;background:#17171d;font:13px system-ui}h3{font-size:14px}pre{white-space:pre-wrap;overflow-wrap:anywhere}button{color:inherit;background:#303039;border:1px solid #555566;border-radius:6px;padding:8px;margin:4px}section{padding:8px 0;border-bottom:1px solid #303039}</style></head><body><script src="${url.href}"></script></body></html>`
}
/** Do not stringify arbitrary plugin objects on the UI thread (a nested clone can be huge). */
export function validPluginReply(data:unknown,channel:string):data is {channel:string;kind:'ready'|'result'|'error';requestId?:string;ok?:boolean;text?:string}{
 if(!data||typeof data!=='object')return false
 const m=data as Record<string,unknown>
 return m.channel===channel&&(m.kind==='ready'||m.kind==='error'&&typeof m.text==='string'&&m.text.length<=1000||m.kind==='result'&&typeof m.requestId==='string'&&m.requestId.length<=100&&typeof m.ok==='boolean'&&typeof m.text==='string'&&m.text.length<=8192)
}
