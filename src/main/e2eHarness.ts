import { app, BrowserWindow } from 'electron'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * 开发用 E2E 钩子：FABLELOOM_E2E=<png输出目录> 时自动执行操作流并截图后退出。
 * （可选 FABLELOOM_E2E_EXPORT=<html> 会额外驱动导出的单文件成品。）
 *
 * 约定与踩坑（改动前必读）：
 * - 建议配 FABLELOOM_DATA_DIR=独立目录 运行：否则与正式实例共用 userData，
 *   每轮都会堆积恢复快照（hydrate 变慢）并污染最近列表/插件库。
 * - 恢复快照弹窗会逐个排队弹出（pending[0]），必须循环点「稍后」清空。
 * - 所有弹窗的关闭钮共用 aria-label="关闭"：点 DOM 里最后一个（最上层）。
 * - 0.5+ 打开工程默认进「剧本」视图：画布断言前先经「创作」菜单切到节点画布。
 * - 工具栏下拉菜单的菜单项（自定义接口/插件管理等）在展开前不在 DOM 里。
 */
export async function runE2E(win: BrowserWindow): Promise<void> {
  const e2eOut = process.env['FABLELOOM_E2E'] ?? ''
  const shot = async (name: string): Promise<void> => {
    const img = await win.webContents.capturePage()
    writeFileSync(join(e2eOut, name), img.toPNG())
  }
  const js = (code: string): Promise<unknown> => win.webContents.executeJavaScript(code)
  const click = (code: string): Promise<unknown> => js(code)
  /** 轮询直到 code 返回真值或超时；超时不抛错（截图会缺步骤，日志留痕） */
  const waitFor = async (code: string, timeout = 8000, interval = 200): Promise<unknown> => {
    const deadline = Date.now() + timeout
    let value: unknown = null
    while (Date.now() < deadline) {
      value = await js(code)
      if (value) return value
      await new Promise((r) => setTimeout(r, interval))
    }
    return value
  }
  const dismissRecovery = async (): Promise<void> => {
    for (let i = 0; i < 12; i++) {
      if (!(await js(`[...document.querySelectorAll('button')].some(b => b.textContent?.trim() === '稍后')`))) return
      await click(`(() => { const b = [...document.querySelectorAll('button')].find(x => x.textContent?.trim() === '稍后'); b?.click(); })()`)
      await new Promise((r) => setTimeout(r, 250))
    }
  }
  const closeTopModal = async (): Promise<void> => {
    await click(`(() => { const xs = [...document.querySelectorAll('[aria-label="关闭"]')]; xs[xs.length - 1]?.click(); })()`)
  }
  /** 打开示例工程（欢迎页卡片）并切到节点画布；返回是否成功 */
  const openSampleOnCanvas = async (): Promise<void> => {
    await click(`(() => { const b = [...document.querySelectorAll('button')].find(x => x.textContent?.includes('雪落车站')); b?.click(); })()`)
    await dismissRecovery()
    await waitFor(`!!document.querySelector('[data-testid="studio-workspace"], .react-flow__node')`, 15000)
    // 默认进剧本视图 → 经「创作」菜单切到节点画布
    await click(`(() => { const b = [...document.querySelectorAll('button')].find(x => x.textContent?.includes('创作')); b?.click(); })()`)
    await waitFor(`[...document.querySelectorAll('button')].some(x => x.textContent?.trim() === '节点画布')`, 5000)
    await click(`(() => { const b = [...document.querySelectorAll('button')].find(x => x.textContent?.trim() === '节点画布'); b?.click(); })()`)
    const canvas = await waitFor(`!!document.querySelector('.react-flow__node')`, 10000)
    if (!canvas) console.error('[e2e] node canvas did not appear')
  }
  /** 打开「工具」下拉菜单里的菜单项 */
  const openToolMenuItem = async (label: string): Promise<void> => {
    await click(`(() => { const b = [...document.querySelectorAll('button')].find(x => x.textContent?.trim() === '工具'); b?.click(); })()`)
    await waitFor(`[...document.querySelectorAll('button')].some(x => x.textContent?.trim() === '${label}')`, 5000)
    await click(`(() => { const b = [...document.querySelectorAll('button')].find(x => x.textContent?.trim() === '${label}'); b?.click(); })()`)
  }

  await waitFor(`!!document.querySelector('button')`, 10000)
  await dismissRecovery()
  await new Promise((r) => setTimeout(r, 400))
  await shot('01-welcome.png')

  // 载入视觉小说示例 → 节点画布
  await openSampleOnCanvas()
  await new Promise((r) => setTimeout(r, 1000))
  await shot('02-vn-canvas.png')

  // 选中「小雪」立绘节点 → Inspector 素材表单
  await click(`(() => { const el = [...document.querySelectorAll('.react-flow__node')].find(x => x.textContent?.includes('小雪')); el?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 })); el?.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0 })); el?.dispatchEvent(new MouseEvent('click', { bubbles: true })); })()`)
  await new Promise((r) => setTimeout(r, 500))
  await shot('03-vn-inspector.png')

  // 自动布局
  await click(`window.dispatchEvent(new Event('fableloom:autolayout'))`)
  await new Promise((r) => setTimeout(r, 1500))
  await shot('04-vn-layout.png')

  // 试玩：视觉小说演出（背景 + 立绘 + 对白贴底）——等播放器真实渲染出对白卡
  await click(`window.dispatchEvent(new Event('fableloom:playtest'))`)
  const cardVisible = await waitFor(`!!document.querySelector('.tgr-card')`, 15000)
  await new Promise((r) => setTimeout(r, 400))
  await shot('05-vn-playtest.png')
  if (!cardVisible) console.error('[e2e] playtest card never appeared')

  // 连续推进到选项（途中经过演出脚本节点：闪光/震屏后显示一句旁白，需一次点击）
  for (let i = 0; i < 8; i++) {
    if (await waitFor(`!!document.querySelector('.tgr-choice')`, 1500)) break
    await click(`[...document.querySelectorAll('.tgr-continue')].pop()?.click()`)
  }
  await new Promise((r) => setTimeout(r, 400))
  await shot('06-vn-choice.png')
  await click(`(() => { const b = [...document.querySelectorAll('.tgr-choice')].find(b => b.textContent?.includes('一起等')); b?.click(); })()`)
  // 等下一张卡片打字完成（「继续」钮脱离等待态）再截，避免帧序错位
  await waitFor(`(() => { const b = document.querySelector('.tgr-continue'); return !!b && !b.closest('.tgr-card')?.querySelector('.tgr-continue-wait') })()`, 8000)
  await new Promise((r) => setTimeout(r, 300))
  await shot('07-vn-second.png')
  for (let i = 0; i < 14; i++) {
    await click(`[...document.querySelectorAll('.tgr-continue')].pop()?.click()`)
    if (await waitFor(`!!document.querySelector('.tgr-end-mark')`, 1500)) break
  }
  await new Promise((r) => setTimeout(r, 300))
  await shot('08-vn-end.png')

  // 关闭试玩 → 回编辑器
  await closeTopModal()
  await waitFor(`!document.querySelector('.tgr-card')`, 4000)
  await new Promise((r) => setTimeout(r, 300))

  // 自定义接口面板：CSS/JS 编辑 + 接口文档
  await openToolMenuItem('自定义接口')
  await waitFor(`!!document.querySelector('textarea')`, 6000)
  await new Promise((r) => setTimeout(r, 300))
  await shot('09-custom-css.png')
  await click(`(() => { const b = [...document.querySelectorAll('button')].find(x => x.textContent?.trim() === '接口文档'); b?.click(); })()`)
  await new Promise((r) => setTimeout(r, 300))
  await shot('10-custom-docs.png')
  await closeTopModal()
  await new Promise((r) => setTimeout(r, 300))

  // 发布设置面板（标题画面/玩家设置/快捷菜单配置 + 实时预览）——工具栏直入按钮
  await click(`(() => { const b = [...document.querySelectorAll('button')].find(x => x.getAttribute('aria-label') === '发布设置' || x.title?.includes('发布设置')); b?.click(); })()`)
  const releaseOpen = await waitFor(`[...document.querySelectorAll('h2,div')].some(x => x.textContent?.trim() === '标题画面')`, 6000)
  if (!releaseOpen) console.error('[e2e] release modal did not open')
  await new Promise((r) => setTimeout(r, 400))
  await shot('09b-release-settings.png')
  await closeTopModal()
  await new Promise((r) => setTimeout(r, 300))

  // 插件系统：种入演示插件（编辑器 CSS + 作品 CSS）后刷新，验证双端注入
  await click(`(() => {
    const p = { id: 'demo-skin', name: 'E2E 演示皮肤', version: '1.0.0', author: 'E2E', description: '验证插件注入', apiVersion: 1,
      editorCss: 'header { box-shadow: inset 0 -2px 0 #22d3ee; }',
      runtimeCss: '.tgr-vn .tgr-card { border-color: #22d3ee !important; border-width: 2px; }',
      editorJs: '', runtimeJs: '' }
    localStorage.setItem('fableloom.plugins.v1', JSON.stringify([p]))
    localStorage.setItem('fableloom.plugins.enabled.v1', JSON.stringify({ 'demo-skin': true }))
    location.reload()
  })()`)
  // 刷新后：欢迎页重新水合（工程不会自动恢复），清空恢复弹窗后重新进入
  await waitFor(`[...document.querySelectorAll('button')].some(x => x.textContent?.includes('雪落车站')) || !!document.querySelector('[data-testid="editor-toolbar"]')`, 15000)
  await dismissRecovery()
  await openSampleOnCanvas()
  await new Promise((r) => setTimeout(r, 800))
  await shot('11-plugin-editor.png')

  // 试玩，验证作品面插件（对白卡青色描边）
  await click(`window.dispatchEvent(new Event('fableloom:playtest'))`)
  await waitFor(`!!document.querySelector('.tgr-card')`, 15000)
  await new Promise((r) => setTimeout(r, 400))
  await shot('12-plugin-playtest.png')
  await closeTopModal()
  await waitFor(`!document.querySelector('.tgr-card')`, 4000)
  await new Promise((r) => setTimeout(r, 300))

  // 插件管理面板
  await openToolMenuItem('插件管理')
  const pluginsOpen = await waitFor(`[...document.querySelectorAll('h2,div')].some(x => x.textContent?.includes('E2E 演示皮肤'))`, 6000)
  if (!pluginsOpen) console.error('[e2e] plugin manager did not open')
  await new Promise((r) => setTimeout(r, 300))
  await shot('13-plugin-manager.png')
  await closeTopModal()
  await new Promise((r) => setTimeout(r, 300))

  // 导出的单文件 HTML 成品验证（export-demo 生成）
  const exportedPath = process.env['FABLELOOM_E2E_EXPORT']
  if (exportedPath) {
    const win2 = new BrowserWindow({ show: false, width: 1280, height: 820 })
    await win2.loadFile(exportedPath)
    win2.show()
    const shot2 = async (name: string): Promise<void> => {
      const img = await win2.webContents.capturePage()
      writeFileSync(join(e2eOut, name), img.toPNG())
    }
    const js2 = (code: string): Promise<unknown> => win2.webContents.executeJavaScript(code)
    const waitFor2 = async (code: string, timeout = 8000, interval = 200): Promise<unknown> => {
      const deadline = Date.now() + timeout
      let value: unknown = null
      while (Date.now() < deadline) {
        value = await js2(code)
        if (value) return value
        await new Promise((r) => setTimeout(r, interval))
      }
      return value
    }
    await waitFor2(`!!document.querySelector('.tgr-title-screen, .tgr-card')`, 8000)
    await new Promise((r) => setTimeout(r, 600))
    await shot2('14-exported-title.png')
    // 0.6+ 导出默认带标题画面：点「开始游戏」（兼容旧产物：无标题时直接推进）
    await js2(`[...document.querySelectorAll('.tgr-title-start')].pop()?.click() ?? [...document.querySelectorAll('button')].find(b => b.textContent?.includes('继续'))?.click()`)
    await waitFor2(`!!document.querySelector('.tgr-card')`, 8000)
    await new Promise((r) => setTimeout(r, 400))
    await shot2('15-exported-start.png')
    for (let i = 0; i < 10; i++) {
      if (await waitFor2(`!!document.querySelector('.tgr-choice')`, 1500)) break
      await js2(`[...document.querySelectorAll('.tgr-continue')].pop()?.click()`)
    }
    await new Promise((r) => setTimeout(r, 400))
    await shot2('16-exported-choice.png')
    // 选「买下宝剑」走条件路径（金币初始 10，选项应可见）
    await js2(`[...document.querySelectorAll('button')].find(b => b.textContent?.includes('买下宝剑'))?.click()`)
    for (let i = 0; i < 10; i++) {
      if (await waitFor2(`!!document.querySelector('.tgr-end-mark')`, 1500)) break
      await js2(`[...document.querySelectorAll('.tgr-continue')].pop()?.click()`)
    }
    await new Promise((r) => setTimeout(r, 400))
    await shot2('17-exported-end.png')
    win2.destroy()
  }

  void app.quit()
}
