import { app, dialog, Menu, type BrowserWindow, type MenuItemConstructorOptions } from 'electron'

export type MenuAction =
  | 'project:new'
  | 'project:open'
  | 'project:import'
  | 'project:save'
  | 'project:saveAs'
  | 'project:export'
  | 'project:exportYarn'
  | 'project:exportInk'
  | 'edit:undo'
  | 'edit:redo'
  | 'edit:layout'
  | 'view:playtest'
  | 'view:custom'
  | 'view:plugins'

const isMac = process.platform === 'darwin'

export function buildAppMenu(getWindow: () => BrowserWindow | null): Menu {
  const send = (action: MenuAction): MenuItemConstructorOptions['click'] => (_item, win) => {
    const target = (win as BrowserWindow | undefined) ?? getWindow()
    target?.webContents.send('menu:action', action)
  }

  const template: MenuItemConstructorOptions[] = [
    ...(isMac ? [{ role: 'appMenu' as const }] : []),
    {
      label: '文件',
      submenu: [
        { label: '新建工程', accelerator: 'CmdOrCtrl+N', click: send('project:new') },
        { label: '打开工程…', accelerator: 'CmdOrCtrl+O', click: send('project:open') },
        { label: '导入（工程 / Yarn / Ink）…', accelerator: 'CmdOrCtrl+I', click: send('project:import') },
        { type: 'separator' },
        { label: '保存', accelerator: 'CmdOrCtrl+S', click: send('project:save') },
        { label: '另存为…', accelerator: 'CmdOrCtrl+Shift+S', click: send('project:saveAs') },
        { type: 'separator' },
        {
          label: '导出为',
          submenu: [
            { label: '可玩 HTML…', accelerator: 'CmdOrCtrl+E', click: send('project:export') },
            { label: 'Yarn 脚本…', click: send('project:exportYarn') },
            { label: 'Ink 脚本…', click: send('project:exportInk') }
          ]
        },
        ...(isMac ? [] : [{ type: 'separator' as const }, { role: 'quit' as const, label: '退出' }])
      ]
    },
    {
      label: '编辑',
      submenu: [
        { label: '撤销', accelerator: 'CmdOrCtrl+Z', click: send('edit:undo') },
        { label: '重做', accelerator: 'CmdOrCtrl+Shift+Z', click: send('edit:redo') },
        { type: 'separator' },
        { label: '自动整理布局', accelerator: 'CmdOrCtrl+Shift+L', click: send('edit:layout') }
      ]
    },
    {
      label: '视图',
      submenu: [
        { label: '试玩', accelerator: 'F5', click: send('view:playtest') },
        { label: '自定义接口…', accelerator: 'CmdOrCtrl+U', click: send('view:custom') },
        { label: '插件管理…', accelerator: 'CmdOrCtrl+Alt+P', click: send('view:plugins') },
        { type: 'separator' },
        { role: 'togglefullscreen', label: '全屏', accelerator: 'F11' },
        { type: 'separator' },
        { role: 'resetZoom', label: '实际大小' },
        { role: 'zoomIn', label: '放大' },
        { role: 'zoomOut', label: '缩小' }
      ]
    },
    {
      label: '帮助',
      submenu: [
        {
          label: '关于 StoryLoom',
          click: () => {
            const win = getWindow()
            if (win) {
              dialog.showMessageBox(win, {
                type: 'info',
                title: '关于',
                message: `StoryLoom v${app.getVersion()}`,
                detail: '现代化文字游戏编辑器 · 分支叙事 · 节点画布'
              })
            }
          }
        }
      ]
    }
  ]

  return Menu.buildFromTemplate(template)
}
