import { useMemo } from 'react'
import { useProjectStore } from '../stores/project'
import { validateProject } from '@shared/validate'
import { hostApi } from '../lib/api'
import { truncate } from '../lib/utils'

export function StatusBar() {
  const nodes = useProjectStore((s) => s.nodes)
  const edges = useProjectStore((s) => s.edges)
  const variables = useProjectStore((s) => s.variables)
  const meta = useProjectStore((s) => s.meta)
  const filePath = useProjectStore((s) => s.filePath)
  const dirty = useProjectStore((s) => s.dirty)

  const errorCount = useMemo(
    () =>
      validateProject({
        assets: useProjectStore.getState().assets,
        meta,
        variables,
        nodes,
        edges
      }).filter((i) => i.level === 'error').length,
    [meta, variables, nodes, edges]
  )

  const pathLabel = filePath
    ? hostApi.isElectron()
      ? filePath
      : truncate(filePath, 40)
    : '未保存到文件（浏览器模式保存在本地）'

  return (
    <footer className="flex h-7 flex-none items-center justify-between border-t border-[var(--border)] bg-[var(--surface)] px-3 text-[11px] text-[var(--text-dim)]">
      <div className="flex min-w-0 items-center gap-2">
        <span className={dirty ? 'text-amber-500' : ''}>{dirty ? '● 有未保存更改' : '已保存'}</span>
        <span className="truncate opacity-70">{pathLabel}</span>
      </div>
      <div className="flex flex-none items-center gap-3">
        {errorCount > 0 && <span className="text-rose-500">{errorCount} 个错误</span>}
        <span>{nodes.length} 节点</span>
        <span>{edges.length} 连线</span>
        <span>{variables.length} 变量</span>
      </div>
    </footer>
  )
}
