/**
 * Ink / Yarn 导入导出回环测试（esbuild 打包后由 node 运行）。
 * 运行：npx esbuild scripts/io-test.ts --bundle --platform=node --format=esm --outfile=scripts/.io-test.mjs && node scripts/.io-test.mjs
 */
import { sampleProject } from '../src/renderer/src/lib/sample'
import { vnSampleProject } from '../src/renderer/src/lib/sampleVN'
import { exportInk, parseInk } from '../src/shared/io/ink'
import { exportYarn, parseYarn } from '../src/shared/io/yarn'
import { parsePlugin } from '../src/shared/plugins'
import type { StoryProject } from '../src/shared/schema'

let failures = 0
function check(label: string, cond: boolean, detail = ''): void {
  if (cond) {
    console.log(`  ok  ${label}`)
  } else {
    failures++
    console.error(`FAIL  ${label}${detail ? ` —— ${detail}` : ''}`)
  }
}

function typeCounts(p: StoryProject): Record<string, number> {
  const c: Record<string, number> = {}
  for (const n of p.nodes) c[n.type] = (c[n.type] ?? 0) + 1
  return c
}

console.log('== 1) 示例工程 → Yarn → 回导 ==')
{
  const p1 = sampleProject()
  const { text, warnings } = exportYarn(p1)
  check('导出无告警', warnings.length === 0, warnings.join('；'))
  check('包含开始节点', text.includes('title: Start'))
  const back = parseYarn(text)
  check('回导无未知目标告警', !back.warnings.some((w) => w.includes('未定义')), back.warnings.join('；'))
  const c1 = typeCounts(p1)
  const c2 = typeCounts(back.project)
  check('对话节点数一致', (c2.dialogue ?? 0) === (c1.dialogue ?? 0), `${c1.dialogue} → ${c2.dialogue}`)
  check('选项节点数一致', (c2.choice ?? 0) === (c1.choice ?? 0))
  check('结局节点数一致', (c2.end ?? 0) === (c1.end ?? 0), `${c1.end} → ${c2.end}`)
  check('变量一致', back.project.variables.map((v) => v.name).sort().join(',') === '信任,金币')
  check('条件选项保留', JSON.stringify(back.project.nodes.filter((n) => n.type === 'choice')).includes('">="'))
}

console.log('== 2) 手写 Yarn（外部工具风格）→ 导入 ==')
{
  const yarn = `title: Start
tags:
position: 0,0
---
欢迎来到集市。
<<set $gold = 5>>
你捡到了五枚金币。
[[买面包|Shop]]
[[离开|Leave]]
===
title: Shop
position: 400,0
---
店家： 欢迎光临！
<<if $gold >= 5>>
[[买下宝剑|Smith]]
<<endif>>
===
title: Leave
position: 800,0
---
【完】转身离开
===
title: Smith
position: 400,300
---
铁匠： 好眼力。
<<set $gold -= 5>>
<<jump Leave>>
===
`
  const { project, warnings } = parseYarn(yarn)
  check('无告警', warnings.length === 0, warnings.join('；'))
  const choice = project.nodes.find((n) => n.type === 'choice')
  check('开始节点有 2 个选项', (choice?.data.options ?? []).length === 2)
  const shopChoice = project.nodes.filter((n) => n.type === 'choice')[1]
  check('条件选项导入', shopChoice?.data.options?.[0]?.condition?.op === '>=')
  check('变量初始值', project.variables.find((v) => v.name === 'gold')?.initial === 5)
  check('结局导入', project.nodes.some((n) => n.type === 'end' && n.data.label === '转身离开'))
  check('说话人识别', project.nodes.some((n) => n.type === 'dialogue' && n.data.speaker === '店家'))
  // 金币 -5 后从 Smith 跳回 Leave
  check('jump 成边', project.edges.some((e) => e.source === project.nodes.find((n) => n.type === 'jump')?.id))
}

