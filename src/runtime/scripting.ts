/**
 * 演出脚本运行面：编译执行 script 节点代码 / 工程级 customJs / 插件脚本，
 * 顶层可用 await；api / vars / story 三个入参注入。
 * 生命周期校验语义保持不变：invalidateRun（重开/读档/销毁）之后，
 * 仍在执行的旧脚本触碰 api 或 vars 会立即抛出 Player run cancelled。
 */

import type { ScriptApi, StoryProject, VarValue } from '@shared/schema'
import type { RuntimePluginChunk } from '@shared/plugins'

export interface ScriptApiHost {
  story: StoryProject
  vars: Record<string, VarValue>
  plugins?: RuntimePluginChunk[]
  isDestroyed(): boolean
  /** 当前运行生命周期序号；invalidateRun 时递增 */
  getLifecycle(): number
  enterScript(): void
  exitScript(lifecycle: number): void
  /** 演出 API 实现（player 侧注入，依赖媒体/打字机/特效等模块） */
  api: Pick<ScriptApi,
    'say' | 'narrate' | 'wait' | 'shake' | 'flash' | 'fadeOut' | 'fadeIn'
    | 'bg' | 'sprite' | 'hideSprite' | 'bgm' | 'sfx' | 'setStyle' | 'css' | 'goto'>
}

function makeApi(host: ScriptApiHost, check: () => void): ScriptApi {
  const api: ScriptApi = { ...host.api }
  return new Proxy(api, {
    get(target, key: keyof ScriptApi) {
      const fn = target[key] as (...args: unknown[]) => unknown
      if (typeof fn !== 'function') return fn
      return (...args: unknown[]) => {
        check()
        const value = fn(...args)
        if (value instanceof Promise) return value.then((result) => { check(); return result })
        return value
      }
    }
  })
}

/** 编译并执行脚本片段：顶层可用 await；api / vars / story 注入 */
export async function runScript(host: ScriptApiHost, code: string): Promise<void> {
  const trimmed = code.trim()
  if (!trimmed) return
  const lifecycle = host.getLifecycle()
  const check = (): void => { if (host.isDestroyed() || lifecycle !== host.getLifecycle()) throw new Error('Player run cancelled') }
  const fn = new Function(
    'api',
    'vars',
    'story',
    `"use strict";\nreturn (async () => {\n${trimmed}\n})();`
  ) as (a: ScriptApi, v: Record<string, VarValue>, s: StoryProject) => Promise<void>
  const scriptVars = new Proxy(host.vars, {
    set(target, key: string, value: VarValue) { check(); target[key] = value; return true },
    deleteProperty(target, key: string) { check(); delete target[key]; return true },
    defineProperty(target, key, descriptor) { check(); return Reflect.defineProperty(target, key, descriptor) }
  })
  host.enterScript()
  try { await fn(makeApi(host, check), scriptVars, host.story) }
  finally { host.exitScript(lifecycle) }
}

// 每次开始游玩先完成工程级/插件初始化；读档直接恢复快照，不重复初始化。
export async function runBootScripts(host: ScriptApiHost): Promise<void> {
  const lifecycle = host.getLifecycle()
  if (host.story.customJs?.trim()) {
    try {
      await runScript(host, host.story.customJs)
    } catch (err) {
      if (host.isDestroyed() || lifecycle !== host.getLifecycle()) return
      console.error('[StoryLoom] 自定义 JS 执行出错：', err)
    }
  }
  for (const pl of host.plugins ?? []) {
    if (host.isDestroyed() || lifecycle !== host.getLifecycle()) return
    if (!pl.js?.trim()) continue
    try {
      await runScript(host, pl.js)
    } catch (err) {
      if (host.isDestroyed() || lifecycle !== host.getLifecycle()) return
      console.error(`[StoryLoom] 插件「${pl.id}」运行脚本出错：`, err)
    }
  }
}
