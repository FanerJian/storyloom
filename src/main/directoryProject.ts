import { createReadStream, existsSync, readFileSync, writeFileSync, mkdirSync, copyFileSync, statSync, realpathSync, openSync, closeSync, unlinkSync } from 'node:fs'
import { dirname, resolve, relative, isAbsolute, extname, basename } from 'node:path'
import { createHash } from 'node:crypto'
import type { StoryProject, StoryAsset, StoryNode, StoryEdge, AuthoringData, StoryScene } from '../shared/schema'
import { upgradeAuthoring, persistedNode } from '../shared/authoring'
import { writeFileAtomic } from './atomicFile'

const digest = (text: string | Buffer): string => createHash('sha256').update(text).digest('hex')
const json = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`
const safeId = (id: string): boolean => /^[\w-]{1,100}$/.test(id)
export const directoryRoots = new Map<string, string>()

/** 同时限制词法路径与真实路径，拒绝目录外的符号链接。 */
export function within(root: string, name: string): string {
  if (isAbsolute(name) || name.includes(':') || name.includes('\\') || name.split('/').includes('..')) throw new Error(`工程路径越界：${name}`)
  const target = resolve(root, name)
  const inside = (p: string): boolean => { const r = relative(realpathSync(root), p); return r === '' || (!r.startsWith('..') && !isAbsolute(r)) }
  let parent = target
  while (!existsSync(parent)) parent = dirname(parent)
  if (!inside(realpathSync(parent))) throw new Error(`工程链接越界：${name}`)
  return target
}

export function runtimeAsset(root: string, path: string): string {
  const token = digest(resolve(root)).slice(0, 24)
  directoryRoots.set(token, resolve(root))
  return `fableloom-asset://${token}/${path.split('/').map(encodeURIComponent).join('/')}`
}

function diskHash(path: string): string | null { return existsSync(path) ? digest(readFileSync(path)) : null }

interface Manifest {
  format: 'fableloom-directory'; version: 4; meta: StoryProject['meta']
  authoring: Omit<AuthoringData, 'scenes' | 'characters'>
  scenes: { id: string; path: string }[]
  charactersFile: string
  assets: Record<string, StoryAsset>
  variables: StoryProject['variables']; customCss: string; customJs: string
}
interface SceneFile { scene: StoryScene; nodes: StoryNode[]; edges: StoryEdge[] }
interface JournalEntry { path: string; before: string | null; after: string; content: string }

export class ProjectConflict extends Error {
  constructor(public files: string[]) { super(`外部修改冲突，未覆盖文件：${files.join('、')}。请先备份当前更改，再重新打开工程处理。`) }
}

export class DirectoryProjects {
  private baselines = new Map<string, Map<string, string>>()

  private lock<T>(root: string, action: () => T): T {
    mkdirSync(within(root, '.fableloom'), { recursive: true })
    const path = within(root, '.fableloom/save.lock')
    if (existsSync(path)) {
      const pid = Number(readFileSync(path, 'utf8'))
      let alive = true
      try { process.kill(pid, 0) } catch (e) { alive = (e as NodeJS.ErrnoException).code !== 'ESRCH' }
      if (alive || !Number.isInteger(pid) || pid <= 0) throw new Error('工程正在由另一个进程保存，请稍后重试')
      unlinkSync(path)
    }
    const fd = openSync(path, 'wx')
    writeFileSync(fd, String(process.pid)); closeSync(fd)
    try { return action() } finally { unlinkSync(path) }
  }

  /** 保存中断时，只补写仍等于旧版本的文件；第三方新修改不会被覆盖。 */
  private recover(root: string): void {
    const path = within(root, '.fableloom/pending.json')
    if (!existsSync(path)) return
    const entries = JSON.parse(readFileSync(path, 'utf8')) as JournalEntry[]
    if (!Array.isArray(entries) || entries.some((e) => typeof e.path !== 'string' || typeof e.content !== 'string' || e.after !== digest(e.content))) throw new Error('工程保存日志损坏，原文件已保留')
    const conflicts = entries.filter((e) => { const hash = diskHash(within(root, e.path)); return hash !== e.before && hash !== e.after }).map((e) => e.path)
    if (conflicts.length) throw new ProjectConflict(conflicts)
    for (const e of entries) if (diskHash(within(root, e.path)) !== e.after) writeFileAtomic(within(root, e.path), e.content)
    unlinkSync(path)
  }

