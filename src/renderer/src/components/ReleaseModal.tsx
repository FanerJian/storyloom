import { useMemo, type ReactNode } from 'react'
import { Clapperboard, MonitorPlay } from 'lucide-react'
import { useProjectStore } from '../stores/project'
import { useUiStore } from '../stores/ui'
import { assetUrl } from '@shared/authoring'
import { defaultRelease, type ReleaseConfig, type StoryAsset, type StoryMeta } from '@shared/schema'
import { Field, Input, Modal, Select, Textarea } from './ui'

/** 「发布设置」弹窗：编辑 story.release，右侧实时预览标题画面（所见即所得，随工程保存）。 */

const DEFAULT_LABELS = { start: '开始游戏', continue: '继续游戏', load: '读取存档', settings: '设置', credits: '关于' } as const

type Patch = Parameters<ReturnType<typeof useProjectStore.getState>['updateRelease']>[0]

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <div className="text-[11px] font-semibold tracking-wide text-[var(--text-dim)] uppercase">{title}</div>
      {children}
    </section>
  )
}

function ToggleRow({ label, hint, checked, onChange }: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-3 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 transition-colors hover:border-indigo-500/40">
      <span className="min-w-0">
        <span className="block text-[12px] font-medium text-[var(--text)]">{label}</span>
        {hint && <span className="block text-[11px] leading-snug text-[var(--text-dim)]">{hint}</span>}
      </span>
      <input type="checkbox" className="h-4 w-4 flex-none accent-indigo-500" checked={checked} onChange={(e) => onChange(e.target.checked)} />
    </label>
  )
}

function SliderRow({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (v: number) => void }) {
  return (
    <label className="block rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2">
      <span className="mb-1 flex items-center justify-between text-[12px]">
        <span className="font-medium text-[var(--text)]">{label}（出厂默认）</span>
        <span className="text-[var(--text-dim)]">{value}</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={1}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-indigo-500"
        aria-label={label}
      />
    </label>
  )
}

/** 标题画面 mini 预览：loom-release-preview 前缀，避免与运行时 tgr- 类名冲突。 */
function TitlePreview({ config, meta, assets }: { config: ReleaseConfig; meta: StoryMeta; assets: Record<string, StoryAsset> }) {
  const t = config.titleScreen
  const bgAsset = t.backgroundAsset ? assets[t.backgroundAsset] : undefined
  const bgUrl = bgAsset?.type === 'image' ? assetUrl(bgAsset) : ''
  const menuItems: string[] = [
    t.labels.start || DEFAULT_LABELS.start,
    t.labels.continue || DEFAULT_LABELS.continue,
    t.labels.load || DEFAULT_LABELS.load,
    t.labels.settings || DEFAULT_LABELS.settings
  ]
  if (config.credits.trim()) menuItems.push(t.labels.credits || DEFAULT_LABELS.credits)
  return (
    <div className="loom-release-preview relative aspect-video w-full max-w-[360px] overflow-hidden rounded-xl border border-[var(--border)] bg-[#0b0d12] shadow-lg">
      {bgUrl ? (
        <img src={bgUrl} alt="标题画面背景预览" className="absolute inset-0 h-full w-full object-cover" draggable={false} />
      ) : (
        <div
          className="absolute inset-0"
          style={{
            background:
              'radial-gradient(420px 200px at 18% -10%, rgba(139,147,255,0.16), transparent 60%), radial-gradient(360px 180px at 88% 112%, rgba(192,132,252,0.14), transparent 55%), linear-gradient(160deg, #10131f 0%, #0b0d12 55%, #14102a 100%)'
          }}
        />
      )}
      <div
        className="absolute inset-0"
        style={{ background: 'linear-gradient(to bottom, rgba(5,7,14,0.55) 0%, rgba(5,7,14,0.14) 32%, rgba(5,7,14,0.22) 58%, rgba(5,7,14,0.88) 100%)' }}
      />
      <div className="relative flex h-full flex-col items-center justify-center gap-3.5 p-5">
        {t.showMeta && (
          <div className="text-center">
            <div
              className="max-w-[280px] font-serif text-[19px] leading-snug font-bold tracking-[0.18em] text-[#f2f4ff]"
              style={{ textShadow: '0 4px 26px rgba(0,0,0,0.65), 0 0 46px rgba(139,147,255,0.32)' }}
            >
              {meta.title || '未命名故事'}
            </div>
            {meta.author && (
              <div className="mt-1.5 text-[10px] tracking-[0.32em] text-white/70" style={{ textShadow: '0 2px 12px rgba(0,0,0,0.6)' }}>
                {meta.author}
              </div>
            )}
          </div>
        )}
        {t.showVersion && config.version && (
          <div className="text-[10px] tracking-[0.24em] text-white/50" style={{ textShadow: '0 2px 8px rgba(0,0,0,0.6)' }}>
            v {config.version}
          </div>
        )}
        <div className="flex w-[150px] flex-col gap-1.5">
          {menuItems.map((text) => (
            <span
              key={text}
              className="rounded-lg border border-white/20 bg-[#0a0d18]/55 px-3 py-1 text-center text-[10.5px] tracking-[0.3em] text-white/90 backdrop-blur"
            >
              {text}
            </span>
          ))}
        </div>
      </div>
      {!t.enabled && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/55">
          <span className="rounded-lg border border-white/20 bg-black/60 px-3 py-1.5 text-[11px] text-white/85">
            标题画面已停用，试玩与导出将直接进入剧情
          </span>
        </div>
      )}
    </div>
  )
}

