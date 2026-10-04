import type { ChoiceOption, StoryProject, VarValue } from '@shared/schema'
import { evalCondition, normalizeRelease } from '@shared/schema'
import type { RuntimePluginChunk } from '@shared/plugins'
import { BACKLOG_LIMIT, PLAYER_SLOT_COUNT, createPlayerStorage, playerIdentity, playerRevision,
  type BacklogEntry, type PlayerSave, type PlayerSettings } from '../shared/playerState'
import './player.css'
import { assetUrl as resolveAssetUrl, createScenePrefetch } from '../shared/authoring'
import { createTypewriter, parseMarkup, type MarkupResult, type MarkupSeg } from './typewriter'
import { createMedia, SPRITE_POSITIONS, type MediaApi, type SpritePos, type SpriteSlot } from './media'
import { runBootScripts, runScript, type ScriptApiHost } from './scripting'
import { createSaves } from './saves'
import { createScreens } from './screens'
import { clampVolume, esc, sleep } from './util'

// 内联标记解析保持从 player 导出（既有引用不破坏）
export { parseMarkup } from './typewriter'
export type { MarkupSeg, MarkupResult } from './typewriter'

export interface PlayerOptions {
  startNodeId?: string
  /** 插件的运行面（试玩由编辑器传入，导出 HTML 由 window.__PLUGINS__ 传入），随 customJs 之后依次执行 */
  plugins?: RuntimePluginChunk[]
  /** Editor playtests use a separate storage namespace from exported games. */
  storageNamespace?: 'game' | 'playtest'
  /** 显式传入时覆盖 release 配置；undefined = 跟随 normalizeRelease(story.release).titleScreen.enabled */
  titleScreen?: boolean
}

export interface PlayerHandle {
  destroy(): void
}

interface Next {
  handle: string | null
  target: string
}

const SKIP_ADVANCE_MS = 150

/** 自动停留延迟：文本越长停得越久；autoLevel 1-10 越大越快（下限 150ms） */
const autoDelay = (textLength: number, autoLevel: number): number =>
  Math.max(150, Math.max(1200, Math.min(6000, textLength * 45)) * ((11 - autoLevel) / 10))

/**
 * 把一部故事挂载到容器里运行。
 * 同一份代码用于编辑器内「试玩」和导出的单文件 HTML，保证所见即所得。
 * 含背景/立绘/演出脚本节点的故事启用视觉小说演出层（tgr-vn）；
 * 模块划分：typewriter（打字机）/ media（背景立绘音频）/ scripting（演出脚本）
 * / screens（面板与标题画面）/ saves（存档），本文件负责编排与剧情管线。
 */
