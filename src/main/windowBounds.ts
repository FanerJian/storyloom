export interface WorkArea { x: number; y: number; width: number; height: number }
export interface WindowBounds {
  x?: number
  y?: number
  width: number
  height: number
  maximized: boolean
}

/** DIP 坐标；保留仍可见的副屏位置，将失效位置钳回工作区。 */
export function clampWindowBounds(bounds: WindowBounds, area: WorkArea): WindowBounds {
  const width = Math.round(Math.min(Math.max(bounds.width, Math.min(900, area.width)), area.width))
  const height = Math.round(Math.min(Math.max(bounds.height, Math.min(600, area.height)), area.height))
  const x = Number.isFinite(bounds.x) ? bounds.x! : area.x + (area.width - width) / 2
  const y = Number.isFinite(bounds.y) ? bounds.y! : area.y + (area.height - height) / 2
  return {
    x: Math.round(Math.min(Math.max(x, area.x), area.x + area.width - width)),
    y: Math.round(Math.min(Math.max(y, area.y), area.y + area.height - height)),
    width, height, maximized: bounds.maximized
  }
}
