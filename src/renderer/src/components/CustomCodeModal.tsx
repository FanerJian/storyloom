import { useState, type ReactNode } from 'react'
import { Braces, BookOpen, Paintbrush, SquareTerminal } from 'lucide-react'
import { useProjectStore } from '../stores/project'
import { useUiStore } from '../stores/ui'
import { Badge, Modal } from './ui'
import type { ScriptApi } from '@shared/schema'

/**
 * 自定义代码面板：工程级 CSS / JS 编辑 + 内置接口文档。
 * customCss 注入试玩与导出 HTML；customJs 在运行时启动时执行一次，
 * 与演出脚本节点共用同一套 api / vars / story 接口。
 */

type Tab = 'css' | 'js' | 'docs'

const API_DOCS: { sig: string; desc: string }[] = [
  { sig: 'say', desc: 'await api.say(说话人, 文本) — 显示一句对白，点击「继续」后继续执行' },
  { sig: 'narrate', desc: 'await api.narrate(文本) — 无说话人对白，同上' },
  { sig: 'wait', desc: 'await api.wait(毫秒) — 停顿' },
  { sig: 'shake', desc: 'api.shake(强度px=8, 时长ms=400) — 屏幕震动' },
  { sig: 'flash', desc: "api.flash(颜色='#fff', 时长ms=300) — 全屏闪光后淡出" },
  { sig: 'fadeOut', desc: "await api.fadeOut(颜色='#000', 时长ms=600) — 遮罩淡入（转场出）" },
  { sig: 'fadeIn', desc: 'await api.fadeIn(时长ms=600) — 遮罩淡出（转场入）' },
  { sig: 'bg', desc: "api.bg('素材名', { fade: 500 }) — 切换背景（交叉淡化）" },
  { sig: 'sprite', desc: "api.sprite('素材名', 'left'|'center'|'right', { character: '角色名', x: 30 }) — 显示立绘；传 x（0-100，画面宽度百分比）时自定义水平位置" },
  { sig: 'hideSprite', desc: "api.hideSprite('center') — 移除立绘" },
  { sig: 'bgm', desc: "api.bgm('素材名', { volume: 80, loop: true }) — 播放 BGM；api.bgm('') 停止" },
  { sig: 'sfx', desc: "api.sfx('素材名', { volume: 80 }) — 播放一次音效" },
  { sig: 'setStyle', desc: "api.setStyle('.tgr-card', 'background:#123') — 注入/更新动态样式规则" },
  { sig: 'css', desc: 'api.css(一段CSS) — 追加自定义样式' },
  { sig: 'goto', desc: "api.goto('跳转点名称') — 脚本结束后跳到指定跳转点/结局" },
  { sig: 'vars', desc: 'vars.变量名 — 直接读写故事变量（如 vars.好感 += 1）' },
  { sig: 'story', desc: 'story.meta / story.nodes … — 只读访问工程数据' }
]

const MARKUP_DOCS: [string, string][] = [
  ['{color:#ff6b6b}文字{/color}', '彩色文字'],
  ['{size:120%}文字{/size}', '放大文字'],
  ['{b}加粗{/b} · {i}斜体{/i}', '加粗 / 斜体'],
  ['{speed:24}', '从此处起打字机速度（ms/字，0=立即显示）'],
  ['{pause:500}', '此处停顿指定毫秒'],
  ['{{', '输出字面「{」']
]

const YARN_DOCS = [
  '<<shake [强度 时长]>>',
  '<<flash [颜色 时长]>>',
  '<<fadeout [ms]>>',
  '<<fadein [ms]>>',
  '<<wait ms>>',
  '<<js 任意脚本行>>'
]

