import type { HostApi } from '@shared/api'

declare global {
  interface Window {
    /** Electron 环境 preload 注入；浏览器/Tauri 模式下为 undefined（api.ts 提供对应实现） */
    api?: HostApi
  }
}

/** Vite ?raw 类型声明见 raw.d.ts（需在全局脚本 d.ts 中声明才能生效） */

declare module 'elkjs/lib/elk.bundled.js' {
  export interface ElkNode {
    id?: string
    x?: number
    y?: number
    width?: number
    height?: number
    children?: ElkNode[]
    edges?: { id?: string; sources?: string[]; targets?: string[] }[]
    [key: string]: unknown
  }
  export default class ELK {
    constructor()
    layout(graph: ElkNode): Promise<ElkNode>
  }
}

export {}
