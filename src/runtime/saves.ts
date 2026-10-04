/**
 * 存档：快照采集（含 240×135 缩略图）与恢复。
 * 存档里只存素材 key 与媒体引用，绝不内嵌 base64 素材数据；
 * media.bgm.volume 存基础音量，恢复时按当前主音量重新相乘。
 */

import type { VarValue } from '@shared/schema'
import { type BacklogEntry, type PlayerSave, type PlayerSpritePos, type PlayerStorage, type SavedSprite } from '../shared/playerState'
import { SPRITE_POSITIONS, type MediaApi } from './media'

export interface SavesHost {
  storage: PlayerStorage
  revision: string
  /** 素材运行时地址 → 素材 key（存档只存 key） */
  assetKeyByUrl: Map<string, string>
  assetUrl(key?: string): string
  vars: Record<string, VarValue>
  backlog: BacklogEntry[]
  media: MediaApi
  canSave(): boolean
  currentNodeId(): string | null
  getPresentation(): PlayerSave['presentation']
  applyPresentation(presentation: PlayerSave['presentation']): void
  invalidateRun(): void
  setAuto(enabled: boolean): void
  closeOverlay(): void
  /** 从标题画面的存档面板读档时同样要收起标题层 */
  hideTitleScreen(): void
  clearPendingJump(): void
  enter(id: string | null, restored?: boolean): void
}

/** 把当前激活背景画成 240×135 缩略图（cover 裁剪 + 自上而下轻微压暗渐变）；
 *  任何异常（跨域污染、无背景、画布不可用）都静默省略。 */
function captureThumbnail(img: HTMLImageElement | null): string | undefined {
  try {
    if (!img || !img.complete || !img.naturalWidth || !img.naturalHeight) return undefined
    const w = 240
    const h = 135
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) return undefined
    const scale = Math.max(w / img.naturalWidth, h / img.naturalHeight)
    const dw = img.naturalWidth * scale
    const dh = img.naturalHeight * scale
    ctx.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh)
    const shade = ctx.createLinearGradient(0, 0, 0, h)
    shade.addColorStop(0, 'rgba(0, 0, 0, 0)')
    shade.addColorStop(1, 'rgba(0, 0, 0, 0.45)')
    ctx.fillStyle = shade
    ctx.fillRect(0, 0, w, h)
    const url = canvas.toDataURL('image/jpeg', 0.6)
    return url.startsWith('data:image/') ? url : undefined
  } catch { /* taint or unavailable canvas: omit silently */ return undefined }
}

export function createSaves(host: SavesHost): { captureSave(): PlayerSave | null; restoreSave(save: PlayerSave): void } {
  function captureSave(): PlayerSave | null {
    if (!host.canSave()) return null
    const nodeId = host.currentNodeId()
    if (!nodeId) return null
    const savedSprites = {} as Record<PlayerSpritePos, SavedSprite | null>
    for (const pos of SPRITE_POSITIONS) {
      const slot = host.media.getSprite(pos)
      const asset = slot ? host.assetKeyByUrl.get(slot.url) ?? null : null
      savedSprites[pos] = slot && asset ? { asset, character: slot.character, x: slot.x ?? null } : null
    }
    const music = host.media.getBgmInfo()
    const musicAsset = music ? host.assetKeyByUrl.get(music.url) ?? null : null
    return {
      version: 1,
      revision: host.revision,
      savedAt: Date.now(),
      nodeId,
      vars: { ...host.vars },
      backlog: host.backlog.map((e) => ({ ...e })),
      thumb: captureThumbnail(host.media.activeBgImage()),
      media: {
        background: host.assetKeyByUrl.get(host.media.bgUrl) ?? null,
        sprites: savedSprites,
        // 存基础音量：恢复时按当前主音量重新相乘
        bgm: music && musicAsset
          ? { asset: musicAsset, volume: music.baseVolume, loop: music.loop, time: music.time }
          : null
      },
      presentation: host.getPresentation()
    }
  }

  function restoreSave(save: PlayerSave): void {
    host.invalidateRun()
    host.setAuto(false)
    host.closeOverlay()
    host.hideTitleScreen()
    const vars = host.vars
    for (const key of Object.keys(vars)) delete vars[key]
    Object.assign(vars, save.vars)
    host.backlog.splice(0, host.backlog.length, ...save.backlog.map((entry) => ({ ...entry })))
    host.clearPendingJump()
    host.media.stopBgm()
    host.media.setBg('')
    host.media.setBg(host.assetUrl(save.media.background ?? undefined), 0)
    for (const pos of SPRITE_POSITIONS) host.media.setSprite(pos, null)
    for (const pos of SPRITE_POSITIONS) {
      const sprite = save.media.sprites[pos]
      if (sprite) host.media.setSprite(pos, { url: host.assetUrl(sprite.asset), character: sprite.character, x: sprite.x })
    }
    host.applyPresentation(save.presentation)
    if (save.media.bgm) {
      const music = save.media.bgm
      // 播放音量 = 基础音量（存档值）× 当前 BGM 主音量
      host.media.playBgm(host.assetUrl(music.asset), music.volume, music.loop, music.time)
    }
    // Only interactive nodes are valid saves. No variable/media/script chain is replayed.
    host.enter(save.nodeId, true)
  }

  return { captureSave, restoreSave }
}
