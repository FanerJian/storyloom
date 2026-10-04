import { applyNodeChanges, applyEdgeChanges, addEdge } from '@xyflow/react'
import { installFlowOperations } from '../lib/flowOperations'
import { Toolbar } from './Toolbar'
import { StatusBar } from './StatusBar'
import { StudioWorkspace } from './StudioWorkspace'

installFlowOperations({ applyNodeChanges, applyEdgeChanges, addEdge })

/** 欢迎页之后才加载画布及编辑器组件。 */
export default function Workspace() {
  return (
      <div className="flex h-full flex-col">
        <Toolbar />
        <StudioWorkspace />
        <StatusBar />
      </div>
  )
}