export function CustomCodeModal() {
  const open = useUiStore((s) => s.customOpen)
  const close = useUiStore((s) => s.closeCustom)
  const customCss = useProjectStore((s) => s.customCss)
  const customJs = useProjectStore((s) => s.customJs)
  const setCustomCode = useProjectStore((s) => s.setCustomCode)
  const [tab, setTab] = useState<Tab>('css')

  if (!open) return null

  const tabs: { key: Tab; label: string; icon: ReactNode }[] = [
    { key: 'css', label: '自定义 CSS', icon: <Paintbrush size={13} /> },
    { key: 'js', label: '自定义 JS', icon: <SquareTerminal size={13} /> },
    { key: 'docs', label: '接口文档', icon: <BookOpen size={13} /> }
  ]

  const codeArea =
    'w-full rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-3 font-mono text-[12px] leading-relaxed text-[var(--text)] focus:border-violet-500/60 focus:outline-none'

  return (
    <Modal
      open
      onClose={close}
      width={760}
      title={
        <span className="flex items-center gap-2">
          <Braces size={15} className="text-violet-400" />
          自定义接口
        </span>
      }
    >
      <div className="flex min-h-[460px] flex-col">
        <div className="flex flex-none gap-1 border-b border-[var(--border)] px-4 pt-3">
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={
                'flex items-center gap-1.5 rounded-t-lg px-3 py-2 text-[12px] font-medium transition-colors ' +
                (tab === t.key
                  ? 'border-x border-t border-[var(--border)] bg-[var(--surface-2)] text-[var(--text)]'
                  : 'text-[var(--text-dim)] hover:text-[var(--text)]')
              }
            >
              {t.icon}
              {t.label}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-auto p-4">
          {tab === 'css' && (
            <div className="flex flex-col gap-2">
              <p className="text-[12px] leading-relaxed text-[var(--text-dim)]">
                注入试玩与导出的可玩 HTML。运行时元素使用 <code className="text-violet-400">.tgr-</code> 前缀类名，
                例如 <code className="text-violet-400">.tgr-card</code>（对白卡片）、
                <code className="text-violet-400">.tgr-speaker</code>（说话人）、
                <code className="text-violet-400">.tgr-text</code>（正文）、
                <code className="text-violet-400">.tgr-stage</code>（舞台）。
              </p>
              <textarea
                value={customCss}
                spellCheck={false}
                rows={14}
                placeholder={`.tgr-vn .tgr-card {\n  background: rgba(12, 10, 24, 0.88);\n  border-radius: 18px;\n}\n.tgr-speaker { color: #ffb3c8; }`}
                onChange={(e) => setCustomCode({ customCss: e.target.value })}
                className={codeArea}
              />
            </div>
          )}

          {tab === 'js' && (
            <div className="flex flex-col gap-2">
              <p className="text-[12px] leading-relaxed text-[var(--text-dim)]">
                游戏开始时执行一次（可 await）。与演出脚本节点使用相同的
                <code className="text-violet-400"> api / vars / story</code> 入参——适合注册全局样式、开场演出等。
                完整接口见「接口文档」页。
              </p>
              <textarea
                value={customJs}
                spellCheck={false}
                rows={14}
                placeholder={`// 例：进入游戏先淡入，再播放标题音乐\nawait api.fadeIn(900)\napi.bgm('晚安小调.wav', { volume: 40 })`}
                onChange={(e) => setCustomCode({ customJs: e.target.value })}
                className={codeArea}
              />
            </div>
          )}

          {tab === 'docs' && (
            <div className="flex flex-col gap-5 text-[12px] leading-relaxed">
              <section>
                <h3 className="mb-2 text-[12px] font-bold tracking-wide text-[var(--text-dim)] uppercase">
                  演出脚本 / 自定义 JS 可用接口
                </h3>
                <div className="overflow-hidden rounded-lg border border-[var(--border)]">
                  {API_DOCS.map((d, i) => (
                    <div
                      key={d.sig}
                      className={
                        'flex flex-col gap-0.5 px-3 py-2 sm:flex-row sm:items-baseline sm:gap-3 ' +
                        (i % 2 ? 'bg-[var(--surface-2)]' : '')
                      }
                    >
                      <code className="w-56 flex-none font-mono text-[11px] font-bold text-violet-500 dark:text-violet-300">
                        {d.sig}
                      </code>
                      <span className="text-[var(--text-dim)]">{d.desc}</span>
                    </div>
                  ))}
                </div>
              </section>

              <section>
                <h3 className="mb-2 text-[12px] font-bold tracking-wide text-[var(--text-dim)] uppercase">
                  对白内联文本标记
                </h3>
                <div className="overflow-hidden rounded-lg border border-[var(--border)]">
                  {MARKUP_DOCS.map(([sig, desc], i) => (
                    <div
                      key={sig}
                      className={'flex flex-col gap-0.5 px-3 py-2 sm:flex-row sm:gap-3 ' + (i % 2 ? 'bg-[var(--surface-2)]' : '')}
                    >
                      <code className="w-56 flex-none font-mono text-[11px] font-bold text-amber-500 dark:text-amber-300">
                        {sig}
                      </code>
                      <span className="text-[var(--text-dim)]">{desc}</span>
                    </div>
                  ))}
                </div>
              </section>

              <section>
                <h3 className="mb-2 text-[12px] font-bold tracking-wide text-[var(--text-dim)] uppercase">
                  Yarn 导入导出的效果命令
                </h3>
                <div className="flex flex-wrap gap-1.5">
                  {YARN_DOCS.map((c) => (
                    <code
                      key={c}
                      className="rounded bg-[var(--surface-2)] px-2 py-1 font-mono text-[11px] text-teal-500 dark:text-teal-300"
                    >
                      {c}
                    </code>
                  ))}
                </div>
                <p className="mt-2 text-[11px] text-[var(--text-dim)]">
                  导出时演出脚本自动转为这些命令；导入时它们（以及其他未知命令）恢复为演出脚本节点。
                </p>
              </section>

              <section className="flex flex-wrap items-center gap-2">
                <Badge tone="purple">提示</Badge>
                <span className="text-[11px] text-[var(--text-dim)]">
                  演出脚本节点在画布左侧「添加节点」面板；素材按名称引用（如 <code>api.bg('雪夜车站.svg')</code>）。
                </span>
              </section>
            </div>
          )}
        </div>
      </div>
    </Modal>
  )
}