console.log('== 3) 视觉小说示例 → Yarn → 回导（媒体命令） ==')
{
  const p = vnSampleProject()
  const { text } = exportYarn(p)
  check('背景命令导出', text.includes('<<bg 雪夜车站.svg>>'))
  check('立绘命令导出', text.includes('<<sprite show 小雪（蓝围巾）.svg center 小雪>>'))
  check('音频命令导出', /<<audio bgm play 晚安小调\.wav loop 45>>/.test(text))
  const back = parseYarn(text)
  check('背景节点恢复', back.project.nodes.filter((n) => n.type === 'bg').length === 1)
  check('立绘节点恢复', back.project.nodes.filter((n) => n.type === 'sprite').length === 3)
  check('音频节点恢复', back.project.nodes.filter((n) => n.type === 'audio').length === 2)
  check('素材丢失有提示', back.warnings.some((w) => w.includes('重新选取')))
  const hide = back.project.nodes.find((n) => n.type === 'sprite' && n.data.spriteAction === 'hide')
  check('退场动作保留', hide?.data.spritePos === 'center')

  // 自定义水平位置（x 命令）往返
  const yarnX = `title: Start
---
<<sprite show 立绘 x30 小雪>>
你好。
<<sprite hide x70>>
===
`
  const rx = parseYarn(yarnX)
  const spx = rx.project.nodes.find((n) => n.type === 'sprite' && n.data.spriteAction === 'show')
  check('x 命令导入为自定义位置', spx?.data.spritePos === 'custom' && spx?.data.spriteX === 30, JSON.stringify(spx?.data))
  const { text: textX } = exportYarn(rx.project)
  check('自定义位置导出为 x 命令', textX.includes('x30') && textX.includes('x70'), textX)
}

console.log('== 4) 示例工程 → Ink → 回导 ==')
{
  const p1 = sampleProject()
  const { text, warnings } = exportInk(p1)
  check('导出无告警', warnings.length === 0, warnings.join('；'))
  check('VAR 声明', text.includes('VAR 金币') || text.includes('VAR '))
  check('入口 divert', /^-> \w+/m.test(text))
  const back = parseInk(text)
  const c1 = typeCounts(p1)
  const c2 = typeCounts(back.project)
  check('对话节点数一致', (c2.dialogue ?? 0) === (c1.dialogue ?? 0), `${c1.dialogue} → ${c2.dialogue}`)
  check('选项节点数一致', (c2.choice ?? 0) === (c1.choice ?? 0))
  check('条件选项保留', JSON.stringify(back.project.nodes.filter((n) => n.type === 'choice')).includes('">="'))
  check('回导可达结局', back.project.nodes.filter((n) => n.type === 'end').length >= (c1.end ?? 0) - 1)
}

console.log('== 5) 手写 Ink → 导入 ==')
{
  const ink = `VAR gold = 5

-> Market

=== Market ===
欢迎来到集市。
~ gold += 5
你捡到了一些金币。
* [买面包] -> Shop
* {gold >= 5} [买下宝剑] -> Smith
- 你做了一个决定。
~ gold -= 1

=== Shop ===
店家： 欢迎光临！
-> END

=== Smith ===
铁匠： 好眼力。
-> END
`
  const { project, warnings } = parseInk(ink)
  check('无结构告警', !warnings.some((w) => w.includes('嵌套')), warnings.join('；'))
  const choice = project.nodes.find((n) => n.type === 'choice')
  check('两个选项', (choice?.data.options ?? []).length === 2)
  check('条件选项', choice?.data.options?.[1]?.condition?.op === '>=')
  check('gather 文本', JSON.stringify(project.nodes).includes('你做了一个决定'))
  check('变量', project.variables.find((v) => v.name === 'gold')?.initial === 5)
  check('END 结局', project.nodes.filter((n) => n.type === 'end').length >= 2)
}

