/**
 * 媒体层：背景交叉淡化、立绘槽位、BGM 与音效管理。
 * 主音量语义：实际音量 = 节点/脚本指定的基础音量(0-1) × 主音量/100，
 * 因此存档只存基础音量，改主音量可以实时作用于当前 BGM。
 */

export type SpritePos = 'left' | 'center' | 'right' | 'custom'
export const SPRITE_POSITIONS: readonly SpritePos[] = ['left', 'center', 'right', 'custom']

export interface SpriteSlot {
  url: string
  character: string
  /** spritePos === 'custom' 时的水平位置（0-100，立绘中心点占画面宽度百分比） */
  x?: number | null
}

export interface BgmInfo {
  url: string
  /** 基础音量（0-1），实际播放音量还要乘 BGM 主音量 */
  baseVolume: number
  loop: boolean
  time: number
}

export interface MediaHost {
  isDestroyed(): boolean
}

export interface MediaApi {
  setBg(url: string, fadeMs?: number): void
  setSprite(pos: SpritePos, slot: SpriteSlot | null): void
  playBgm(url: string, volume: number, loop: boolean, seekSeconds?: number): void
  stopBgm(): void
  playSfx(url: string, volume: number): void
  stopSfx(): void
  /** BGM 主音量 0-100，实时作用于当前 BGM */
  setBgmMaster(percent: number): void
  /** 音效主音量 0-100，作用于之后播放的音效（含语音） */
  setSfxMaster(percent: number): void
  readonly bgUrl: string
  getSprite(pos: SpritePos): SpriteSlot | null
  /** 当前激活背景的 <img>（无背景时 null），供存档缩略图取材 */
  activeBgImage(): HTMLImageElement | null
  getBgmInfo(): BgmInfo | null
}

export function createMedia(container: HTMLElement, host: MediaHost): MediaApi {
  const bgImgs = [...container.querySelectorAll<HTMLImageElement>('.tgr-bg img')]
  const bgWraps = bgImgs.map((img) => img.parentElement as HTMLElement)
  let bgUrl = ''
  let bgActive = 0
  const sprites: Record<SpritePos, SpriteSlot | null> = { left: null, center: null, right: null, custom: null }
  let bgm: HTMLAudioElement | null = null
  let bgmUrl = ''
  let bgmBaseVolume = 1
  let bgmMaster = 100
  let sfxMaster = 100
  const sfxAudio = new Set<HTMLAudioElement>()

  function setBg(url: string, fadeMs = 500): void {
    if (url === bgUrl) return
    bgUrl = url
    if (!url) {
      for (const w of bgWraps) w.classList.remove('tgr-on')
      return
    }
    const to = 1 - bgActive
    const wrap = bgWraps[to]
    const img = bgImgs[to]
    wrap.style.transitionDuration = `${Math.max(0, fadeMs)}ms`
    bgWraps[bgActive].style.transitionDuration = `${Math.max(0, fadeMs)}ms`
    // 只执行一次：data URL 可能让 complete 立即为真（手动触发）而异步 load 事件仍会来，
    // 不置空会二次执行——把刚加上的 tgr-on 又从自己身上移除（背景闪一下就消失）
    const onLoad = (): void => {
      img.onload = null
      if (host.isDestroyed() || bgUrl !== url) return
      wrap.classList.add('tgr-on')
      bgWraps[bgActive].classList.remove('tgr-on')
      bgActive = to
    }
    img.onload = onLoad
    img.src = url
    if (img.complete) onLoad()
  }

  /** 命名槽位用 CSS 类定位；custom 用内联样式（left = x%，立绘中心点）。
   *  .tgr-sprite 对 left/transform 有过渡，同槽位改 x 会平滑滑动。 */
  function positionSprite(pos: SpritePos, x: number | null | undefined, wrap: HTMLElement): void {
    if (pos === 'custom' && typeof x === 'number' && Number.isFinite(x)) {
      const cx = Math.max(0, Math.min(100, x))
      wrap.style.left = `${cx}%`
      wrap.style.right = 'auto'
      wrap.style.transform = 'translateX(-50%)'
    } else {
      wrap.style.left = ''
      wrap.style.right = ''
      wrap.style.transform = ''
    }
  }

  function setSprite(pos: SpritePos, slot: SpriteSlot | null): void {
    // The custom position shares the center DOM element; keep only the visible slot.
    if (pos === 'custom' || pos === 'center') { sprites.center = null; sprites.custom = null }
    sprites[pos] = slot
    const img = container.querySelector<HTMLImageElement>(`.tgr-sprite-${pos === 'custom' ? 'center' : pos} img`)
    const wrap = container.querySelector<HTMLElement>(`.tgr-sprite-${pos === 'custom' ? 'center' : pos}`)
    if (!img || !wrap) return
    if (slot) {
      positionSprite(pos, slot.x, wrap)
      img.src = slot.url
      wrap.classList.add('tgr-on')
    } else {
      wrap.classList.remove('tgr-on')
      positionSprite(pos, null, wrap)
    }
  }

  const applyBgmVolume = (): void => {
    if (bgm) bgm.volume = Math.max(0, Math.min(1, bgmBaseVolume * (bgmMaster / 100)))
  }

  function seekTo(audio: HTMLAudioElement, time: number): void {
    try { audio.currentTime = time } catch { /* unsupported media */ }
  }

  function playBgm(url: string, volume: number, loop: boolean, seekSeconds = 0): void {
    bgmBaseVolume = Math.max(0, Math.min(1, volume))
    if (bgm && bgmUrl === url) {
      applyBgmVolume()
      bgm.loop = loop
      if (seekSeconds > 0) seekTo(bgm, seekSeconds)
      void bgm.play().catch(() => {})
      return
    }
    stopBgm()
    bgmUrl = url
    bgm = new Audio(url)
    applyBgmVolume()
    bgm.loop = loop
    if (seekSeconds > 0) {
      const audio = bgm
      if (audio.readyState) seekTo(audio, seekSeconds)
      else audio.addEventListener('loadedmetadata', () => { if (audio === bgm) seekTo(audio, seekSeconds) }, { once: true })
    }
    void bgm.play().catch(() => {})
  }

  function stopBgm(): void {
    if (bgm) {
      bgm.pause()
      bgm.src = ''
      bgm = null
      bgmUrl = ''
    }
  }

  function playSfx(url: string, volume: number): void {
    const audio = new Audio(url)
    sfxAudio.add(audio)
    audio.addEventListener('ended', () => sfxAudio.delete(audio), { once: true })
    audio.volume = Math.max(0, Math.min(1, volume * (sfxMaster / 100)))
    void audio.play().catch(() => {})
  }

  function stopSfx(): void {
    for (const audio of sfxAudio) { audio.pause(); audio.src = '' }
    sfxAudio.clear()
  }

  function setBgmMaster(percent: number): void {
    bgmMaster = Math.max(0, Math.min(100, percent))
    applyBgmVolume()
  }

  function setSfxMaster(percent: number): void {
    sfxMaster = Math.max(0, Math.min(100, percent))
  }

  return {
    setBg,
    setSprite,
    playBgm,
    stopBgm,
    playSfx,
    stopSfx,
    setBgmMaster,
    setSfxMaster,
    get bgUrl() { return bgUrl },
    getSprite: (pos) => sprites[pos],
    activeBgImage: () => (bgUrl ? bgImgs[bgActive] : null),
    getBgmInfo: () => (bgm
      ? { url: bgmUrl, baseVolume: bgmBaseVolume, loop: bgm.loop, time: Number.isFinite(bgm.currentTime) ? bgm.currentTime : 0 }
      : null)
  }
}
