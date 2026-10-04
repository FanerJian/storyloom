import { uid, type NodeType, type StoryEdge, type StoryNode } from '@shared/schema'

export const NODE_META: Record<
  NodeType,
  { label: string; desc: string; color: string; width: number; estHeight: number }
> = {
  start: { label: '开始', desc: '剧情入口', color: '#10b981', width: 170, estHeight: 64 },
  dialogue: { label: '对白', desc: '说话人与正文', color: '#6366f1', width: 250, estHeight: 110 },
  choice: { label: '选项', desc: '分支选择', color: '#f59e0b', width: 250, estHeight: 120 },
  variable: { label: '变量', desc: '修改数值/状态', color: '#06b6d4', width: 240, estHeight: 100 },
  jump: { label: '跳转', desc: '命名锚点，整理画布', color: '#a855f7', width: 200, estHeight: 70 },
  end: { label: '结束', desc: '一个结局', color: '#f43f5e', width: 170, estHeight: 70 },
  bg: { label: '背景', desc: '切换背景图', color: '#0ea5e9', width: 220, estHeight: 96 },
  sprite: { label: '立绘', desc: '登场/退场/换位', color: '#ec4899', width: 220, estHeight: 110 },
  audio: { label: '音乐音效', desc: 'BGM / 音效播放', color: '#14b8a6', width: 220, estHeight: 100 },
  script: { label: '演出脚本', desc: '自定义效果 API（震屏/闪光/转场/连续对白…）', color: '#8b5cf6', width: 230, estHeight: 96 }
}

/** 哪些类型/端口是单出口（新连线替换旧连线） */
export function isSingleOut(node: StoryNode): boolean {
  return node.type !== 'choice'
}

export function makeEdge(source: string, sourceHandle: string | null, target: string): StoryEdge {
  return { id: uid('e_'), source, sourceHandle, target }
}

export function nodeTitle(n: StoryNode): string {
  switch (n.type) {
    case 'start':
      return '开始'
    case 'end':
      return n.data.label?.trim() || '结束'
    case 'jump':
      return n.data.label?.trim() || '跳转点'
    case 'dialogue':
      return n.data.text?.trim() ? (n.data.speaker?.trim() || '旁白') : '对白'
    case 'choice':
      return '选项'
    case 'variable':
      return '变量操作'
    case 'bg':
      return '背景'
    case 'sprite':
      return n.data.character?.trim() || '立绘'
    case 'audio':
      return n.data.audioKind === 'sfx' ? '音效' : '音乐'
    case 'script': {
      const first = (n.data.code ?? '').split('\n').find((l) => l.trim())
      return first ? first.trim().slice(0, 20) : '演出脚本'
    }
  }
}

export function optionOutCount(edges: StoryEdge[], nodeId: string, optionId: string): number {
  return edges.filter((e) => e.source === nodeId && (e.sourceHandle ?? null) === optionId).length
}