  private read(path: string): { project: StoryProject; files: Map<string, string> } {
    const root = dirname(resolve(path))
    const files = new Map<string, string>()
    const read = <T>(name: string): T => {
      const content = readFileSync(within(root, name), 'utf8'); files.set(name, digest(content)); return JSON.parse(content) as T
    }
    const manifest = read<Manifest>(basename(path))
    if (manifest.format !== 'fableloom-directory' || manifest.version !== 4 || !manifest.authoring?.gameId || !Array.isArray(manifest.scenes)) throw new Error('不是有效的 v4 团队工程')
    const chunks = manifest.scenes.map(({ id, path: file }) => {
      const chunk = read<SceneFile>(file)
      if (!safeId(id) || chunk.scene?.id !== id || !Array.isArray(chunk.nodes) || !Array.isArray(chunk.edges) || chunk.nodes.some((n) => n.sceneId !== id)) throw new Error(`场景文件结构无效：${file}`)
      return chunk
    })
    const characters = read<AuthoringData['characters']>(manifest.charactersFile)
    const assets = Object.fromEntries(Object.entries(manifest.assets).map(([key, a]) => {
      if (!a.path || !['image', 'audio'].includes(a.type)) throw new Error(`素材索引无效：${key}`)
      const sourcePath = within(root, a.path)
      const missing = !existsSync(sourcePath) || !statSync(sourcePath).isFile()
      return [key, { ...a, dataUrl: '', sourcePath, runtimeUrl: missing ? '' : runtimeAsset(root, a.path), missing }]
    }))
    const nodes = chunks.flatMap((c) => c.nodes), edges = chunks.flatMap((c) => c.edges)
    if (new Set(nodes.map((n) => n.id)).size !== nodes.length || new Set(chunks.map((c) => c.scene.id)).size !== chunks.length || new Set(edges.map((e) => e.id)).size !== edges.length) throw new Error('工程存在重复 ID，未加载')
    return { files, project: { version: 4, meta: manifest.meta, authoring: { ...manifest.authoring, scenes: chunks.map((c) => c.scene), characters },
      assets, nodes, edges, variables: manifest.variables, customJs: manifest.customJs, customCss: manifest.customCss } }
  }

  open(path: string): StoryProject {
    const root = dirname(resolve(path))
    if (existsSync(within(root, '.fableloom/pending.json'))) this.lock(root, () => this.recover(root))
    const { project, files } = this.read(path)
    this.baselines.set(resolve(path), files)
    return project
  }

  changes(path: string): string[] {
    const base = this.baselines.get(resolve(path))
    if (!base) return []
    const root = dirname(resolve(path))
    return [...base].filter(([name, hash]) => diskHash(within(root, name)) !== hash).map(([name]) => name)
  }

  async importAsset(path: string, source: string, type: StoryAsset['type'], mime: string): Promise<StoryAsset> {
    const root = dirname(resolve(path))
    // 限定为已打开/保存的工程，不能从渲染层任意指定写入目录。
    if (!this.baselines.has(resolve(path))) throw new Error('请先打开或保存团队工程')
    const hash = createHash('sha256')
    for await (const chunk of createReadStream(source)) hash.update(chunk)
    const contentHash = hash.digest('hex')
    const existing = Object.values(this.read(path).project.assets).find((a) => a.type === type && a.contentHash === contentHash && !a.missing)
    if (existing) return { ...existing, name: basename(source) }
    return this.copyAsset(root, source, type, mime, contentHash, basename(source))
  }

  private copyAsset(root: string, source: string | Buffer, type: StoryAsset['type'], mime: string, hash: string, name: string): StoryAsset {
    const ext = extname(name).toLowerCase().replace(/[^.a-z0-9]/g, '') || (type === 'image' ? '.png' : '.wav')
    const path = `assets/${hash}${ext}`, destination = within(root, path)
    mkdirSync(dirname(destination), { recursive: true })
    // 相同内容的文件不会被重复写入或以新名字复制。
    if (!existsSync(destination)) {
      if (typeof source === 'string') copyFileSync(source, destination, 1)
      else writeFileSync(destination, source, { flag: 'wx' })
    }
    return { name, type, mime, path, dataUrl: '', contentHash: hash, bytes: statSync(destination).size,
      sourcePath: destination, runtimeUrl: runtimeAsset(root, path) }
  }