export function mountPlayer(container: HTMLElement, story: StoryProject, opts: PlayerOptions = {}): PlayerHandle {
  // ---- 发布配置 ----
  const release = normalizeRelease(story.release)
  const titleEnabled = opts.titleScreen ?? release.titleScreen.enabled

  // ---- 静态索引 ----
  const nodeById = new Map(story.nodes.map((n) => [n.id, n]))
  const adj = new Map<string, Next[]>()
  for (const e of story.edges) {
    if (!nodeById.has(e.source) || !nodeById.has(e.target)) continue
    const list = adj.get(e.source) ?? []
    list.push({ handle: e.sourceHandle ?? null, target: e.target })
    adj.set(e.source, list)
  }
  const nextOf = (id: string, handle: string | null = null): string | null => {
    const t = (adj.get(id) ?? []).find((n) => (n.handle ?? null) === handle)
    return t ? t.target : null
  }
  const assetUrl = (key?: string): string => resolveAssetUrl(key ? story.assets?.[key] : undefined)
  const predictedImages = createScenePrefetch(story)
  const preloadedImages = new Map<string, HTMLImageElement>()
  let preloadedScene: string | undefined
  function warmScene(sceneId?: string): void {
    if (!sceneId || sceneId === preloadedScene) return
    preloadedScene = sceneId
    const keys = predictedImages(sceneId), wanted = new Set(keys)
    for (const key of preloadedImages.keys()) if (!wanted.has(key)) preloadedImages.delete(key)
    for (const key of keys) if (!preloadedImages.has(key)) {
      const img = new Image(); img.decoding = 'async'; img.src = assetUrl(key); preloadedImages.set(key, img)
    }
  }
  /** 按素材名解析（脚本作者面对的是素材名而不是内部 key；宽松匹配省略扩展名） */
  const assetUrlByName = (name: string): string => {
    const t = name.trim()
    if (!t) return ''
    if (story.assets?.[t]) return resolveAssetUrl(story.assets[t])
    const hit =
      Object.values(story.assets ?? {}).find((a) => a.name === t) ??
      Object.values(story.assets ?? {}).find((a) => a.name.replace(/\.[^.]+$/, '') === t)
    return resolveAssetUrl(hit)
  }

  /** 有背景/立绘/演出脚本节点 → 启用视觉小说布局 */
  const vnMode = story.nodes.some((n) => n.type === 'bg' || n.type === 'sprite' || n.type === 'script')

  // ---- 运行状态 ----
  const vars: Record<string, VarValue> = Object.create(null)
  const startNodeId =
    (opts.startNodeId && nodeById.has(opts.startNodeId) ? opts.startNodeId : null) ??
    story.nodes.find((n) => n.type === 'start')?.id ??
    story.nodes[0]?.id ??
    null

  let currentId: string | null = null
  let destroyed = false
  let runSeq = 0
  let pendingJump: string | null = null
  let lifecycleSeq = 0
  let activeScripts = 0
  let safeNode = false
  let cardSeq = 0
  let cardReject: ((err: Error) => void) | null = null
  let cardAdvance: (() => void) | null = null
  let autoEnabled = false
  let skipEnabled = false
  let autoTimer: ReturnType<typeof setTimeout> | null = null
  let shakeTimer: ReturnType<typeof setTimeout> | null = null
  let currentTextLength = 0
  const backlog: BacklogEntry[] = []
  const assetKeysByUrl = new Map(Object.entries(story.assets ?? {}).map(([key, a]) => [resolveAssetUrl(a), key]))
  const identity = playerIdentity(story, opts.storageNamespace ?? 'game', opts.startNodeId)
  const revision = playerRevision(story, opts.plugins)
  let browserStorage: Storage | null = null
  try { browserStorage = window.localStorage } catch { /* blocked by browser policy */ }
  const storage = createPlayerStorage(browserStorage, identity, story, revision)
  // 玩家从未写过设置时，采用 release 出厂默认（normalizeRelease 已兜底）
  try {
    if (!browserStorage?.getItem(`${identity}:settings`)) storage.settings({ ...release.settings.defaults })
  } catch { /* blocked by browser policy */ }
  let settings: PlayerSettings = storage.settings()

  // ---- DOM ----
  container.classList.add('tgr-root')
  if (vnMode) container.classList.add('tgr-vn')
  container.innerHTML = `
    <header class="tgr-header">
      <div class="tgr-title">${esc(story.meta.title || '未命名故事')}</div>
      <div class="tgr-header-actions">${quickBarHtml()}</div>
    </header>
    <main class="tgr-stage" tabindex="0">
      <div class="tgr-media" aria-hidden="true">
        <div class="tgr-bg"><img alt="" draggable="false" /></div>
        <div class="tgr-bg"><img alt="" draggable="false" /></div>
        <div class="tgr-sprite tgr-sprite-left"><img alt="" draggable="false" /></div>
        <div class="tgr-sprite tgr-sprite-center"><img alt="" draggable="false" /></div>
        <div class="tgr-sprite tgr-sprite-right"><img alt="" draggable="false" /></div>
      </div>
      <div class="tgr-content" tabindex="-1"></div>
      <div class="tgr-fx" aria-hidden="true"></div>
      <div class="tgr-overlay" hidden></div>
    </main>
  `
  const stage = container.querySelector('.tgr-stage') as HTMLElement
  const content = container.querySelector('.tgr-content') as HTMLElement
  const fx = container.querySelector('.tgr-fx') as HTMLElement
  const overlay = container.querySelector('.tgr-overlay') as HTMLElement
  const restartBtn = container.querySelector('.tgr-restart') as HTMLButtonElement
  const fsBtn = container.querySelector('.tgr-fs') as HTMLButtonElement | null
  const autoBtn = container.querySelector('.tgr-auto') as HTMLButtonElement | null
  const skipBtn = container.querySelector('.tgr-skip') as HTMLButtonElement | null

  /** 快捷菜单按钮组：VN 模式由 CSS 变为底部毛玻璃药丸，非 VN 模式在头部工具条 */
  function quickBarHtml(): string {
    const q = release.quickMenu
    const parts: string[] = []
    if (q.saves) parts.push('<button class="tgr-tool tgr-saves" aria-label="存档与读档">存读档</button>')
    if (q.backlog) parts.push('<button class="tgr-tool tgr-backlog" aria-label="文本回看">回看</button>')
    if (q.auto) parts.push('<button class="tgr-tool tgr-auto" aria-pressed="false">自动</button>')
    if (q.skip) parts.push('<button class="tgr-tool tgr-skip" aria-pressed="false">快进</button>')
    if (q.settings) parts.push('<button class="tgr-tool tgr-settings" aria-label="设置">设置</button>')
    if (q.title && titleEnabled) parts.push('<button class="tgr-tool tgr-tomenu" aria-label="回到标题画面">回标题</button>')
    if (q.fullscreen) parts.push('<button class="tgr-fs" title="全屏切换" aria-label="全屏切换">⛶</button>')
    parts.push('<button class="tgr-restart" title="重新开始" aria-label="重新开始">↺</button>')
    return parts.join('')
  }

  // ---- 自定义 CSS（工程级 + 脚本动态注入） ----
  function ensureStyle(id: string): HTMLStyleElement {
    let el = container.querySelector<HTMLStyleElement>(`style#${id}`)
    if (!el) {
      el = document.createElement('style')
      el.id = id
      container.appendChild(el)
    }
    return el
  }
  const dynRules = new Map<string, string>()
  function setStyle(selector: string, cssText: string): void {
    dynRules.set(selector, cssText)
    ensureStyle('tgr-dyn-style').textContent = [...dynRules].map(([s, c]) => `${s} { ${c} }`).join('\n')
  }
  function css(cssText: string): void {
    ensureStyle('tgr-user-style').textContent += `\n${cssText}`
  }
  if (story.customCss?.trim()) css(story.customCss)
  // 插件运行面：CSS 在自定义样式之后注入，便于插件覆盖或叠加
  for (const pl of opts.plugins ?? []) {
    if (pl.css?.trim()) {
      const el = ensureStyle(`tgr-plugin-${pl.id.replace(/[^A-Za-z0-9_-]/g, '_')}`)
      el.textContent += `\n${pl.css}`
    }
  }

  // ---- 打字机 / 媒体 ----
  const tw = createTypewriter({
    getSpeed: () => (skipEnabled ? 0 : settings.textSpeed),
    isSkipping: () => skipEnabled,
    isDestroyed: () => destroyed
  })
  const media: MediaApi = createMedia(container, { isDestroyed: () => destroyed })
  media.setBgmMaster(settings.bgmVolume)
  media.setSfxMaster(settings.sfxVolume)

  // ---- 屏幕效果 ----
  function shake(intensity = 8, ms = 400): void {
    if (shakeTimer !== null) clearTimeout(shakeTimer)
    stage.style.setProperty('--tgr-shake-amp', `${intensity}px`)
    stage.classList.remove('tgr-shake')
    void stage.offsetWidth
    stage.classList.add('tgr-shake')
    shakeTimer = setTimeout(() => { shakeTimer = null; stage.classList.remove('tgr-shake') }, ms)
  }

  function flash(color = '#ffffff', ms = 300): void {
    fx.style.transition = 'none'
    fx.style.background = color
    fx.style.opacity = '1'
    void fx.offsetWidth
    fx.style.transition = `opacity ${ms}ms ease`
    fx.style.opacity = '0'
  }

  function fadeOut(color = '#000000', ms = 600): Promise<void> {
    fx.style.background = color
    fx.style.transition = `opacity ${ms}ms ease`
    fx.style.opacity = '1'
    return sleep(ms + 40)
  }

  function fadeIn(ms = 600): Promise<void> {
    fx.style.transition = `opacity ${ms}ms ease`
    fx.style.opacity = '0'
    return sleep(ms + 40)
  }

  // ---- 演出脚本运行面 ----
  const scripting: ScriptApiHost = {
    story,
    vars,
    plugins: opts.plugins,
    isDestroyed: () => destroyed,
    getLifecycle: () => lifecycleSeq,
    enterScript: () => { activeScripts++ },
    exitScript: (lifecycle) => { if (lifecycle === lifecycleSeq) activeScripts-- },
    api: {
      say: (speaker, text) => showCard(speaker, text),
      narrate: (text) => showCard('', text),
      wait: (ms) => sleep(ms),
      shake: (intensity, ms) => shake(intensity, ms),
      flash: (color, ms) => flash(color, ms),
      fadeOut: (color, ms) => fadeOut(color, ms),
      fadeIn: (ms) => fadeIn(ms),
      bg: (name, o) => media.setBg(assetUrlByName(name), o?.fade ?? 500),
      sprite: (name, pos, o) => {
        const url = assetUrlByName(name)
        if (!url) return
        const p: SpritePos = o?.x != null ? 'custom' : ((pos ?? 'center') as SpritePos)
        media.setSprite(p, { url, character: o?.character ?? '', x: o?.x ?? null })
      },
      hideSprite: (pos) => media.setSprite((pos ?? 'center') as SpritePos, null),
      bgm: (name, o) => {
        if (!name) {
          media.stopBgm()
          return
        }
        media.playBgm(assetUrlByName(name), clampVolume(o?.volume ?? 80), o?.loop ?? true)
      },
      sfx: (name, o) => {
        const url = assetUrlByName(name)
        if (url) media.playSfx(url, clampVolume(o?.volume ?? 80))
      },
      setStyle: (selector, cssText) => setStyle(selector, cssText),
      css: (cssText) => css(cssText),
      goto: (label) => {
        if (!applyGoto(label)) console.warn(`[StoryLoom] api.goto：找不到名为「${label}」的跳转点/结局节点`)
      }
    }
  }

  // ---- 玩家设置（持久化 + 实时生效） ----
  function updateSettings(patch: Partial<PlayerSettings>): void {
    settings = storage.settings(patch)
    media.setBgmMaster(settings.bgmVolume)
    media.setSfxMaster(settings.sfxVolume)
    if (patch.textSpeed !== undefined && settings.textSpeed === 0) tw.finishTyping()
    if (patch.autoLevel !== undefined) scheduleAuto()
  }

  // ---- 面板与标题画面 ----
  const screens = createScreens({
    stage,
    overlay,
    content,
    story,
    release,
    storage,
    getSettings: () => settings,
    updateSettings,
    resetSettings: () => updateSettings({ ...release.settings.defaults }),
    onOverlayWillOpen: () => { clearAutoTimer(); setSkip(false) },
    onOverlayClosed: () => scheduleAuto(),
    canSave,
    getBacklog: () => backlog,
    captureSave: () => saves.captureSave(),
    restoreSave: (save) => saves.restoreSave(save),
    latestSave,
    nodeLabel: (id) => nodeById.get(id)?.data.label || '',
    assetUrl,
    titleEnabled,
    startGame: () => reset()
  })

  // ---- 存档 ----
  const saves = createSaves({
    storage,
    revision,
    assetKeyByUrl: assetKeysByUrl,
    assetUrl,
    vars,
    backlog,
    media,
    canSave,
    currentNodeId: () => currentId,
    getPresentation: () => ({
      css: ensureStyle('tgr-user-style').textContent ?? '',
      rules: [...dynRules],
      overlayColor: fx.style.background,
      overlayOpacity: fx.style.opacity
    }),
    applyPresentation: (p) => {
      dynRules.clear()
      for (const [selector, rule] of p.rules) dynRules.set(selector, rule)
      ensureStyle('tgr-dyn-style').textContent = [...dynRules].map(([s, c]) => `${s} { ${c} }`).join('\n')
      ensureStyle('tgr-user-style').textContent = p.css
      fx.style.transition = 'none'
      fx.style.background = p.overlayColor
      fx.style.opacity = p.overlayOpacity
    },
    invalidateRun,
    setAuto,
    closeOverlay: () => screens.closeOverlay(),
    hideTitleScreen: () => screens.hideTitleScreen(),
    clearPendingJump: () => { pendingJump = null },
    enter
  })

  function latestSave(): PlayerSave | null {
    let best: PlayerSave | null = null
    for (let i = 1; i <= PLAYER_SLOT_COUNT; i++) {
      const slot = storage.read(i)
      if (slot.kind === 'ready' && (!best || slot.save.savedAt > best.savedAt)) best = slot.save
    }
    return best
  }

  // ---- 对白卡片（普通对白与 api.say 共用；打字机 + 内联标记 + 语音） ----

  /** 显示一张对白卡：打字完成露出「继续」，推进时 resolve。api.say 与对白节点共用。 */
  function showCard(speaker: string, text: string, remember = true, voiceAsset?: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const mk = parseMarkup(text)
      // 语音走音效通道（受音效主音量控制）；快进时跳过；卡片取消不停止——播完即止
      const voiceName = voiceAsset?.trim()
      if (voiceName && !skipEnabled) {
        const voiceUrl = assetUrlByName(voiceName)
        if (voiceUrl) media.playSfx(voiceUrl, 1)
      }
      swap(`
        <div class="tgr-card tgr-fadein">
          ${speaker ? `<div class="tgr-speaker">${esc(speaker)}</div>` : ''}
          <div class="tgr-text"></div>
          <button class="tgr-continue tgr-continue-wait" style="visibility:hidden">继续 ▾</button>
        </div>
      `)
      const seq = cardSeq
      currentTextLength = mk.segs.reduce((n, seg) => n + seg.text.length, 0)
      if (remember) rememberText({ speaker, text: mk.segs.map((seg) => seg.text).join(''), kind: 'dialogue' })
      cardReject = reject
      cardAdvance = () => { cardReject = null; resolve() }
      const textEl = content.querySelector('.tgr-text') as HTMLElement
      const btn = content.querySelector('.tgr-continue') as HTMLButtonElement
      btn.addEventListener('click', (e) => {
        e.stopPropagation()
        handleAdvance()
      })
      if (mk.segs.length === 0) textEl.innerHTML = '<span class="tgr-dim">（此处没有文字）</span>'
      void tw.renderMarkup(textEl, mk).then(() => {
        if (destroyed || seq !== cardSeq) return
        btn.style.visibility = 'visible'
        btn.classList.remove('tgr-continue-wait')
        scheduleAuto()
      })
      content.focus()
    })
  }

  function reset(): void {
    invalidateRun()
    setAuto(false)
    setSkip(false)
    screens.closeOverlay()
    screens.hideTitleScreen()
    backlog.length = 0
    for (const key of Object.keys(vars)) delete vars[key]
    for (const v of story.variables) vars[v.id] = v.initial
    media.setBg('')
    for (const pos of SPRITE_POSITIONS) media.setSprite(pos, null)
    media.stopBgm()
    dynRules.clear()
    ensureStyle('tgr-dyn-style').textContent = ''
    ensureStyle('tgr-user-style').textContent = story.customCss ?? ''
    fx.style.transition = 'none'
    fx.style.opacity = '0'
    pendingJump = null
    currentId = startNodeId
    const lifecycle = lifecycleSeq
    void runBootScripts(scripting).then(() => {
      if (!destroyed && lifecycle === lifecycleSeq) void enter(currentId)
    })
  }

  /** 处理自动节点链（start / variable / jump / 媒体 / 演出脚本），直到停在需要交互的节点 */
  async function enter(id: string | null, restored = false): Promise<void> {
    if (destroyed) return
    const seq = ++runSeq
    safeNode = false
    cancelCard()
    const stale = (): boolean => destroyed || seq !== runSeq
    let cursor = id
    let guard = 0
    while (cursor) {
      if (++guard > 500) {
        renderError('剧情循环过深（自动节点链超过 500 步），请检查变量/跳转节点是否形成死循环。')
        return
      }
      const node = nodeById.get(cursor)
      if (!node) {
        renderError(`找不到节点 ${cursor}，剧情可能被损坏。`)
        return
      }
      warmScene(node.sceneId)
      switch (node.type) {
        case 'start':
        case 'jump': {
          cursor = nextOf(node.id)
          if (!cursor) {
            renderError(node.type === 'start' ? '「开始」节点还没有连接任何剧情。' : '跳转点没有连接去向，剧情在此中断。')
          }
          break
        }
        case 'variable': {
          for (const op of node.data.ops ?? []) {
            if (op.op === 'set') vars[op.variableId] = op.value
            else {
              const base = typeof vars[op.variableId] === 'number' ? (vars[op.variableId] as number) : Number(vars[op.variableId]) || 0
              const delta = Number(op.value) || 0
              vars[op.variableId] = op.op === 'add' ? base + delta : base - delta
            }
          }
          cursor = nextOf(node.id)
          if (!cursor) renderError('变量节点之后没有后续剧情。')
          break
        }
        case 'bg': {
          media.setBg(assetUrl(node.data.asset))
          cursor = nextOf(node.id)
          if (!cursor) renderError('背景节点之后没有后续剧情。')
          break
        }
        case 'sprite': {
          const url = assetUrl(node.data.asset)
          const pos = (node.data.spritePos ?? 'center') as SpritePos
          if (node.data.spriteAction === 'hide') {
            media.setSprite(pos, null)
          } else if (url) {
            media.setSprite(pos, { url, character: node.data.character ?? '', x: node.data.spriteX ?? null })
          }
          cursor = nextOf(node.id)
          if (!cursor) renderError('立绘节点之后没有后续剧情。')
          break
        }
        case 'audio': {
          const url = assetUrl(node.data.asset)
          const volume = clampVolume(node.data.volume ?? 80)
          const kind = node.data.audioKind ?? 'bgm'
          if (node.data.audioAction === 'stop') {
            if (kind === 'bgm') media.stopBgm()
          } else if (url) {
            if (kind === 'bgm') media.playBgm(url, volume, node.data.loop ?? true)
            else media.playSfx(url, volume)
          }
          cursor = nextOf(node.id)
          if (!cursor) renderError('音频节点之后没有后续剧情。')
          break
        }
        case 'script': {
          currentId = node.id
          try {
            await runScript(scripting, node.data.code ?? '')
          } catch (err) {
            if (stale()) return
            renderError(`演出脚本执行出错：${String(err)}`)
            return
          }
          if (stale()) return
          const jump = pendingJump
          pendingJump = null
          cursor = jump ?? nextOf(node.id)
          if (!cursor) renderError('演出脚本节点之后没有后续剧情。')
          break
        }
        case 'dialogue':
          currentId = node.id
          safeNode = true
          void showCard(node.data.speaker ?? '', node.data.text ?? '', !restored, node.data.voiceAsset).then(() => {
            if (!stale()) proceed(null)
          }).catch(() => {})
          return
        case 'choice':
          currentId = node.id
          safeNode = true
          renderChoice(node.id, node.data.options ?? [])
          return
        case 'end':
          currentId = node.id
          safeNode = true
          renderEnd(node.data.label ?? '')
          return
      }
      if (stale()) return
    }
    if (!cursor) renderError('没有可进入的剧情节点。')
  }

  function proceed(handle: string | null = null): void {
    if (!currentId) return
    const target = nextOf(currentId, handle)
    if (!target) {
      renderError('剧情在此中断：当前节点没有连接后续内容。')
      return
    }
    void enter(target)
  }

  // ---- 自定义跳转（演出脚本 api.goto） ----
  function applyGoto(label: string): boolean {
    const t = label.trim()
    if (!t) return false
    const target = story.nodes.find(
      (n) => (n.type === 'jump' || n.type === 'end') && (n.data.label ?? '').trim() === t
    )
    if (target) {
      pendingJump = target.id
      return true
    }
    return false
  }

  // ---- 渲染 ----
  function swap(html: string): void {
    cancelCard()
    content.innerHTML = html
    content.scrollTop = 0
  }

  function renderChoice(nodeId: string, options: ChoiceOption[]): void {
    setAuto(false)
    setSkip(false)
    const visible = options.filter((o) => !o.condition || evalCondition(o.condition, vars))
    if (visible.length === 0) {
      swap(`
        <div class="tgr-card tgr-fadein">
          <div class="tgr-text tgr-dim">（当前没有可选的选项——所有选项都不满足条件。）</div>
          <div class="tgr-choice-list"><button class="tgr-choice" data-target="__restart">返回开始</button></div>
        </div>
      `)
      bindChoices()
      return
    }
    swap(`
      <div class="tgr-card tgr-fadein">
        <div class="tgr-choose-hint">做出选择</div>
        <div class="tgr-choice-list">
          ${visible
            .map(
              (o, i) => `
            <button class="tgr-choice" data-target="${esc(o.id)}">
              ${visible.length > 1 ? `<span class="tgr-key">${i + 1}</span>` : ''}
              <span>${esc(o.text)}</span>
            </button>`
            )
            .join('')}
        </div>
      </div>
    `)
    stage.dataset.node = nodeId
    bindChoices()
    content.focus()
  }

  function bindChoices(): void {
    content.querySelectorAll<HTMLButtonElement>('.tgr-choice').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (screens.isOverlayOpen() || destroyed) return
        const optId = btn.dataset.target
        if (optId === '__restart') {
          reset()
          return
        }
        // 选项 → 端口 handle：choice 节点以 option.id 作为 sourceHandle
        const option = nodeById.get(currentId ?? '')?.data.options?.find((o) => o.id === optId)
        if (option) rememberText({ speaker: '', text: option.text, kind: 'choice' })
        proceed(optId ?? null)
      })
    })
  }

  function renderEnd(label: string): void {
    setAuto(false)
    setSkip(false)
    swap(`
      <div class="tgr-card tgr-fadein tgr-end">
        <div class="tgr-end-mark">—— 完 ——</div>
        ${label ? `<div class="tgr-end-label">${esc(label)}</div>` : ''}
        <button class="tgr-restart-big">↺ 重新开始</button>
      </div>
    `)
    content.querySelector('.tgr-restart-big')?.addEventListener('click', reset)
  }

  function renderError(message: string): void {
    safeNode = false
    setAuto(false)
    setSkip(false)
    swap(`
      <div class="tgr-card tgr-fadein tgr-error">
        <div class="tgr-error-title">剧情无法继续</div>
        <div class="tgr-text">${esc(message)}</div>
        <button class="tgr-restart-big">↺ 重新开始</button>
      </div>
    `)
    content.querySelector('.tgr-restart-big')?.addEventListener('click', reset)
  }

  function cancelCard(): void {
    cardSeq++
    clearAutoTimer()
    tw.cancelTyping()
    cardAdvance = null
    const reject = cardReject
    cardReject = null
    reject?.(new Error('Player card cancelled'))
  }

  function stopTransientMedia(): void {
    media.stopSfx()
    if (shakeTimer !== null) clearTimeout(shakeTimer)
    shakeTimer = null
    stage.classList.remove('tgr-shake')
  }

  function invalidateRun(): void {
    lifecycleSeq++
    runSeq++
    activeScripts = 0
    safeNode = false
    cancelCard()
    stopTransientMedia()
  }

  function rememberText(entry: BacklogEntry): void {
    backlog.push(entry)
    if (backlog.length > BACKLOG_LIMIT) backlog.splice(0, backlog.length - BACKLOG_LIMIT)
  }

  // ---- 自动播放 / 快进 ----
  function clearAutoTimer(): void {
    if (autoTimer !== null) clearTimeout(autoTimer)
    autoTimer = null
  }

  function syncAutoBtn(): void {
    if (!autoBtn) return
    autoBtn.setAttribute('aria-pressed', String(autoEnabled))
    autoBtn.textContent = autoEnabled ? '自动中' : '自动'
  }

  function syncSkipBtn(): void {
    if (!skipBtn) return
    skipBtn.setAttribute('aria-pressed', String(skipEnabled))
    skipBtn.textContent = skipEnabled ? '快进中' : '快进'
  }

  function setAuto(enabled: boolean): void {
    if (enabled) { skipEnabled = false; syncSkipBtn() }
    autoEnabled = enabled && !content.querySelector('.tgr-choice, .tgr-end, .tgr-error')
    syncAutoBtn()
    clearAutoTimer()
    scheduleAuto()
  }

  /** 快进：开启时立即完成当前打字（textSpeed 视为 0、{pause} 跳过），
   *  卡片显示后约 150ms 自动推进；选项/结局/出错、打开面板或再次点击时停止。 */
  function setSkip(enabled: boolean): void {
    if (enabled) {
      autoEnabled = false
      syncAutoBtn()
      tw.finishTyping()
    }
    skipEnabled = enabled && !content.querySelector('.tgr-choice, .tgr-end, .tgr-error')
    syncSkipBtn()
    clearAutoTimer()
    scheduleAuto()
  }

  function scheduleAuto(): void {
    clearAutoTimer()
    if ((!autoEnabled && !skipEnabled) || destroyed || screens.isOverlayOpen() || document.hidden || tw.active || !cardAdvance) return
    const seq = cardSeq
    const delay = skipEnabled ? SKIP_ADVANCE_MS : autoDelay(currentTextLength, settings.autoLevel)
    autoTimer = setTimeout(() => {
      autoTimer = null
      if (seq === cardSeq && !screens.isOverlayOpen() && (autoEnabled || skipEnabled)) handleAdvance()
    }, delay)
  }

  /** 点击/回车推进：打字中 → 先完成打字；否则执行卡片回调 */
  function handleAdvance(): void {
    if (destroyed || screens.isOverlayOpen()) return
    clearAutoTimer()
    if (tw.active) {
      tw.finishTyping()
      return
    }
    const adv = cardAdvance
    cardAdvance = null
    adv?.()
  }

  // ---- 回到标题画面 ----
  function backToTitle(): void {
    invalidateRun()
    setAuto(false)
    setSkip(false)
    screens.closeOverlay()
    media.stopBgm()
    media.stopSfx()
    media.setBg('')
    for (const pos of SPRITE_POSITIONS) media.setSprite(pos, null)
    dynRules.clear()
    ensureStyle('tgr-dyn-style').textContent = ''
    ensureStyle('tgr-user-style').textContent = story.customCss ?? ''
    fx.style.transition = 'none'
    fx.style.opacity = '0'
    pendingJump = null
    currentId = null
    safeNode = false
    screens.showTitleScreen()
  }

  // ---- 可存档判定 ----
  function canSave(): boolean {
    return safeNode && activeScripts === 0 && !!currentId && pendingJump === null
  }

  const onVisibility = (): void => { clearAutoTimer(); if (!document.hidden) scheduleAuto() }
  document.addEventListener('visibilitychange', onVisibility)

  // ---- 交互 ----
  function onStageKey(e: KeyboardEvent): void {
    if (screens.isOverlayOpen()) {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); screens.closeOverlay() }
      return
    }
    if (screens.isTitleVisible()) return
    if (e.ctrlKey || e.metaKey || e.altKey || (e.target as HTMLElement).closest('input, select, textarea, [contenteditable="true"]')) return
    if (e.key.toLowerCase() === 'h') { e.preventDefault(); screens.openBacklog(); return }
    if (e.key.toLowerCase() === 'a') { e.preventDefault(); setAuto(!autoEnabled); return }
    if ((e.target as HTMLElement).closest('button, input, select, textarea')) return
    if (e.key === 'Enter' || e.key === ' ') {
      const hasChoices = content.querySelector('.tgr-choice') !== null
      if (!hasChoices) {
        e.preventDefault()
        handleAdvance()
      }
      return
    }
    const n = Number(e.key)
    if (!isNaN(n) && n >= 1 && n <= 9) {
      const btns = content.querySelectorAll<HTMLButtonElement>('.tgr-choice')
      const btn = btns[n - 1]
      if (btn) {
        e.preventDefault()
        btn.click()
      }
    }
  }

  function onStageClick(e: MouseEvent): void {
    if (screens.isOverlayOpen() || screens.isTitleVisible()) return
    const t = e.target as HTMLElement
    if (t.closest('button')) return
    if (content.querySelector('.tgr-choice')) return
    handleAdvance()
  }

  const onRestart = (): void => reset()
  const onFullscreen = (): void => {
    try {
      if (document.fullscreenElement) void document.exitFullscreen()
      else void container.requestFullscreen().catch(() => {})
    } catch {
      /* 不支持全屏时静默 */
    }
  }
  restartBtn.addEventListener('click', onRestart)
  fsBtn?.addEventListener('click', onFullscreen)
  container.querySelector('.tgr-backlog')?.addEventListener('click', () => screens.openBacklog())
  container.querySelector('.tgr-saves')?.addEventListener('click', () => screens.openSaves())
  container.querySelector('.tgr-settings')?.addEventListener('click', () => screens.openSettings())
  container.querySelector('.tgr-tomenu')?.addEventListener('click', () => backToTitle())
  autoBtn?.addEventListener('click', () => setAuto(!autoEnabled))
  skipBtn?.addEventListener('click', () => setSkip(!skipEnabled))
  container.addEventListener('keydown', onStageKey)
  stage.addEventListener('click', onStageClick)

  // 标题画面启用时先停在标题层（boot 脚本与剧情在「开始游戏」后才执行）
  if (titleEnabled) screens.showTitleScreen()
  else reset()

  return {
    destroy(): void {
      destroyed = true
      preloadedImages.clear()
      invalidateRun()
      media.stopBgm()
      restartBtn.removeEventListener('click', onRestart)
      fsBtn?.removeEventListener('click', onFullscreen)
      container.removeEventListener('keydown', onStageKey)
      stage.removeEventListener('click', onStageClick)
      document.removeEventListener('visibilitychange', onVisibility)
      container.classList.remove('tgr-root')
      container.classList.remove('tgr-vn')
      container.innerHTML = ''
    }
  }
}
