import type { StoryAsset } from './schema'

// 摘要仅缓存在内存中；旧工程无需新增字段，也不会被重新编号或删除素材。
// 素材对象在工程 store 中以不可变方式增删，弱缓存不会持有已删除的素材。
const hashes = new WeakMap<StoryAsset, Promise<string | null>>()

/** 按文件内容计算 SHA-256，文件名与 data URL 的 MIME/编码形式不参与比较。 */
export async function hashAssetDataUrl(dataUrl: string): Promise<string> {
  const comma = dataUrl.indexOf(',')
  if (!dataUrl.startsWith('data:') || comma < 0) throw new Error('素材不是有效的 data URL')
  const header = dataUrl.slice(5, comma)
  const payload = decodeURIComponent(dataUrl.slice(comma + 1))
  let bytes: Uint8Array<ArrayBuffer>
  if (/;base64(?:;|$)/i.test(header)) {
    const binary = atob(payload)
    bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  } else {
    bytes = new TextEncoder().encode(payload)
  }
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

/** 旧库延迟建立内容索引；无法解码的旧素材保留原样，不影响正常素材导入。 */
export async function findAssetByContent(
  assets: Record<string, StoryAsset>,
  type: StoryAsset['type'],
  hash: string
): Promise<string | undefined> {
  for (const [key, asset] of Object.entries(assets)) {
    if (asset.type !== type) continue
    if (asset.contentHash === hash) return key
    let pending = hashes.get(asset)
    if (!pending) {
      pending = hashAssetDataUrl(asset.dataUrl).catch(() => null)
      hashes.set(asset, pending)
    }
    if ((await pending) === hash) return key
  }
  return undefined
}
