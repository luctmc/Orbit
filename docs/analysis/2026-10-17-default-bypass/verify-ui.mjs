import { chromium, webkit } from '/Users/lucas/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright-core/index.mjs'
import { writeFile } from 'node:fs/promises'
const engine=process.argv.includes('--webkit')?'webkit':'chromium'
const browser=await (engine==='webkit'?webkit:chromium).launch({headless:true,executablePath:engine==='webkit'?'/Users/lucas/Library/Caches/ms-playwright/webkit-2359/pw_run.sh':'/Users/lucas/Library/Caches/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-mac-arm64/chrome-headless-shell'})
const page=await browser.newPage({viewport:{width:1440,height:900}}), checks=[], errors=[], measurements=[]
page.on('pageerror',e=>errors.push(e.message))
await page.addInitScript(()=>{window.messages=[];const Native=window.WebSocket;window.WebSocket=class extends Native{send(data){window.messages.push(JSON.parse(data));super.send(data)}}})
function check(name,pass){checks.push({name,pass:!!pass});if(!pass)throw Error(name)}
try {
 await page.goto('http://127.0.0.1:5387');await page.getByRole('button',{name:'Abrir missão Refinar a experiência do Orbit',exact:true}).click();await page.locator('.xterm').first().waitFor();await page.waitForTimeout(600)
 await page.locator('.composer__language summary').click();await page.getByLabel('Autorizar envio do original sem tradução').check();await page.locator('.composer__language summary').click()
 await page.evaluate(()=>window.terminals=[...document.querySelectorAll('.xterm')])
 for(const [width,height] of [[1440,900],[1920,1080],[1024,768],[900,600],[768,1000],[375,1000],[375,667]]) {
  await page.setViewportSize({width,height});await page.waitForTimeout(150)
  const g=await page.evaluate(()=>{const rect=s=>{const r=document.querySelector(s).getBoundingClientRect();return {top:r.top,bottom:r.bottom,height:r.height,width:r.width}};return {head:rect('.pane__head'),terminal:rect('.pane__terminal'),pane:rect('.pane'),composer:rect('.composer'),send:rect('.composer__send'),body:rect('.mission__body'),overflow:document.documentElement.scrollWidth>innerWidth}})
  measurements.push({width,height,...g});check(`single compact toolbar ${width}`,g.head.height<=50);check(`terminal dominates pane ${width}`,g.terminal.height>=g.pane.height*.7);check(`send within viewport ${width}`,g.send.bottom<=height&&g.send.top>=0);check(`no page horizontal overflow ${width}`,!g.overflow);check(`compact composer ${width}`,g.composer.height<=170)
  check(`xterm identity ${width}`,await page.evaluate(()=>window.terminals.every((e,i)=>e===document.querySelectorAll('.xterm')[i])))
  if(engine==='chromium')await page.screenshot({path:new URL(`terminal-${width}.png`,import.meta.url).pathname})
 }
 await page.setViewportSize({width:1440,height:900})
 await page.getByRole('button',{name:'Ações de #21',exact:true}).click();await page.getByRole('menuitem',{name:'Ver conversa',exact:true}).click();await page.locator('.conversation').waitFor();check('conversation available from menu',true)
 await page.getByRole('button',{name:'Ações de #21',exact:true}).click();await page.getByRole('menuitem',{name:'Ver terminal',exact:true}).click();check('terminal survives view toggle',await page.evaluate(()=>window.terminals.every((e,i)=>e===document.querySelectorAll('.xterm')[i])))
 await page.getByRole('button',{name:'Ações de #21',exact:true}).click();check('details preserve provider and usage',await page.locator('.pane__details').innerText().then(t=>t.includes('OpenAI')&&t.includes('tokens')));await page.keyboard.press('Escape');check('menu focus returns',await page.getByRole('button',{name:'Ações de #21',exact:true}).evaluate(e=>e===document.activeElement))
 await page.getByRole('button',{name:'Estado de #21:',exact:false}).click();check('waiting choices preserved',await page.getByRole('menuitem',{name:'Somente leitura',exact:true}).isVisible());await page.getByRole('menuitem',{name:'Responder no terminal',exact:true}).click();await page.waitForFunction(()=>document.activeElement?.classList.contains('xterm-helper-textarea'));check('reply focuses terminal',true)
 await page.locator('.composer textarea').fill('Ajustar terminais');await page.locator('.composer__send').click();await page.waitForFunction(()=>document.querySelector('.composer textarea').value==='');check('input submits and clears on ACK',await page.evaluate(()=>window.messages.some(m=>m.type==='pane.submit'&&m.paneId===21&&m.text==='Ajustar terminais')))
 check('focus after submit',await page.locator('.composer textarea').evaluate(e=>e===document.activeElement))
 await page.locator('.mission__layout').getByRole('button',{name:'Foco',exact:true}).click();await page.screenshot({path:new URL(`focus-${engine}.png`,import.meta.url).pathname});await page.locator('.mission__layout').getByRole('button',{name:'Grade',exact:true}).click();check('layout changes retain xterm',await page.evaluate(()=>window.terminals.every((e,i)=>e===document.querySelectorAll('.xterm')[i])))
 check('one attach per terminal',await page.evaluate(()=>[21,22].every(id=>window.messages.filter(m=>m.type==='pane.attach'&&m.paneId===id).length===1)))
 await page.setViewportSize({width:375,height:667});await page.locator('.composer__language summary').click();await page.locator('.composer textarea').fill('Rascunho');await page.locator('.composer__send').click({trial:true});check('send accessible with language expanded',true);await page.keyboard.press('Escape');check('language Escape closes panel',await page.locator('.composer__language').evaluate(e=>!e.open))
 check('no runtime errors',errors.length===0)
} catch(e){errors.push(e.message);await page.screenshot({path:new URL(`failure-${engine}.png`,import.meta.url).pathname})} finally {await writeFile(new URL(`ui-${engine}.json`,import.meta.url),JSON.stringify({engine,checks,measurements,errors},null,2));await browser.close()}
console.log(JSON.stringify({engine,checks:checks.length,errors}));if(errors.length)process.exitCode=1
