import { useEffect } from 'react'
import { usePluginsStore } from '../stores/plugins'
import { toast } from '../stores/toast'
import { getPluginsContext } from '../lib/pluginsContext'

/**
 * 编辑器插件注入宿主：
 * - editorCss → <style id="loom-plugin-css-{id}">，随启停增删
 * - editorJs → 本次会话每个插件只执行一次，注入 window.StoryLoom 上下文；
 *   禁用/重新启用不重复执行（插件需自带清理逻辑，文档有说明）
 */
const executed = new Set<string>()
const CSS_PREFIX = 'loom-plugin-css-'

export function PluginHost() {
  const plugins = usePluginsStore((s) => s.plugins)
  const enabled = usePluginsStore((s) => s.enabled)
  const active = plugins.filter((p) => enabled[p.id])
  const activeKey = active.map((p) => `${p.id}@${p.version}`).join('|')

  useEffect(() => {
    const doc = document
    for (const p of active) {
      if (!p.editorCss.trim()) continue
      let el = doc.getElementById(CSS_PREFIX + p.id) as HTMLStyleElement | null
      if (!el) {
        el = doc.createElement('style')
        el.id = CSS_PREFIX + p.id
        doc.head.appendChild(el)
      }
      el.textContent = p.editorCss
    }
    doc.querySelectorAll(`style[id^="${CSS_PREFIX}"]`).forEach((el) => {
      const id = (el as HTMLElement).id.slice(CSS_PREFIX.length)
      const still = active.find((p) => p.id === id)
      if (!still || !still.editorCss.trim()) el.remove()
    })
    // activeKey 概括 active 列表（id@version），避免每次渲染重跑
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeKey])

  useEffect(() => {
    for (const p of active) {
      if (!p.editorJs.trim()) continue
      const key = `${p.id}@${p.version}`
      if (executed.has(key)) continue
      executed.add(key)
      try {
        const fn = new Function('slp', `"use strict";\n${p.editorJs}`)
        fn(getPluginsContext())
      } catch (err) {
        toast.error(`插件「${p.name}」编辑器脚本出错：${String(err)}`)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeKey])

  return null
}
