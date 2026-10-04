/**
 * 素材内容去重回归：运行真实工程 store，验证引用、并发导入和历史兼容。
 * npx esbuild scripts/asset-test.ts --bundle --platform=node --format=esm --alias:@shared=./src/shared --outfile=work/asset-test.mjs && node work/asset-test.mjs
 */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { emptyProject } from '../src/shared/schema'
import { hashAssetDataUrl } from '../src/shared/assets'
import { resetHistory, useProjectStore } from '../src/renderer/src/stores/project'

const store = useProjectStore
const svg = '<svg xmlns="http://www.w3.org/2000/svg"><text>雪夜</text></svg>'
const base64 = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`
const percentEncoded = `data:image/svg+xml,${encodeURIComponent(svg)}`
const sameBytesDifferentMime = `data:application/octet-stream;base64,${Buffer.from(svg).toString('base64')}`

assert.equal(await hashAssetDataUrl(base64), createHash('sha256').update(svg).digest('hex'), '摘要应与真实文件字节 SHA-256 一致')
assert.equal(await hashAssetDataUrl(percentEncoded), await hashAssetDataUrl(base64), '不同 data URL 编码应识别相同内容')
assert.equal(await hashAssetDataUrl(sameBytesDifferentMime), await hashAssetDataUrl(base64), '文件 MIME 不应影响内容摘要')

store.getState().newProject()
const first = await store.getState().addAsset('雪夜.svg', 'image', base64)
store.getState().markSaved('first.story.json')
const historyBefore = store.getState().pastCount
const before = store.getState().serialize()
assert.equal(await store.getState().addAsset('改名.svg', 'image', percentEncoded), first, '改名后的相同文件应重用现有 key')
assert.equal(store.getState().serialize(), before, '重复导入不应改写工程或素材名称')
assert.equal(store.getState().dirty, false, '重复导入不应标记工程未保存')
assert.equal(store.getState().pastCount, historyBefore, '重复导入不应消耗撤销记录')

const background = store.getState().addNode('bg', { x: 0, y: 0 })!
const portrait = store.getState().addNode('sprite', { x: 300, y: 0 })!
store.getState().updateNodeData(background.id, { asset: first })
const portraitAsset = await store.getState().addAsset('立绘.svg', 'image', sameBytesDifferentMime)
store.getState().updateNodeData(portrait.id, { asset: portraitAsset })
assert.equal(Object.keys(store.getState().assets).length, 1, '多个节点共享相同文件时只存一份 base64')
assert.equal(store.getState().nodes.find((node) => node.id === portrait.id)?.data.asset, first, '节点应使用重用素材的 key')
const different = await store.getState().addAsset('雪夜.svg', 'image', 'data:image/svg+xml;base64,PHN2Zy8+')
assert.notEqual(different, first, '同名但不同文件内容应分别存储')
const audio = await store.getState().addAsset('test.wav', 'audio', base64)
assert.notEqual(audio, first, '不同媒体类型应保持独立，避免破坏选择器语义')

store.getState().newProject()
const simultaneous = await Promise.all(
  Array.from({ length: 8 }, (_, i) => store.getState().addAsset(`copy-${i}.svg`, 'image', base64))
)
assert.equal(new Set(simultaneous).size, 1, '并发导入相同文件应获得同一 key')
assert.equal(Object.keys(store.getState().assets).length, 1, '并发导入不能增加重复素材')
store.getState().undo()
assert.equal(Object.keys(store.getState().assets).length, 0, '一次撤销应移除唯一一次真实导入')
store.getState().redo()
assert.equal(Object.keys(store.getState().assets).length, 1, '重做应恢复该素材')
assert.equal(await store.getState().addAsset('redo.svg', 'image', percentEncoded), simultaneous[0], '重做后的素材仍应参与内容去重')
store.getState().removeAsset(simultaneous[0])
assert.notEqual(await store.getState().addAsset('reimport.svg', 'image', base64), simultaneous[0], '删除后重新导入不能复用失效 key')

const legacy = emptyProject()
legacy.assets = {
  legacy_bg: { name: 'old.svg', type: 'image', dataUrl: base64 },
  legacy_duplicate: { name: 'old copy.svg', type: 'image', dataUrl: percentEncoded },
  legacy_invalid: { name: 'broken.svg', type: 'image', dataUrl: 'legacy-invalid-url' }
}
legacy.nodes = [
  { id: 'legacy_node', type: 'bg', position: { x: 0, y: 0 }, data: { asset: 'legacy_duplicate' } }
]
store.getState().loadProject(legacy, 'legacy.story.json')
const legacyBefore = store.getState().serialize()
assert.equal(await store.getState().addAsset('new.svg', 'image', base64), 'legacy_bg', '无需 hash 字段的旧素材应可被重用')
assert.equal(store.getState().serialize(), legacyBefore, '载入旧工程不应清理已有重复素材或改动旧节点引用')
assert.equal(store.getState().nodes[0].data.asset, 'legacy_duplicate', '已有 key 的引用必须保留')
assert.equal(JSON.parse(store.getState().serialize()).version, 4, '旧工程引用保留，新版编辑器保存为 v4')
await store.getState().addAsset('different.svg', 'image', 'data:image/svg+xml;base64,PHN2Zy8+')
assert.ok(store.getState().assets.legacy_invalid, '格式异常的旧素材应原样保留，同时不阻止有效新素材导入')

const importing = store.getState().addAsset('late.svg', 'image', base64)
store.getState().newProject()
await assert.rejects(importing, /工程已切换/, '计算摘要时切换工程应取消导入')
assert.equal(Object.keys(store.getState().assets).length, 0, '旧工程的延迟导入不能污染新工程')
await assert.rejects(store.getState().addAsset('broken.png', 'image', 'broken'), /data URL/, '无效素材应报告错误而非写入工程')
resetHistory()
console.log('ok  素材 SHA-256、重复复用、并发去重、撤销/重做、旧工程引用兼容与工程切换保护')