console.log('== 6) 视觉小说示例 → Ink（媒体导出为注释） ==')
{
  const p = vnSampleProject()
  const { text, warnings } = exportInk(p)
  check('媒体导出为注释', text.includes('// [背景]'))
  check('媒体告警', warnings.some((w) => w.includes('注释')))
  const back = parseInk(text)
  check('回导成功', back.project.nodes.length > 5)
}

console.log('== 7) 条件取值类型（字符串/布尔） ==')
{
  const yarn = `title: A
---
<<set $name = "小雪">>
<<set $met = true>>
你好。
[[下一幕|B]]
===
title: B
---
<<if $met == true>>
[[握手|A]]
<<endif>>
===
`
  const { project, warnings } = parseYarn(yarn)
  check('无告警', warnings.length === 0, warnings.join('；'))
  check('字符串变量', project.variables.find((v) => v.name === 'name')?.initial === '小雪')
  check('布尔变量', project.variables.find((v) => v.name === 'met')?.type === 'boolean')
  const opt = project.nodes.flatMap((n) => n.data.options ?? []).find((o) => o.condition)
  check('布尔条件', opt?.condition?.value === true)
}

console.log('== 8) 演出脚本 ↔ Yarn 效果命令 ==')
{
  const p: StoryProject = {
    version: 3,
    meta: { title: '演出测试', author: '', description: '' },
    assets: {},
    customCss: '',
    customJs: '',
    variables: [],
    nodes: [
      { id: 's', type: 'start', position: { x: 0, y: 0 }, data: {} },
      { id: 'd1', type: 'dialogue', position: { x: 0, y: 0 }, data: { speaker: '小雪', text: '听——' } },
      {
        id: 'sc',
        type: 'script',
        position: { x: 0, y: 0 },
        data: {
          code: `// 雷声演出\nawait api.flash('#dfe8ff', 260)\nawait api.shake(7, 500)\nawait api.wait(200)\nawait api.say('旁白', '闷雷。')\nvars.勇气 += 1`
        }
      },
      { id: 'e', type: 'end', position: { x: 0, y: 0 }, data: { label: '终' } }
    ],
    edges: [
      { id: 'e1', source: 's', sourceHandle: null, target: 'd1' },
      { id: 'e2', source: 'd1', sourceHandle: null, target: 'sc' },
      { id: 'e3', source: 'sc', sourceHandle: null, target: 'e' }
    ]
  }
  const { text } = exportYarn(p)
  check('闪光命令', text.includes('<<flash #dfe8ff 260>>'), text)
  check('震屏命令', text.includes('<<shake 7 500>>'))
  check('等待命令', text.includes('<<wait 200>>'))
  check('注释行转注释', text.includes('// 雷声演出'))
  check('对白保留为 js 行', text.includes("<<js await api.say('旁白', '闷雷。')>>"))
  check('变量行保留为 js', text.includes('<<js vars.勇气 += 1>>'))
  const back = parseYarn(text)
  check('脚本节点恢复', back.project.nodes.filter((n) => n.type === 'script').length === 1)
  const sc = back.project.nodes.find((n) => n.type === 'script')
  const code = sc?.data.code ?? ''
  // shake/flash 是同步接口，回环后不保留 await；wait/say 异步接口由糖命令/js 行原样带回
  check(
    '脚本代码回环一致',
    code.includes("api.flash('#dfe8ff', 260)") &&
      code.includes('api.shake(7, 500)') &&
      code.includes('await api.wait(200)') &&
      code.includes("await api.say('旁白', '闷雷。')") &&
      code.includes('vars.勇气 += 1'),
    code
  )

  // 手写外部 yarn：糖命令与未知命令都应进入演出脚本节点
  const yarn = `title: Start
---
<<shake>>
<<flash red>>
<<fadeout 400>>
<<fadein>>
<<wait 500>>
<<rain heavy>>
你好。
[[下一幕|B]]
===
title: B
---
【完】好
===
`
  const r2 = parseYarn(yarn)
  check('外部 yarn 无未知命令告警之外的问题', !r2.warnings.some((w) => w.includes('无法解析')), r2.warnings.join('；'))
  const sc2 = r2.project.nodes.find((n) => n.type === 'script')
  const c2 = sc2?.data.code ?? ''
  check(
    '糖命令导入',
    c2.includes('api.shake()') &&
      c2.includes("api.flash('red')") &&
      c2.includes('await api.fadeOut(400)') &&
      c2.includes('await api.fadeIn()') &&
      c2.includes('await api.wait(500)'),
    c2
  )
  check('未知命令保留为脚本行', c2.includes('rain heavy'), c2)
  const scriptIdx = r2.project.nodes.findIndex((n) => n.type === 'script')
  const dialogueIdx = r2.project.nodes.findIndex((n) => n.type === 'dialogue')
  check('顺序：脚本段先于文本', scriptIdx >= 0 && dialogueIdx >= 0 && scriptIdx < dialogueIdx)
}

