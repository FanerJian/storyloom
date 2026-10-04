import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { migrateProject } from '../src/shared/schema'
import { upgradeAuthoring } from '../src/shared/authoring'
import { DirectoryProjects } from '../src/main/directoryProject'

const [source, target] = process.argv.slice(2)
if (!source || !target) throw new Error('用法：node migrate-project.mjs 原工程.story.json 新文件夹/project.loomproject')
if (existsSync(target)) throw new Error('目标工程已经存在；为保护改稿，请使用新的文件夹')
const bytes = readFileSync(source), raw = JSON.parse(bytes.toString('utf8'))
const project = upgradeAuthoring(migrateProject(raw))
const root = dirname(resolve(target)); mkdirSync(join(root, 'migration'), { recursive: true })
copyFileSync(source, join(root, 'migration/original.story.json'), 1)
const result = new DirectoryProjects().save(project, target)
for (const [id, a] of Object.entries(result.project.assets)) if (/占位/.test(a.name)) result.project.assets[id] = { ...a, placeholder: true }
// 占位标记进入清单，不更改素材或剧情。
const session = new DirectoryProjects(); session.open(target); session.save(result.project, target)
const report = { source: resolve(source), sourceVersion: raw.version ?? 1, sourceSha256: createHash('sha256').update(bytes).digest('hex'),
  target: resolve(target), version: 4, gameId: project.authoring!.gameId, scenes: project.authoring!.scenes.length, nodes: project.nodes.length,
  edges: project.edges.length, assets: Object.keys(project.assets).length, warnings: project.authoring!.migrationWarnings }
writeFileSync(join(root, 'migration/report.json'), JSON.stringify(report, null, 2))
if (createHash('sha256').update(readFileSync(source)).digest('hex') !== report.sourceSha256) throw new Error('原工程校验失败')
console.log(JSON.stringify(report, null, 2))
