/**
 * StoryLoom 插件（.loomplugin，JSON）。
 *
 * 一个插件 = 四段代码，按作用面拆分：
 * - editorCss / editorJs：注入编辑器（换肤、扩展编辑器行为）
 * - runtimeCss / runtimeJs：注入试玩与导出的可玩 HTML（作品演出与外观）
 *
 * 兼容性约定：
 * - apiVersion 必须等于 PLUGIN_API_VERSION 才能载入——主程序升级若改动
 *   插件接口，会同步抬高此值并保留旧版加载逻辑（加载失败只告警不停机）。
 * - editorJs 运行环境拿到 window.StoryLoom 上下文（见 renderer/pluginsContext.ts）；
 *   runtimeJs 与演出脚本同环境（api / vars / story），可 await。
 * - 除 id/name/apiVersion 外所有字段可选，缺省按空串处理，未来新增字段
 *   一律可选，保证旧插件向前兼容。
 */

export const PLUGIN_API_VERSION = 1
export const PLUGIN_FILE_EXT = 'loomplugin'

export interface LoomPlugin {
  id: string
  name: string
  version: string
  author: string
  description: string
  apiVersion: number
  editorCss: string
  editorJs: string
  runtimeCss: string
  runtimeJs: string
}

export function emptyPlugin(): LoomPlugin {
  return {
    id: '',
    name: '未命名插件',
    version: '0.0.1',
    author: '',
    description: '',
    apiVersion: PLUGIN_API_VERSION,
    editorCss: '',
    editorJs: '',
    runtimeCss: '',
    runtimeJs: ''
  }
}

export interface PluginParseResult {
  plugin: LoomPlugin | null
  error?: string
  /** 非致命提示（如 id 冲突已自动改名） */
  notice?: string
}

const ID_P = /^[A-Za-z0-9_-]{1,64}$/

/** 解析并归一化插件 JSON：字段缺失兜底、apiVersion 强校验。 */
export function parsePlugin(raw: unknown): PluginParseResult {
  if (typeof raw === 'string') {
    try {
      raw = JSON.parse(raw)
    } catch (err) {
      return { plugin: null, error: `不是有效的 JSON：${String(err)}` }
    }
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { plugin: null, error: '插件文件内容必须是 JSON 对象。' }
  }
  const o = raw as Record<string, unknown>
  if (o.apiVersion !== undefined && o.apiVersion !== PLUGIN_API_VERSION) {
    return {
      plugin: null,
      error: `插件接口版本不兼容：需要 apiVersion ${PLUGIN_API_VERSION}，插件声明为 ${String(o.apiVersion)}。`
    }
  }
  const name = typeof o.name === 'string' && o.name.trim() ? o.name.trim() : '未命名插件'
  let id = typeof o.id === 'string' ? o.id.trim() : ''
  let notice: string | undefined
  if (!ID_P.test(id)) {
    // 由名称生成合法 id（插件库内唯一性由调用方处理）
    const slug = name
      .toLowerCase()
      .replace(/[^\da-z]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48)
    id = slug || `plugin-${Date.now().toString(36)}`
    notice = `插件 id 缺失或不合法，已按名称生成为「${id}」。`
  }
  const str = (v: unknown): string => (typeof v === 'string' ? v : '')
  return {
    plugin: {
      id,
      name,
      version: str(o.version).trim() || '0.0.1',
      author: str(o.author).trim(),
      description: str(o.description).trim(),
      apiVersion: PLUGIN_API_VERSION,
      editorCss: str(o.editorCss),
      editorJs: str(o.editorJs),
      runtimeCss: str(o.runtimeCss),
      runtimeJs: str(o.runtimeJs)
    },
    notice
  }
}

/** 运行时注入用的裁剪形态（进入试玩/导出 HTML 的部分） */
export interface RuntimePluginChunk {
  id: string
  css: string
  js: string
}

export function runtimeChunk(p: LoomPlugin): RuntimePluginChunk {
  return { id: p.id, css: p.runtimeCss, js: p.runtimeJs }
}

/** 插件在哪些作用面有代码（管理面板徽标用） */
export function pluginScopes(p: LoomPlugin): { editor: boolean; runtime: boolean } {
  return {
    editor: !!(p.editorCss.trim() || p.editorJs.trim()),
    runtime: !!(p.runtimeCss.trim() || p.runtimeJs.trim())
  }
}
