/**
 * 界面面板：回看 / 存读档 / 设置 / 关于 的 overlay，以及标题画面的 DOM 与事件绑定。
 * overlay 的打开/关闭通过宿主钩子通知 player（暂停快进、恢复自动播放），
 * 面板内部不直接触碰剧情管线。
 */

import type { ReleaseConfig, StoryProject } from '@shared/schema'
import { BACKLOG_LIMIT, PLAYER_SLOT_COUNT,
  type BacklogEntry, type PlayerSave, type PlayerSettings, type PlayerStorage, type SlotResult } from '../shared/playerState'
import { esc } from './util'

export interface ScreensHost {
  /** 标题画面挂在舞台内（overlay z-index 更高，可盖在标题之上） */
  stage: HTMLElement
  overlay: HTMLElement
  content: HTMLElement
  story: StoryProject
  release: ReleaseConfig
  storage: PlayerStorage
  getSettings(): PlayerSettings
  /** 持久化并实时生效（文字速度 0 时完成打字、主音量实时应用等由宿主处理） */
  updateSettings(patch: Partial<PlayerSettings>): void
  resetSettings(): void
  /** overlay 打开（暂停快进/清掉推进定时器）与关闭（恢复自动播放调度） */
  onOverlayWillOpen(): void
  onOverlayClosed(): void
  canSave(): boolean
  getBacklog(): BacklogEntry[]
  captureSave(): PlayerSave | null
  restoreSave(save: PlayerSave): void
  /** 继续游戏：6 槽中 savedAt 最新的 ready 存档（没有则 null） */
  latestSave(): PlayerSave | null
  nodeLabel(nodeId: string): string
  assetUrl(key?: string): string
  /** 标题画面总开关（PlayerOptions.titleScreen ?? release.titleScreen.enabled） */
  titleEnabled: boolean
  /** 标题画面「开始游戏」：宿主负责收起标题层并 reset（boot 脚本 + 进入剧情） */
  startGame(): void
}

export interface Screens {
  openBacklog(): void
  openSaves(message?: string): void
  openSettings(): void
  openAbout(): void
  closeOverlay(): void
  isOverlayOpen(): boolean
  showTitleScreen(): void
  hideTitleScreen(): void
  isTitleVisible(): boolean
}

