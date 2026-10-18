import {createHash} from 'node:crypto'
/** Refresh timestamps are not model/capability changes and must not invalidate harness evidence. */
export function catalogRevision(catalog:unknown):string {
 return createHash('sha256').update(JSON.stringify(catalog,(key,value)=>['observedAt','expiresAt','reason'].includes(key)?undefined:value)).digest('hex')
}
