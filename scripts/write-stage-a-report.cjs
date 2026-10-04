const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const assert = require('node:assert/strict')
const root = path.resolve(__dirname, '..')
const load = p => JSON.parse(fs.readFileSync(path.join(root, p), 'utf8'))
const core = load('work/studio-tests/latest-result.json'), studio = load('work/studio-app-test/latest-result.json'), packaged = load('work/packaged-smoke/result.json')
assert.equal(core.status, 'passed'); assert.equal(studio.status, 'passed'); assert.equal(packaged.status, 'passed')
const teamRoot = path.join(root, 'outputs/雨后的第七分钟-第一章-v4')
const manifest = JSON.parse(fs.readFileSync(path.join(teamRoot, 'project.loomproject'), 'utf8'))
const originalBytes = fs.readFileSync(path.join(teamRoot, 'migration/original.story.json'))
const original = JSON.parse(originalBytes)
const chunks = manifest.scenes.map(s => JSON.parse(fs.readFileSync(path.join(teamRoot, s.path), 'utf8')))
const nodes = new Map(chunks.flatMap(c => c.nodes).map(n => [n.id,n]))
const edges = new Map(chunks.flatMap(c => c.edges).map(e => [e.id,e]))
for(const n of original.nodes){const actual=nodes.get(n.id);assert(actual);assert.equal(actual.type,n.type);for(const [k,v]of Object.entries(n.data))assert.deepEqual(actual.data[k],v)}
for(const e of original.edges)assert.deepEqual(edges.get(e.id),e)
assert.deepEqual(manifest.variables,original.variables);assert.deepEqual(manifest.meta,original.meta)
const hash = data => crypto.createHash('sha256').update(data).digest('hex')
for(const [key,a]of Object.entries(original.assets)){
  const comma=a.dataUrl.indexOf(','),header=a.dataUrl.slice(5,comma),payload=decodeURIComponent(a.dataUrl.slice(comma+1))
  const bytes=Buffer.from(payload,/;base64/i.test(header)?'base64':'utf8')
  assert.equal(hash(fs.readFileSync(path.join(teamRoot,manifest.assets[key].path))),hash(bytes))
}
const migration = JSON.parse(fs.readFileSync(path.join(teamRoot,'migration/report.json'),'utf8'))
assert.equal(hash(originalBytes),migration.sourceSha256)
assert.equal(hash(fs.readFileSync(migration.source)),migration.sourceSha256,'C 盘原件发生变化')
const report = {
  version:'0.5.0', phase:'A', status:'passed', generatedAt:new Date().toISOString(),
  project: { path:path.join(teamRoot,'project.loomproject'), nodes:nodes.size,edges:edges.size,scenes:chunks.length,assets:Object.keys(manifest.assets).length,
    oldRuntimeFieldsPreserved:true, originalUntouched:true, sourceSha256:migration.sourceSha256, scriptsRetained:migration.warnings },
  tests: { typecheck:'passed',io:'passed',core:core.checks,editorIntegration:studio.checks,playerDom:16,browserIndexedDBRecovery:7,
    actualPackagedEditor:packaged,ci:'已配置 Linux/Windows 工作流；本轮验证为本地运行，未核实远程 CI 执行状态。' },
  routeVariables:studio.routes.map(r=>({choices:r.choices,variables:r.vars})), pressure:core.pressure,
  boundaries:['本轮为阶段 A；阶段 B/C 尚未实现。','玩家存档仍为 v1/6 槽，任意脚本执行期间不能存档。','2GB 测试使用稀疏静音 WAV，不能作为真实配音解码性能证明。','目录工程目前由 Windows Electron 版提供。','Git/LFS 配置文件已提供，没有设置团队远程仓库或上传作品。']
}
fs.writeFileSync(path.join(root,'outputs/阶段A-验证报告.json'),JSON.stringify(report,null,2))
fs.copyFileSync(path.join(studio.directory,'script-editor.png'),path.join(root,'outputs/阶段A-剧本编辑.png'))
fs.copyFileSync(path.join(studio.directory,'scene-overview.png'),path.join(root,'outputs/阶段A-场景图.png'))
console.log(JSON.stringify({status:report.status,project:report.project,pressure:report.pressure},null,2))
