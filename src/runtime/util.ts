/** 运行时模块共用的小工具：DOM 转义、定时等待、数值收敛。 */

export function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/** 音量节点/脚本给的是 0-100 百分比，运行时统一收敛到 0-1 */
export const clampVolume = (percent: number): number => Math.max(0, Math.min(100, percent)) / 100

export const clampPercent = (v: number): number => Math.max(0, Math.min(100, v))
