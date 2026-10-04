import type { applyNodeChanges, applyEdgeChanges, addEdge } from '@xyflow/react'

type FlowOperations = {
  applyNodeChanges: typeof applyNodeChanges
  applyEdgeChanges: typeof applyEdgeChanges
  addEdge: typeof addEdge
}
let operations: FlowOperations | undefined

/** 由懒加载的画布安装官方算法，欢迎页不加载整个 React Flow。 */
export function installFlowOperations(value: FlowOperations): void { operations = value }
export function getFlowOperations(): FlowOperations {
  if (!operations) throw new Error('画布尚未加载')
  return operations
}
