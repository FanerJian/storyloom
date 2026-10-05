/** 用独立 D 盘配置与本机调试协议检查实际打包程序，不操作用户窗口。 */
const fs = require('node:fs')
const path = require('node:path')
const { spawn } = require('node:child_process')
const assert = require('node:assert/strict')
const net = require('node:net')
const work = path.resolve(__dirname, '../work/packaged-smoke')
fs.mkdirSync(work, { recursive: true })
const executable = path.resolve(process.argv[2])
const beside = process.argv.includes('--beside')
const profile = beside ? path.join(path.dirname(executable), 'portable-data') : fs.mkdtempSync(path.join(work, 'profile-'))
fs.mkdirSync(profile, { recursive: true })
const project = path.resolve(process.argv[3])
let child, socket
async function main() {
  const server = net.createServer()
  await new Promise(r => server.listen(0, '127.0.0.1', r))
  const port = server.address().port
  await new Promise(r => server.close(r))
  const environment = { ...process.env, FABLELOOM_DATA_DIR: profile, FABLELOOM_TEST_HIDDEN: '1' }
  if(beside)delete environment.FABLELOOM_DATA_DIR
  delete environment.ELECTRON_RUN_AS_NODE; delete environment.FABLELOOM_E2E; delete environment.ELECTRON_RENDERER_URL
  child = spawn(executable, [`--remote-debugging-port=${port}`, '--remote-debugging-address=127.0.0.1'], { env: environment, windowsHide: true, stdio: 'ignore' })
  child.on('error', e => { throw e })
  let target
  for (let i = 0; i < 100; i++) {
    try { target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(t => t.type === 'page' && t.url.includes('index.html')); if(target)break } catch {}
    await new Promise(r => setTimeout(r, 100))
  }
  assert(target, '实际打包程序没有创建渲染窗口')
  socket = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((r,j) => { socket.onopen=r; socket.onerror=j })
  let sequence = 0
  const pending = new Map()
  socket.onmessage = event => { const message=JSON.parse(event.data); const task=pending.get(message.id);if(task){pending.delete(message.id);message.error?task.reject(message.error):task.resolve(message.result)} }
  const evaluate = expression => new Promise((resolve,reject) => { const id=++sequence;pending.set(id,{resolve,reject});socket.send(JSON.stringify({id,method:'Runtime.evaluate',params:{expression,awaitPromise:true,returnByValue:true}})) })
  let ready=false
  for(let i=0;i<100;i++){const result=await evaluate('!!window.api && document.body.textContent.includes("新建空白工程")');if(result.result?.value){ready=true;break}await new Promise(r=>setTimeout(r,50))}
  assert(ready,'生产渲染层未能载入')
  const result=await evaluate(`(async()=>{const app=await window.api.appInfo();const opened=await window.api.openProjectPath(${JSON.stringify(project)});return {app,canceled:opened.canceled,error:opened.error,version:opened.project?.version,nodes:opened.project?.nodes.length,scenes:opened.project?.authoring?.scenes.length,external:opened.project&&Object.values(opened.project.assets).every(a=>a.runtimeUrl?.startsWith('fableloom-asset:'))}})()`)
  assert(!result.exceptionDetails,JSON.stringify(result.exceptionDetails))
  const value=result.result.value
  assert.equal(value.app.version,require('../package.json').version);assert.equal(value.app.isDev,false)
  assert.equal(value.canceled,false);assert.equal(value.version,4);assert.equal(value.nodes,519);assert.equal(value.scenes,8);assert(value.external)
  assert(fs.existsSync(path.join(profile,'recent.json')),'用户数据未写入隔离的 D 盘目录')
  await evaluate(`localStorage.setItem('fableloom.plugins.v1',JSON.stringify([{id:'smoke',name:'smoke',version:'1',apiVersion:1,editorJs:'window.__smoke=slp',editorCss:'',runtimeJs:'',runtimeCss:''}]));localStorage.setItem('fableloom.plugins.enabled.v1',JSON.stringify({smoke:true}));location.reload()`)
  for(let i=0;i<100;i++){const r=await evaluate('!!window.__smoke && !!window.api');if(r.result?.value)break;await new Promise(r=>setTimeout(r,50))}
  const rendered = await evaluate(`window.api.openProjectPath(${JSON.stringify(project)}).then(r=>__smoke.project.getState().loadProject(r.project,r.path))`)
  assert(!rendered.exceptionDetails,JSON.stringify(rendered.exceptionDetails))
  let toolbar=false
  for(let i=0;i<100;i++){const r=await evaluate('!!document.querySelector("[data-testid=editor-toolbar] button[aria-label=创作]")');if(r.result?.value){toolbar=true;break}await new Promise(r=>setTimeout(r,50))}
  assert(toolbar,'正式 EXE 必须载入统一顶栏')
  await evaluate(`document.querySelector('button[aria-label="创作"]').click()`)
  await new Promise(r=>setTimeout(r,50))
  await evaluate(`[...document.querySelectorAll('[role="menuitem"]')].find(b=>b.textContent.trim()==='场景图').click()`)
  let sceneUi=false
  for(let i=0;i<100;i++){const r=await evaluate('!!document.querySelector("[data-testid=scene-graph] .scene-card")');if(r.result?.value){sceneUi=true;break}await new Promise(r=>setTimeout(r,50))}
  assert(sceneUi,'正式 EXE 必须载入新版场景图')
  const report={status:'passed',executable,profile,ui:{groupedToolbar:toolbar,sceneGraph:sceneUi},...value}
  fs.writeFileSync(path.join(work,'result.json'),JSON.stringify(report,null,2))
  console.log(JSON.stringify(report,null,2))
}
main().then(()=>{socket?.close();child?.kill();process.exit(0)}).catch(error=>{console.error(error);socket?.close();child?.kill();process.exit(1)})
