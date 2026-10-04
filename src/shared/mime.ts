/**
 * 素材扩展名 → MIME 映射（main 进程导入与渲染层 Tauri/浏览器回退共用，单一来源）。
 * 不引入任何 Node 依赖：shared 同时被打进渲染层与 main 包。
 */
export const MIME_BY_EXT: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  m4a: 'audio/mp4'
}

/** 按文件名取 MIME；未知扩展名返回 undefined（调用方提示「不支持的素材格式」） */
export function mimeForName(name: string): string | undefined {
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  return MIME_BY_EXT[ext]
}