  save(input: StoryProject, path: string): { project: StoryProject; written: string[]; merged: string[] } {
    path = resolve(path)
    const root = dirname(path)
    mkdirSync(root, { recursive: true })
    return this.lock(root, () => {
      this.recover(root)
      const baseline = this.baselines.get(path)
      if (!baseline && existsSync(path)) throw new ProjectConflict([basename(path)])
      // 他人写入了损坏或缺失的场景时，拒绝开始本次提交。
      if (baseline && this.changes(path).length) this.read(path)
      const p = upgradeAuthoring(input), authoring = p.authoring!
      if (new Set(p.nodes.map((n) => n.id)).size !== p.nodes.length || new Set(p.edges.map((e) => e.id)).size !== p.edges.length) throw new Error('存在重复节点或连线 ID，未保存')
      if (!authoring.scenes.length || authoring.scenes.some((s) => !safeId(s.id)) || new Set(authoring.scenes.map((s) => s.id)).size !== authoring.scenes.length) throw new Error('场景 ID 无效或重复')
      const sceneIds = new Set(authoring.scenes.map((s) => s.id))
      if (p.nodes.some((n) => !n.sceneId || !sceneIds.has(n.sceneId))) throw new Error('有节点没有归属场景，请先修复')
      const assets: Record<string, StoryAsset> = {}
      const contentIndex = new Map<string, StoryAsset>()
      for (const [key, original] of Object.entries(p.assets)) {
        let a = original
        if (a.dataUrl.startsWith('data:')) {
          const comma = a.dataUrl.indexOf(','), header = a.dataUrl.slice(5, comma), payload = a.dataUrl.slice(comma + 1)
          const bytes = /;base64/i.test(header) ? Buffer.from(decodeURIComponent(payload), 'base64') : Buffer.from(decodeURIComponent(payload), 'utf8')
          const hash = digest(bytes), existing = contentIndex.get(`${a.type}:${hash}`)
          const resource = existing ? { path: existing.path, mime: existing.mime, bytes: existing.bytes, contentHash: hash, dataUrl: '' } : this.copyAsset(root, bytes, a.type, header.split(';')[0], hash, a.name)
          a = { ...a, ...resource }
        } else if (a.path) {
          const destination = within(root, a.path)
          if (!existsSync(destination) && a.sourcePath && existsSync(a.sourcePath)) {
            mkdirSync(dirname(destination), { recursive: true }); copyFileSync(a.sourcePath, destination, 1)
          }
          if (!existsSync(destination) && !a.missing) throw new Error(`素材丢失：${a.name}，请重新定位文件`)
        } else throw new Error(`素材 ${a.name} 无法转换，原工程未覆盖`)
        const { runtimeUrl: _url, sourcePath: _source, missing: _missing, ...stored } = a
        assets[key] = { ...stored, dataUrl: '' }
        if (a.contentHash) contentIndex.set(`${a.type}:${a.contentHash}`, assets[key])
      }
      const writes = new Map<string, string>()
      const nodesByScene = new Map<string, StoryNode[]>(), edgesByScene = new Map<string, StoryEdge[]>()
      const owner = new Map(p.nodes.map((n) => [n.id, n.sceneId!]))
      for (const n of p.nodes) { const list = nodesByScene.get(n.sceneId!) ?? []; list.push(persistedNode(n)); nodesByScene.set(n.sceneId!, list) }
      for (const e of p.edges) {
        const id = owner.get(e.source)
        if (!id || !owner.has(e.target)) throw new Error(`连线 ${e.id} 引用了不存在的节点`)
        const stored = { id: e.id, source: e.source, sourceHandle: e.sourceHandle ?? null, target: e.target }
        const list = edgesByScene.get(id) ?? []; list.push(stored); edgesByScene.set(id, list)
      }
      for (const scene of authoring.scenes) writes.set(`scenes/${scene.id}.json`, json({ scene, nodes: nodesByScene.get(scene.id) ?? [], edges: edgesByScene.get(scene.id) ?? [] }))
      writes.set('characters.json', json(authoring.characters))
      const { scenes: _scenes, characters: _characters, ...globalAuthoring } = authoring
      const manifest: Manifest = { format: 'fableloom-directory', version: 4, meta: p.meta, authoring: globalAuthoring,
        scenes: authoring.scenes.map((s) => ({ id: s.id, path: `scenes/${s.id}.json` })), charactersFile: 'characters.json',
        assets, variables: p.variables, customCss: p.customCss, customJs: p.customJs }
      writes.set(basename(path), json(manifest)) // 清单最后提交
      const entries: JournalEntry[] = [], conflicts: string[] = [], merged: string[] = []
      for (const [name, content] of writes) {
        const after = digest(content), before = baseline?.get(name) ?? null
        const current = diskHash(within(root, name))
        if (before === after) { if (current !== before) merged.push(name); continue } // 他人改了本地未修改的场景
        if (current !== before && current !== after) conflicts.push(name)
        else if (current !== after) entries.push({ path: name, before: current, after, content })
      }
      // 删除/新增场景时也保护他人对被删除场景的修改。保留磁盘旧文件供版本恢复。
      for (const [name, hash] of baseline ?? []) if (!writes.has(name) && diskHash(within(root, name)) !== hash) conflicts.push(name)
      if (merged.includes(basename(path)) && entries.some((e) => e.path.startsWith('scenes/'))) {
        const disk = this.read(path).project
        const ids = new Set(disk.authoring!.scenes.map((s) => s.id))
        if (p.authoring!.scenes.some((s) => !ids.has(s.id) && entries.some((e) => e.path === `scenes/${s.id}.json`))) conflicts.push(basename(path))
      }
      if (conflicts.length) throw new ProjectConflict(conflicts)
      if (entries.length) {
        writeFileAtomic(within(root, '.fableloom/pending.json'), json(entries))
        this.recover(root)
      }
      if (!existsSync(within(root, '.gitignore'))) writeFileAtomic(within(root, '.gitignore'), '.fableloom/\n*.tmp\n')
      if (!existsSync(within(root, '.gitattributes'))) writeFileAtomic(within(root, '.gitattributes'), '*.json text eol=lf\n*.loomproject text eol=lf\nassets/** filter=lfs diff=lfs merge=lfs -text\n')
      if (!existsSync(within(root, '.fableloom/migration-report.json'))) writeFileAtomic(within(root, '.fableloom/migration-report.json'), json({ sourceVersion: input.version, gameId: authoring.gameId, preservedNodeIds: p.nodes.length, warnings: authoring.migrationWarnings }))
      return { project: this.open(path), written: entries.map((e) => e.path), merged }
    })
  }
}

