// Trusted Orbit controller. Plugin source runs only inside its worker, never this document.
window.addEventListener('message',function initialize({source,data}) {
 if(source!==parent||!data||data.kind!=='orbit-plugin-init'||!data.config)return;
 const config=data.config;
 if(typeof config.channel!=='string'||config.channel.length>100||typeof config.code!=='string'||config.code.length>128*1024||!Array.isArray(config.commands)||config.commands.length>32||!Array.isArray(config.panels)||config.panels.length>8||!Array.isArray(config.events)||config.events.length>2)return;
 window.removeEventListener('message',initialize);

 const {channel,panels,code}=config,commands=new Set(config.commands),allowedEvents=new Set(config.events);
 const send=message=>parent.postMessage({channel,...message},'*');
 let worker,ready=false,stopped=false,pending=null,queue=[],counter=0,windowAt=Date.now(),sequence=0;
 const panelNodes=new Map();
 for(const panel of panels){const section=document.createElement('section'),title=document.createElement('h3'),body=document.createElement('pre'),actions=document.createElement('div');title.textContent=panel.title;section.append(title,body,actions);document.body.append(section);panelNodes.set(panel.id,{title,body,actions})}
 function stop(reason){if(stopped)return;stopped=true;worker?.terminate();if(pending)clearTimeout(pending.timer);pending=null;queue=[];send({kind:'error',text:String(reason).slice(0,1000)})}
 function dispatch(message){if(stopped)return;if(queue.length>=16){stop('Fila do plugin cheia');return}queue.push(message);pump()}
 function pump(){if(!ready||pending||stopped||!queue.length)return;const message=queue.shift();pending={...message,timer:setTimeout(()=>stop('Plugin excedeu prazo de 2 s; worker encerrado, sem repetição'),2000)};worker.postMessage(message)}
 try{worker=new Worker(URL.createObjectURL(new Blob(["\n const commands=new Map();let onEvent=()=>{};\n const orbit=Object.freeze({registerCommand:(id,handler)=>{if(typeof id==='string'&&typeof handler==='function')commands.set(id,handler)},onEvent:handler=>{if(typeof handler==='function')onEvent=handler},render:(panel,view)=>self.postMessage({kind:'render',panel,view})});\n self.onmessage=async({data})=>{if(!data||typeof data.requestId!=='string')return;try{let value;if(data.kind==='command'){const handler=commands.get(data.command);if(!handler)throw Error('Comando n\u00e3o registrado');value=await handler()}else if(data.kind==='event'){await onEvent(data.event)}else if(data.kind!=='ping')return;let text=JSON.stringify(value??null);self.postMessage({kind:'result',requestId:data.requestId,ok:true,text:typeof text==='string'?text.slice(0,8192):''})}catch(error){self.postMessage({kind:'result',requestId:data.requestId,ok:false,text:String(error).slice(0,8192)})}};\n "+code+"\n;self.postMessage({kind:'ready'});"],{type:'text/javascript'})))}catch(error){stop('Worker isolado indisponível: '+String(error))}
 if(worker){worker.onerror=event=>stop('Falha no worker do plugin: '+String(event.message??'erro desconhecido').slice(0,300));worker.onmessage=({data})=>{
  if(stopped||!data||typeof data!=='object')return;
  const now=Date.now();if(now-windowAt>1000){counter=0;windowAt=now}if(++counter>100){stop('Plugin excedeu limite de mensagens');return}
  if(data.kind==='ready'){if(ready)return;ready=true;send({kind:'ready'});pump();return}
  if(data.kind==='result'){if(!pending||data.requestId!==pending.requestId||typeof data.ok!=='boolean'||typeof data.text!=='string'||data.text.length>8192){stop('Resposta de plugin inválida');return}clearTimeout(pending.timer);const command=pending.kind==='command';pending=null;if(command)send({kind:'result',requestId:data.requestId,ok:data.ok,text:data.text});pump();return}
  if(data.kind==='render'){
   const node=panelNodes.get(data.panel),view=data.view;if(!node||!view||typeof view.body!=='string'||view.body.length>16000||view.title!==undefined&&(typeof view.title!=='string'||view.title.length>100)||view.actions!==undefined&&(!Array.isArray(view.actions)||view.actions.length>16)){stop('Painel fora do contrato');return}
   const actions=view.actions??[];if(actions.some(action=>!action||typeof action.command!=='string'||!commands.has(action.command)||typeof action.title!=='string'||action.title.length>100)){stop('Ação sem permissão');return}
   node.title.textContent=view.title??panels.find(p=>p.id===data.panel).title;node.body.textContent=view.body;node.actions.replaceChildren();for(const action of actions){const button=document.createElement('button');button.textContent=action.title;button.onclick=()=>dispatch({kind:'command',command:action.command,requestId:'panel-'+(++sequence)});node.actions.append(button)}return
  }
  stop('Mensagem fora do contrato')
 }}
 window.addEventListener('message',({source,data})=>{
  if(source!==parent||!data||data.channel!==channel||stopped)return;
  if(data.kind==='command'&&typeof data.command==='string'&&commands.has(data.command)&&typeof data.requestId==='string'&&data.requestId.length<=100)dispatch({kind:'command',command:data.command,requestId:data.requestId});
  if(data.kind==='event'&&data.event&&allowedEvents.has(data.event.name)){
   const event=data.event;
   // Rebuild the event whitelist; no provider, token, path, prompt or account fields cross.
   if(typeof event.missionId!=='string'||event.missionId.length>100||typeof event.status!=='string'||event.status.length>40)return;
   const clean={name:event.name,missionId:event.missionId,status:event.status};if(event.name==='pane.status.changed'){if(!Number.isSafeInteger(event.paneId))return;clean.paneId=event.paneId}
   dispatch({kind:'event',event:clean,requestId:'event-'+(++sequence)})
  }
 });
 setTimeout(()=>{if(!ready)stop('Inicialização do plugin excedeu 2 s')},2000);
 setInterval(()=>{if(ready&&!stopped&&!pending&&!queue.length)dispatch({kind:'ping',requestId:'ping-'+(++sequence)})},2000);
 window.addEventListener('pagehide',()=>worker?.terminate());
 
});
parent.postMessage({kind:'orbit-plugin-host-ready'},'*');
