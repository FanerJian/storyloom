import { useState } from 'react'
import { PackageOpen, Plug, Plus, Trash2 } from 'lucide-react'
import { usePluginsStore } from '../stores/plugins'
import { useUiStore } from '../stores/ui'
import { hostApi } from '../lib/api'
import { Badge, Button, Modal } from './ui'
import { pluginScopes, PLUGIN_API_VERSION, PLUGIN_FILE_EXT } from '@shared/plugins'

/**
 * 插件管理：安装（导入 .loomplugin / .json）、启停、卸载。
 * 插件分两个作用面：编辑器（换肤/扩展编辑器）与作品（试玩+导出 HTML 的演出与外观）。
 */
export function PluginsModal() {
  const open = useUiStore((s) => s.pluginsOpen)
  const close = useUiStore((s) => s.closePlugins)
  const plugins = usePluginsStore((s) => s.plugins)
  const enabled = usePluginsStore((s) => s.enabled)
  const toggle = usePluginsStore((s) => s.toggle)
  const remove = usePluginsStore((s) => s.remove)
  const importText = usePluginsStore((s) => s.importText)
  const [busy, setBusy] = useState(false)

  if (!open) return null

  const doImport = async (): Promise<void> => {
    setBusy(true)
    try {
      const res = await hostApi.openTextFile(
        [
          { name: 'StoryLoom 插件', extensions: [PLUGIN_FILE_EXT, 'json'] },
          { name: 'JSON 文件', extensions: ['json'] }
        ],
        '安装插件'
      )
      if (res.canceled) return
      if (res.error) return
      if (res.content != null) importText(res.content)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open
      onClose={close}
      width={680}
      title={
        <span className="flex items-center gap-2">
          <Plug size={15} className="text-cyan-400" />
          插件管理
          <Badge tone="accent">apiVersion {PLUGIN_API_VERSION}</Badge>
        </span>
      }
    >
      <div className="flex min-h-[420px] flex-col gap-3 p-4">
        <div className="flex items-center justify-between">
          <p className="text-[12px] leading-relaxed text-[var(--text-dim)]">
            插件 = 一个 JSON 文件（<code>.{PLUGIN_FILE_EXT}</code>），可同时携带
            <Badge tone="purple">编辑器</Badge>与<Badge tone="green">作品</Badge>两面的 CSS / JS。
            启用后立即生效：编辑器面注入本窗口，作品面注入试玩与导出的可玩 HTML。
          </p>
          <Button variant="primary" size="md" className="ml-3 flex-none" disabled={busy} onClick={() => void doImport()}>
            <Plus size={14} />
            安装插件…
          </Button>
        </div>

        {plugins.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-[var(--border)] p-8 text-center text-[12px] text-[var(--text-dim)]">
            <PackageOpen size={28} className="opacity-40" />
            还没有安装任何插件。
            <span className="opacity-70">把 .loomplugin 文件带到这里，或参考 README 里的插件格式自己写一个。</span>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {plugins.map((p) => {
              const scopes = pluginScopes(p)
              const on = !!enabled[p.id]
              return (
                <div
                  key={p.id}
                  className="flex items-center gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2.5"
                >
                  <label className="flex cursor-pointer items-center" title={on ? '停用' : '启用'}>
                    <input type="checkbox" checked={on} onChange={() => toggle(p.id)} className="h-4 w-4 accent-indigo-500" />
                  </label>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-[13px] font-semibold">{p.name}</span>
                      <span className="flex-none font-mono text-[10px] text-[var(--text-dim)]">v{p.version}</span>
                      {scopes.editor && <Badge tone="purple">编辑器</Badge>}
                      {scopes.runtime && <Badge tone="green">作品</Badge>}
                    </div>
                    <div className="truncate text-[11px] text-[var(--text-dim)]">
                      {p.description || '（无描述）'}
                      {p.author ? ` · ${p.author}` : ''} · id: {p.id}
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 flex-none hover:text-rose-500"
                    title="卸载插件"
                    onClick={() => remove(p.id)}
                  >
                    <Trash2 size={13} />
                  </Button>
                </div>
              )
            })}
          </div>
        )}

        <details className="rounded-xl border border-[var(--border)] p-3 text-[12px] text-[var(--text-dim)]">
          <summary className="cursor-pointer select-none font-medium text-[var(--text)]">插件格式与可用接口</summary>
          <pre className="mt-2 overflow-x-auto rounded-lg bg-[var(--surface)] p-3 font-mono text-[11px] leading-relaxed">{`{
  "id": "my-skin",
  "name": "我的主题",
  "version": "1.0.0",
  "author": "",
  "description": "",
  "apiVersion": ${PLUGIN_API_VERSION},
  "editorCss": "/* 编辑器换肤 */",
  "editorJs":  "/* 可用 window.StoryLoom 上下文 */",
  "runtimeCss": "/* 作品换肤（试玩+导出） */",
  "runtimeJs": "/* 演出脚本，可用 api / vars / story，可 await */"
}`}</pre>
          <p className="mt-2 leading-relaxed">
            editorJs 上下文：<code>slp.project.get()/getState()/subscribe(cb)</code>、
            <code>slp.ui.openPlaytest()/openCustom()/openPlugins()</code>、
            <code>slp.toast.*</code>、<code>slp.version</code>。
            runtimeJs 与演出脚本节点完全同环境（<code>api.say/shake/fadeOut/…</code>）。
            apiVersion 不匹配的插件会被拒绝载入——这是兼容性保证：主程序升级若改变接口，会同步升版本并说明迁移方式。
          </p>
        </details>
      </div>
    </Modal>
  )
}