console.log('== 9) 演出脚本 → Ink（注释） ==')
{
  const p: StoryProject = {
    version: 3,
    meta: { title: '演出测试', author: '', description: '' },
    assets: {},
    customCss: '',
    customJs: '',
    variables: [],
    nodes: [
      { id: 's', type: 'start', position: { x: 0, y: 0 }, data: {} },
      { id: 'sc', type: 'script', position: { x: 0, y: 0 }, data: { code: 'await api.shake(8, 400)' } },
      { id: 'd1', type: 'dialogue', position: { x: 0, y: 0 }, data: { speaker: '', text: '震了一下。' } },
      { id: 'e', type: 'end', position: { x: 0, y: 0 }, data: { label: '终' } }
    ],
    edges: [
      { id: 'e1', source: 's', sourceHandle: null, target: 'sc' },
      { id: 'e2', source: 'sc', sourceHandle: null, target: 'd1' },
      { id: 'e3', source: 'd1', sourceHandle: null, target: 'e' }
    ]
  }
  const { text, warnings } = exportInk(p)
  check('演出导出为注释', text.includes('// [演出]') && text.includes('// await api.shake(8, 400)'))
  check('有告警', warnings.some((w) => w.includes('注释')))
  const back = parseInk(text)
  check('Ink 回导仍成功（脚本丢失有据可查）', back.project.nodes.some((n) => n.type === 'dialogue'))
}

console.log('== 10) 插件解析（apiVersion 校验与兜底） ==')
{
  const ok = parsePlugin({
    name: '主题',
    editorCss: 'body{}',
    runtimeJs: 'api.shake()'
  })
  check('缺省字段兜底', ok.plugin !== null && ok.plugin.id.length > 0 && ok.plugin.version === '0.0.1', ok.error)
  check('由名称生成 id', (ok.plugin?.id.startsWith('plugin-') ?? false) && ok.notice !== undefined, ok.plugin?.id)
  const full = parsePlugin({
    id: 'my-skin',
    name: '皮肤',
    version: '2.1.0',
    author: '某人',
    description: '描述',
    apiVersion: 1,
    editorCss: 'a',
    editorJs: 'b',
    runtimeCss: 'c',
    runtimeJs: 'd'
  })
  check('完整字段保留', full.plugin?.id === 'my-skin' && full.plugin.version === '2.1.0' && full.plugin.runtimeJs === 'd')
  const badVersion = parsePlugin({ id: 'x', name: '旧插件', apiVersion: 99 })
  check('apiVersion 不匹配被拒', badVersion.plugin === null && (badVersion.error ?? '').includes('99'))
  const badJson = parsePlugin('{ 坏掉的 json')
  check('坏 JSON 被拒', badJson.plugin === null)
  const notObject = parsePlugin('[1,2]')
  check('非对象被拒', notObject.plugin === null)
}

console.log(failures === 0 ? '\n全部通过 ✓' : `\n${failures} 项失败 ✗`)
process.exit(failures === 0 ? 0 : 1)
