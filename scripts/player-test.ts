/** Bundle with esbuild, then run with Node. No DOM or extra dependencies required. */
import assert from 'node:assert/strict'
import { emptyProject, type StoryProject } from '../src/shared/schema'
import { createPlayerStorage, playerIdentity, playerRevision, validatePlayerSave, type PlayerSave } from '../src/shared/playerState'

const story: StoryProject = {
  ...emptyProject(), meta: { title: 'Progress test', author: 'Test', description: '' },
  variables: [{ id: 'score', name: 'Score', type: 'number', initial: 0 }],
  assets: { bg: { type: 'image', name: 'BG', dataUrl: 'data:image/png;base64,AAAA' }, music: { type: 'audio', name: 'BGM', dataUrl: 'data:audio/wav;base64,BBBB' } },
  nodes: [
    { id: 'start', type: 'start', position: { x: 0, y: 0 }, data: {} },
    { id: 'line', type: 'dialogue', position: { x: 0, y: 0 }, data: { text: 'Hello' } },
    { id: 'script', type: 'script', position: { x: 0, y: 0 }, data: { code: 'vars.score++' } }
  ], edges: [{ id: 'edge', source: 'start', target: 'line', sourceHandle: null }]
}
const revision = playerRevision(story)
const save: PlayerSave = {
  version: 1, revision, savedAt: Date.now(), nodeId: 'line', vars: { score: 2, custom: true },
  backlog: [{ kind: 'dialogue', speaker: 'Alice', text: '<Hello>' }],
  media: { background: 'bg', sprites: { left: { asset: 'bg', character: 'Alice', x: 40 }, center: null, right: null, custom: null }, bgm: { asset: 'music', volume: 0.5, loop: true, time: 12 } },
  presentation: { css: '.tgr-card { color: white }', rules: [['.tgr-text', 'font-weight: bold']], overlayColor: '', overlayOpacity: '0' }
}
let checks = 0
function check(label: string, fn: () => void): void { fn(); checks++; console.log(`ok ${label}`) }
check('valid progress preserves all runtime fields', () => assert.deepEqual(validatePlayerSave(JSON.parse(JSON.stringify(save)), story, revision), save))
check('script continuation saves are refused', () => assert.equal(validatePlayerSave({ ...save, nodeId: 'script' }, story, revision), null))
check('unknown nodes are refused', () => assert.equal(validatePlayerSave({ ...save, nodeId: 'missing' }, story, revision), null))
check('old save format is refused', () => assert.equal(validatePlayerSave({ ...save, version: 0 }, story, revision), null))
check('old story revisions are refused', () => assert.equal(validatePlayerSave({ ...save, revision: 'old' }, story, revision), null))
check('non-finite variables are refused', () => assert.equal(validatePlayerSave({ ...save, vars: { score: Infinity } }, story, revision), null))
check('removed assets are refused', () => assert.equal(validatePlayerSave({ ...save, media: { ...save.media, background: 'missing' } }, story, revision), null))
check('wrong asset kind is refused', () => assert.equal(validatePlayerSave({ ...save, media: { ...save.media, background: 'music' } }, story, revision), null))
check('missing media shape is refused', () => assert.equal(validatePlayerSave({ ...save, media: {} }, story, revision), null))
check('unbounded backlog is refused', () => assert.equal(validatePlayerSave({ ...save, backlog: Array(501).fill(save.backlog[0]) }, story, revision), null))
check('malformed presentation is refused', () => assert.equal(validatePlayerSave({ ...save, presentation: { ...save.presentation, rules: [['a']] } }, story, revision), null))
check('playtest and game stores are isolated', () => assert.notEqual(playerIdentity(story, 'game'), playerIdentity(story, 'playtest')))
check('different playtest entry points are isolated', () => assert.notEqual(playerIdentity(story, 'playtest', 'line'), playerIdentity(story, 'playtest', 'start')))
check('node positions do not invalidate progress', () => assert.equal(playerRevision({ ...story, nodes: story.nodes.map((n) => ({ ...n, position: { x: 100, y: 500 } })) }), revision))
check('asset bytes invalidate progress', () => assert.notEqual(playerRevision({ ...story, assets: { ...story.assets, bg: { ...story.assets.bg, dataUrl: 'different' } } }), revision))
check('script changes invalidate progress', () => assert.notEqual(playerRevision({ ...story, customJs: 'vars.score++' }), revision))
check('runtime plugin changes invalidate progress', () => assert.notEqual(playerRevision(story, [{ id: 'p', js: 'vars.score++' }]), revision))
const memory = new Map<string, string>()
const mock = { getItem: (key: string) => memory.get(key) ?? null, setItem: (key: string, value: string) => { memory.set(key, value) }, removeItem: (key: string) => { memory.delete(key) } }
const key = playerIdentity(story)
const slots = createPlayerStorage(mock, key, story, revision)
check('six slots survive storage recreation', () => {
  for (let i = 1; i <= 6; i++) assert.equal(slots.write(i, { ...save, savedAt: i }), true)
  const fresh = createPlayerStorage(mock, key, story, revision)
  for (let i = 1; i <= 6; i++) { const slot = fresh.read(i); assert.equal(slot.kind, 'ready'); if (slot.kind === 'ready') assert.equal(slot.save.savedAt, i) }
})
check('media bytes are not duplicated in slots', () => assert.equal([...memory.values()].some((json) => json.includes('base64')), false))
check('settings persist, including instant text', () => { slots.speed(0); assert.equal(createPlayerStorage(mock, key, story, revision).speed(), 0) })
check('corrupt slots do not disable valid saves', () => { memory.set(`${key}:slot:1`, '{broken'); assert.equal(slots.read(1).kind, 'invalid'); assert.equal(slots.available, true); assert.equal(slots.write(1, save), true) })
check('stale revisions are visibly invalid', () => assert.equal(createPlayerStorage(mock, key, story, 'changed').read(1).kind, 'invalid'))
check('delete affects only its slot', () => { slots.remove(1); assert.equal(slots.read(1).kind, 'empty'); assert.equal(slots.read(2).kind, 'ready') })
check('null storage never throws', () => { const s = createPlayerStorage(null, key, story, revision); assert.equal(s.write(1, save), false); assert.equal(s.read(1).kind, 'empty'); assert.equal(s.speed(), 24) })
check('blocked storage never interrupts the game', () => { const blocked = createPlayerStorage({ getItem() { throw new Error('blocked') }, setItem() { throw new Error('blocked') }, removeItem() { throw new Error('blocked') } }, key, story, revision); assert.equal(blocked.read(1).kind, 'invalid'); assert.equal(blocked.write(1, save), false); assert.equal(blocked.remove(1), false); assert.equal(blocked.speed(10), 10) })
console.log(`Player progress: ${checks} checks passed.`)
