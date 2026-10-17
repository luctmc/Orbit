// Deterministic terminal test double, isolated from all account files and provider APIs.
process.stdin.setRawMode(true)
process.stdin.resume()
process.stdout.write('\x1b[?2004hOrbit · agente de teste\r\nPronto para receber uma mensagem.\r\n')
void fetch(process.env.ORBIT_HOOK_URL,{method:'POST',headers:{Authorization:`Bearer ${process.env.ORBIT_PANE_TOKEN}`,'Content-Type':'application/json'},body:JSON.stringify({hook_event_name:'SessionStart'})})
let draft=''
process.stdin.on('data',bytes=>{let text=String(bytes);draft+=text;if(text.includes('\r')){process.stdout.write('\r\nRecebido uma vez: '+draft.replace(/\x1b\[20[01]~/g,'').replace(/[\r\n]+/g,' ').slice(0,200)+'\r\n');draft=''}})
