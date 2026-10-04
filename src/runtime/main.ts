import { mountPlayer } from './player'
import type { RuntimePluginChunk } from '@shared/plugins'
import type { StoryProject } from '@shared/schema'
import './shell.css'

const story = (window as unknown as { __STORY__: StoryProject }).__STORY__
const plugins =
  (window as unknown as { __PLUGINS__?: RuntimePluginChunk[] }).__PLUGINS__ ?? []
const app = document.getElementById('app')

if (app && story && typeof story === 'object' && Array.isArray(story.nodes)) {
  mountPlayer(app, story, { plugins })
} else {
  document.body.innerHTML =
    '<p style="color:#f87171;font-family:system-ui;padding:2rem">剧情数据缺失，无法开始游戏。</p>'
}