export function createScreens(host: ScreensHost): Screens {
  let overlayOpen = false
  let titleEl: HTMLElement | null = null
  let titleHideTimer: ReturnType<typeof setTimeout> | null = null

  // ---- overlay 外壳 ----

  function openOverlay(title: string, html: string): void {
    overlayOpen = true
    host.onOverlayWillOpen()
    host.content.inert = true
    host.overlay.hidden = false
    host.overlay.innerHTML = `<section class="tgr-panel" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <div class="tgr-panel-heading"><h2>${esc(title)}</h2><button class="tgr-tool tgr-close" aria-label="关闭">关闭 ×</button></div>
      ${html}</section>`
    host.overlay.querySelector('.tgr-close')?.addEventListener('click', closeOverlay)
    host.overlay.querySelector<HTMLButtonElement>('.tgr-close')?.focus()
  }

  function closeOverlay(): void {
    if (!overlayOpen) return
    overlayOpen = false
    host.overlay.hidden = true
    host.overlay.innerHTML = ''
    host.content.inert = false
    host.content.focus()
    host.onOverlayClosed()
  }

  // ---- 回看 ----

  function openBacklog(): void {
    const backlog = host.getBacklog()
    openOverlay('文本回看', `<div class="tgr-history">${backlog.length ? backlog.map((entry) => `
      <article class="tgr-history-entry ${entry.kind === 'choice' ? 'tgr-history-choice' : ''}">
        ${entry.speaker ? `<div class="tgr-speaker">${esc(entry.speaker)}</div>` : ''}
        <div>${entry.kind === 'choice' ? '▸ ' : ''}${esc(entry.text)}</div></article>`).join('') :
      '<p class="tgr-dim">还没有阅读记录。</p>'}</div><p class="tgr-panel-note">保留最近 ${BACKLOG_LIMIT} 条对白与选择。</p>`)
    const history = host.overlay.querySelector('.tgr-history') as HTMLElement
    history.scrollTop = history.scrollHeight
  }

  // ---- 存读档 ----

  function openSaves(message = ''): void {
    const slots: SlotResult[] = Array.from({ length: PLAYER_SLOT_COUNT }, (_, i) => host.storage.read(i + 1))
    const saveAllowed = host.canSave() && host.storage.available
    const note = !host.storage.available ? '浏览器存储不可用或空间不足，存档无法写入。游戏仍可继续。' :
      !host.canSave() ? '演出脚本执行中或剧情正在切换，请到普通对白、选项或结局后存档。' :
      '存档记录当前对白、变量、画面与回看；读档后自动播放暂停。'
    openOverlay('存档与读档', `<p class="tgr-panel-note" role="status">${esc(message || note)}</p>
      <div class="tgr-slots">${slots.map((slot, i) => {
        const preview = slot.kind === 'ready' ? slot.save.backlog.at(-1)?.text || host.nodeLabel(slot.save.nodeId) || '剧情进度' : ''
        const label = slot.kind === 'ready' ? new Date(slot.save.savedAt).toLocaleString() : slot.kind === 'invalid' ? '存档损坏或作品版本已更新' : '空槽位'
        const thumb = slot.kind === 'ready' && slot.save.thumb
          ? `<img class="tgr-slot-thumb" src="${esc(slot.save.thumb)}" alt="存档画面缩略图" draggable="false" />`
          : '<span class="tgr-slot-thumb tgr-thumb-empty" aria-hidden="true"></span>'
        return `<article class="tgr-slot">${thumb}<div class="tgr-slot-info"><strong>槽位 ${i + 1}</strong>
          <span>${esc(label)}</span><p>${esc(preview.slice(0, 90))}</p></div><div class="tgr-slot-actions">
          <button class="tgr-tool" data-save="${i + 1}" ${saveAllowed ? '' : 'disabled'}>存档</button>
          <button class="tgr-tool" data-load="${i + 1}" ${slot.kind === 'ready' ? '' : 'disabled'}>读档</button>
          <button class="tgr-tool" data-delete="${i + 1}" ${slot.kind === 'empty' ? 'disabled' : ''}>删除</button>
        </div></article>`
      }).join('')}</div>`)
    host.overlay.querySelectorAll<HTMLButtonElement>('[data-save]').forEach((btn) => btn.addEventListener('click', () => {
      const save = host.captureSave()
      const ok = save && host.storage.write(Number(btn.dataset.save), save)
      openSaves(ok ? '存档成功。' : '存档失败：当前时点不安全或浏览器存储不可用 / 空间不足。')
    }))
    host.overlay.querySelectorAll<HTMLButtonElement>('[data-load]').forEach((btn) => btn.addEventListener('click', () => {
      const slot = host.storage.read(Number(btn.dataset.load))
      if (slot.kind === 'ready') host.restoreSave(slot.save)
      else openSaves('该存档无法恢复：数据损坏或作品版本已更新。')
    }))
    host.overlay.querySelectorAll<HTMLButtonElement>('[data-delete]').forEach((btn) => btn.addEventListener('click', () => {
      openSaves(host.storage.remove(Number(btn.dataset.delete)) ? '存档已删除。' : '浏览器无法删除存档。')
    }))
  }

  // ---- 设置 ----

  function openSettings(): void {
    const s = host.getSettings()
    const cfg = host.release.settings
    const rows: string[] = []
    if (cfg.textSpeed) rows.push(`<label class="tgr-setting"><span class="tgr-setting-head">文字速度<output class="tgr-speed-out">${s.textSpeed} ms</output></span>
      <input class="tgr-speed" type="range" min="0" max="100" step="1" value="${s.textSpeed}" /></label>`)
    if (cfg.autoSpeed) rows.push(`<label class="tgr-setting"><span class="tgr-setting-head">自动播放速度<output class="tgr-auto-out">${s.autoLevel}</output></span>
      <input class="tgr-autolevel" type="range" min="1" max="10" step="1" value="${s.autoLevel}" /></label>`)
    if (cfg.bgmVolume) rows.push(`<label class="tgr-setting"><span class="tgr-setting-head">BGM 音量<output class="tgr-bgm-out">${s.bgmVolume}%</output></span>
      <input class="tgr-bgm-volume" type="range" min="0" max="100" step="1" value="${s.bgmVolume}" /></label>`)
    if (cfg.sfxVolume) rows.push(`<label class="tgr-setting"><span class="tgr-setting-head">音效音量<output class="tgr-sfx-out">${s.sfxVolume}%</output></span>
      <input class="tgr-sfx-volume" type="range" min="0" max="100" step="1" value="${s.sfxVolume}" /></label>`)
    openOverlay('设置', `
      <div class="tgr-settings-bar"><button class="tgr-tool tgr-settings-reset" type="button">恢复默认</button></div>
      <div class="tgr-settings-list">${rows.join('')}</div>
      <p class="tgr-panel-note">0 为立即显示。对白里的 {speed} 标记优先于全局文字速度；主音量与节点/脚本指定的音量相乘；设置会保存在本浏览器。</p>`)
    const bind = (inputCls: string, outCls: string, format: (v: number) => string, patch: (v: number) => Partial<PlayerSettings>): void => {
      const input = host.overlay.querySelector<HTMLInputElement>(inputCls)
      input?.addEventListener('input', () => {
        const v = Number(input.value)
        host.updateSettings(patch(v))
        const out = host.overlay.querySelector<HTMLOutputElement>(outCls)
        if (out) out.textContent = format(v)
      })
    }
    bind('.tgr-speed', '.tgr-speed-out', (v) => `${v} ms`, (v) => ({ textSpeed: v }))
    bind('.tgr-autolevel', '.tgr-auto-out', (v) => String(v), (v) => ({ autoLevel: v }))
    bind('.tgr-bgm-volume', '.tgr-bgm-out', (v) => `${v}%`, (v) => ({ bgmVolume: v }))
    bind('.tgr-sfx-volume', '.tgr-sfx-out', (v) => `${v}%`, (v) => ({ sfxVolume: v }))
    host.overlay.querySelector('.tgr-settings-reset')?.addEventListener('click', () => {
      host.resetSettings()
      openSettings()
    })
  }

  // ---- 关于 ----

  function openAbout(): void {
    const version = host.release.version
    openOverlay('关于', `<div class="tgr-about">
      <h3 class="tgr-about-title">${esc(host.story.meta.title || '未命名故事')}</h3>
      ${host.story.meta.author ? `<div class="tgr-about-author">${esc(host.story.meta.author)}</div>` : ''}
      ${version ? `<div class="tgr-about-version">v ${esc(version)}</div>` : ''}
      <div class="tgr-about-credits">${esc(host.release.credits)}</div>
    </div>`)
  }

  // ---- 标题画面 ----

  function showTitleScreen(): void {
    if (titleHideTimer !== null) { clearTimeout(titleHideTimer); titleHideTimer = null }
    if (!titleEl) {
      titleEl = buildTitleScreen()
      host.stage.appendChild(titleEl)
    }
    const continueBtn = titleEl.querySelector<HTMLButtonElement>('.tgr-title-continue')
    if (continueBtn) continueBtn.disabled = !host.latestSave()
    titleEl.classList.remove('tgr-leaving')
    titleEl.hidden = false
  }

  /** 淡出标题层（约 280ms 过渡）；开始/继续/读档共用，转场期间剧情已在背后运行 */
  function hideTitleScreen(): void {
    const el = titleEl
    if (!el || el.hidden) return
    el.classList.add('tgr-leaving')
    if (titleHideTimer !== null) clearTimeout(titleHideTimer)
    titleHideTimer = setTimeout(() => {
      titleHideTimer = null
      if (titleEl === el) el.hidden = true
    }, 300)
  }

  function buildTitleScreen(): HTMLElement {
    const t = host.release.titleScreen
    const el = document.createElement('div')
    el.className = 'tgr-title-screen'
    const label = (value: string, fallback: string): string => (value.trim() ? value : fallback)
    const bgKey = t.backgroundAsset.trim()
    const bg = bgKey ? host.assetUrl(bgKey) : ''
    el.innerHTML = `
      <div class="tgr-title-bg${bg ? '' : ' tgr-title-plain'}" aria-hidden="true"></div>
      <div class="tgr-title-inner">
        ${t.showMeta ? `<div class="tgr-title-meta">
          <h1 class="tgr-title-name">${esc(host.story.meta.title || '未命名故事')}</h1>
          ${host.story.meta.author ? `<div class="tgr-title-author">${esc(host.story.meta.author)}</div>` : ''}
        </div>` : ''}
        ${t.showVersion && host.release.version ? `<div class="tgr-title-version">v ${esc(host.release.version)}</div>` : ''}
        <nav class="tgr-title-menu">
          <button class="tgr-title-item tgr-title-start" type="button">${esc(label(t.labels.start, '开始游戏'))}</button>
          <button class="tgr-title-item tgr-title-continue" type="button">${esc(label(t.labels.continue, '继续游戏'))}</button>
          <button class="tgr-title-item tgr-title-load" type="button">${esc(label(t.labels.load, '读取存档'))}</button>
          <button class="tgr-title-item tgr-title-settings" type="button">${esc(label(t.labels.settings, '设置'))}</button>
          ${host.release.credits ? `<button class="tgr-title-item tgr-title-credits" type="button">${esc(label(t.labels.credits, '关于'))}</button>` : ''}
        </nav>
      </div>`
    if (bg) (el.querySelector('.tgr-title-bg') as HTMLElement).style.backgroundImage = `url("${bg}")`
    el.querySelector('.tgr-title-start')?.addEventListener('click', () => {
      hideTitleScreen()
      host.startGame()
    })
    el.querySelector('.tgr-title-continue')?.addEventListener('click', () => {
      const save = host.latestSave()
      if (save) host.restoreSave(save) // restoreSave 内部会收起标题层
    })
    el.querySelector('.tgr-title-load')?.addEventListener('click', () => openSaves())
    el.querySelector('.tgr-title-settings')?.addEventListener('click', () => openSettings())
    el.querySelector('.tgr-title-credits')?.addEventListener('click', () => openAbout())
    return el
  }

  return {
    openBacklog,
    openSaves,
    openSettings,
    openAbout,
    closeOverlay,
    isOverlayOpen: () => overlayOpen,
    showTitleScreen,
    hideTitleScreen,
    isTitleVisible: () => !!titleEl && !titleEl.hidden
  }
}