/** 单 HTML 是明确的打包操作；只有此时才读取外部素材字节。 */
export function embedAssets(project: StoryProject): StoryProject {
  return { ...project, assets: Object.fromEntries(Object.entries(project.assets).map(([key, a]) => {
    if (!a.path) return [key, a]
    if (!a.sourcePath || !existsSync(a.sourcePath)) throw new Error(`无法导出：素材 ${a.name} 缺失`)
    return [key, { ...a, runtimeUrl: undefined, sourcePath: undefined, dataUrl: `data:${a.mime || (a.type === 'image' ? 'image/png' : 'audio/wav')};base64,${readFileSync(a.sourcePath).toString('base64')}` }]
  })) }
}

/** 恢复快照只存外部素材引用。重新启动时注册其已授权文件地址。 */
export function hydrateRecoveryAssets(project: StoryProject): StoryProject {
  return { ...project, assets: Object.fromEntries(Object.entries(project.assets).map(([key, a]) => {
    if (!a.path || !a.sourcePath) return [key, a]
    const root = resolve(a.sourcePath, ...a.path.split('/').map(() => '..'))
    if (!existsSync(root)) return [key, { ...a, missing: true, runtimeUrl: '' }]
    const source = within(root, a.path), missing = !existsSync(source)
    return [key, { ...a, sourcePath: source, missing, runtimeUrl: missing ? '' : runtimeAsset(root, a.path) }]
  })) }
}
