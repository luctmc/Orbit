import { DEFAULT_ROUTING } from '../../../packages/sidecar/src/routing.ts'
const now=Date.now()-60000
const usage={input:6200,output:1800,cacheRead:0,cacheWrite:0,total:8000,costUsd:null}
const workspace={id:'preview-workspace',name:'Orbit',path:'/projetos/orbit',folders:['/projetos/orbit'],instructions:'',lastOpenedAt:now}
const mission={id:'preview-mission',workspaceId:workspace.id,title:'Refinar a experiência do Orbit',objective:'Terminais, configurações e contexto de trabalho em uma bancada consistente.',mode:'agentica',status:'active',squadId:null,usage,git:null,scheduleId:null,allowedClis:['claude','codex'],readyAt:null,readySummary:null,notes:[],budget:null,createdAt:now,updatedAt:now}
const panes=[{id:21,role:'lead',cli:'codex',model:'gpt-6.1-sol',effort:'medium',title:'Piloto · experiência do produto',status:'waiting'}, {id:22,role:'crew',cli:'claude',model:'claude-haiku-5-5',effort:'low',title:'Verificar build e testes',status:'running'}].map(p=>({...p,missionId:mission.id,squadRole:null,taskType:null,accountId:null,sessionId:null,branch:null,cwd:workspace.path,attention:p.role==='lead'?'Qual é o objetivo desta missão?':null,choices:p.role==='lead'?['Continuar','Somente leitura']:null,deliveredAt:null,handoffStatus:null,assignedBy:null,usage,contextPercent:12,pid:null,exitCode:null,createdAt:now}))
const snapshot={workspaces:[workspace],missions:[mission],panes,events:[],squads:[],routing:structuredClone(DEFAULT_ROUTING),usageDays:[],limits:[],accounts:[],cards:[],templates:[],schedules:[],settings:{resumeOnStart:true,smartClassify:false,agentsInEnglish:true,agentToolProfile:'orbit'},proposals:[]}
const progress={missionId:mission.id,observedAt:Date.now(),activities:[],attempts:[],results:[],verifications:[],deliveries:[],validation:[],integration:{state:'none',reviewId:null,reason:null,checkedAt:null}}

export {snapshot,progress}
export function respond(m) {
 if(m.type==='mission.progress')return {type:m.type,requestId:m.requestId,progress}
 if(m.type==='pane.attach')return {type:'pane.snapshot',paneId:m.paneId,cols:80,rows:24,data:Array.from({length:160},(_,i)=>`Linha ${i+1} · sessão sintética ${m.paneId}\r\n`).join('')}
 if(m.type==='pane.submit')return {type:'pane.submitted',paneId:m.paneId,requestId:m.requestId}
}