export function ReleaseModal() {
  const open = useUiStore((s) => s.releaseModal)
  const close = useUiStore((s) => s.closeRelease)
  const meta = useProjectStore((s) => s.meta)
  const assets = useProjectStore((s) => s.assets)
  const release = useProjectStore((s) => s.release)
  const updateRelease = useProjectStore((s) => s.updateRelease)
  const config = release ?? defaultRelease()

  const imageAssets = useMemo(
    () =>
      Object.entries(assets)
        .filter(([, a]) => a.type === 'image')
        .sort((x, y) => x[1].name.localeCompare(y[1].name, 'zh')),
    [assets]
  )

  const patch = (p: Patch): void => updateRelease(p)
  const patchTyping = (p: Patch): void => updateRelease(p, { typing: true })

  const t = config.titleScreen
  const bg = t.backgroundAsset
  const bgMissing = !!bg && !imageAssets.some(([id]) => id === bg)

  return (
    <Modal
      open={open}
      onClose={close}
      width={940}
      title={
        <span className="flex items-center gap-2">
          <Clapperboard size={15} className="text-indigo-400" />
          发布设置
        </span>
      }
    >
      <div className="flex flex-col gap-6 p-5 lg:flex-row">
        <div className="flex w-full min-w-0 flex-col gap-5 lg:w-[460px] lg:flex-none">
          <Section title="标题画面">
            <ToggleRow
              label="启用标题画面"
              hint="启动时先展示标题与菜单，再进入剧情"
              checked={t.enabled}
              onChange={(v) => patch({ titleScreen: { enabled: v } })}
            />
            <Field label="背景素材" hint="清空 = 默认深色底">
              <Select
                aria-label="标题画面背景素材"
                value={bg}
                onChange={(e) => patch({ titleScreen: { backgroundAsset: e.target.value } })}
              >
                <option value="">默认深色底</option>
                {bgMissing && <option value={bg}>{assets[bg]?.name ?? '素材缺失'}</option>}
                {imageAssets.map(([id, a]) => (
                  <option key={id} value={id}>
                    {a.name}
                  </option>
                ))}
              </Select>
            </Field>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <ToggleRow label="显示标题与作者" checked={t.showMeta} onChange={(v) => patch({ titleScreen: { showMeta: v } })} />
              <ToggleRow label="显示版本号" checked={t.showVersion} onChange={(v) => patch({ titleScreen: { showVersion: v } })} />
            </div>
            <div className="grid grid-cols-2 gap-2">
              {(['start', 'continue', 'load', 'settings', 'credits'] as const).map((key) => (
                <Input
                  key={key}
                  aria-label={`菜单文案 ${DEFAULT_LABELS[key]}`}
                  placeholder={DEFAULT_LABELS[key]}
                  value={t.labels[key]}
                  className={key === 'credits' ? 'col-span-2' : ''}
                  onChange={(e) => patchTyping({ titleScreen: { labels: { [key]: e.target.value } } })}
                />
              ))}
            </div>
            <p className="text-[11px] text-[var(--text-dim)]">菜单文案留空时使用默认文案。「关于」入口仅在该文案填写且下方「关于/制作名单」非空时显示。</p>
          </Section>

          <Section title="快捷菜单">
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <ToggleRow label="存读档" checked={config.quickMenu.saves} onChange={(v) => patch({ quickMenu: { saves: v } })} />
              <ToggleRow label="回看" checked={config.quickMenu.backlog} onChange={(v) => patch({ quickMenu: { backlog: v } })} />
              <ToggleRow label="自动播放" checked={config.quickMenu.auto} onChange={(v) => patch({ quickMenu: { auto: v } })} />
              <ToggleRow label="快进" checked={config.quickMenu.skip} onChange={(v) => patch({ quickMenu: { skip: v } })} />
              <ToggleRow label="设置" checked={config.quickMenu.settings} onChange={(v) => patch({ quickMenu: { settings: v } })} />
              <ToggleRow label="回标题" checked={config.quickMenu.title} onChange={(v) => patch({ quickMenu: { title: v } })} />
              <ToggleRow label="全屏" checked={config.quickMenu.fullscreen} onChange={(v) => patch({ quickMenu: { fullscreen: v } })} />
            </div>
          </Section>

          <Section title="玩家设置">
            <div className="flex flex-col gap-2">
              <ToggleRow
                label="允许玩家调整文字速度"
                checked={config.settings.textSpeed}
                onChange={(v) => patch({ settings: { textSpeed: v } })}
              />
              <SliderRow
                label="文字速度"
                min={0}
                max={100}
                value={config.settings.defaults.textSpeed}
                onChange={(v) => patchTyping({ settings: { defaults: { textSpeed: v } } })}
              />
              <ToggleRow
                label="允许玩家调整自动播放速度"
                checked={config.settings.autoSpeed}
                onChange={(v) => patch({ settings: { autoSpeed: v } })}
              />
              <SliderRow
                label="自动播放速度"
                min={1}
                max={10}
                value={config.settings.defaults.autoLevel}
                onChange={(v) => patchTyping({ settings: { defaults: { autoLevel: v } } })}
              />
              <ToggleRow
                label="允许玩家调整 BGM 音量"
                checked={config.settings.bgmVolume}
                onChange={(v) => patch({ settings: { bgmVolume: v } })}
              />
              <SliderRow
                label="BGM 音量"
                min={0}
                max={100}
                value={config.settings.defaults.bgmVolume}
                onChange={(v) => patchTyping({ settings: { defaults: { bgmVolume: v } } })}
              />
              <ToggleRow
                label="允许玩家调整音效音量"
                checked={config.settings.sfxVolume}
                onChange={(v) => patch({ settings: { sfxVolume: v } })}
              />
              <SliderRow
                label="音效音量"
                min={0}
                max={100}
                value={config.settings.defaults.sfxVolume}
                onChange={(v) => patchTyping({ settings: { defaults: { sfxVolume: v } } })}
              />
            </div>
          </Section>

          <Section title="作品信息">
            <Field label="版本号" hint="标题画面与关于页展示">
              <Input
                aria-label="作品版本号"
                placeholder="如 1.0.0"
                value={config.version}
                onChange={(e) => patchTyping({ version: e.target.value })}
              />
            </Field>
            <Field label="关于 / 制作名单" hint="支持多行文本；留空 = 隐藏「关于」入口">
              <Textarea
                aria-label="关于与制作名单"
                rows={4}
                placeholder={'出品、脚本、美术、音乐……\n支持多行文本'}
                value={config.credits}
                onChange={(e) => patchTyping({ credits: e.target.value })}
              />
            </Field>
          </Section>
        </div>

        <div className="flex min-w-0 flex-1 flex-col items-center gap-3 lg:items-start">
          <div className="flex w-full items-center gap-2 text-[11px] font-semibold tracking-wide text-[var(--text-dim)] uppercase">
            <MonitorPlay size={13} />
            标题画面预览
          </div>
          <div className="sticky top-0 flex w-full justify-center lg:justify-start">
            <TitlePreview config={config} meta={meta} assets={assets} />
          </div>
          <p className="text-[11px] leading-relaxed text-[var(--text-dim)]">
            发布配置随工程保存，试玩与导出 HTML 共用（所见即所得）。预览为示意布局，实际字号会随窗口缩放；背景素材可在素材库导入后在此选择。
          </p>
        </div>
      </div>
    </Modal>
  )
}
