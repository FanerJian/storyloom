/**
 * 对白内联文本标记与打字机渲染。
 * parseMarkup 是纯函数（编辑器预览与运行时共用语义）；
 * createTypewriter 把「全局速度 / 快进 / 销毁」等宿主状态通过注入读取，
 * 使打字逻辑可以独立于 player 闭包测试与复用。
 */

export interface MarkupSeg {
  text: string
  color?: string
  size?: string
  bold?: boolean
  italic?: boolean
}

export interface MarkupResult {
  segs: MarkupSeg[]
  /** {speed:ms} 在第 at 个字符处生效 */
  speedEvents: { at: number; ms: number }[]
  /** {pause:ms} 在第 at 个字符后停顿 */
  pauses: { at: number; ms: number }[]
}

/**
 * 解析对白文本的内联标记：
 * `{color:#f00}…{/color}`、`{size:120%}…{/size}`、`{b}` `{i}`（`{/}` 统一闭合），
 * `{speed:24}` 从此处起打字速度（ms/字，0 立即显示），`{pause:500}` 此处停顿。
 * `{{` 输出字面 `{`；未知标签原样保留。标记不影响导出（文本原样进出 Ink/Yarn）。
 */
export function parseMarkup(src: string): MarkupResult {
  const segs: MarkupSeg[] = []
  const speedEvents: { at: number; ms: number }[] = []
  const pauses: { at: number; ms: number }[] = []
  const stack: { tag: string; color?: string; size?: string; bold?: boolean; italic?: boolean }[] = []
  let cur: MarkupSeg | null = null
  let charCount = 0

  const topStyle = (): Partial<MarkupSeg> => {
    const s = stack[stack.length - 1]
    return s ? { color: s.color, size: s.size, bold: s.bold, italic: s.italic } : {}
  }
  const breakSeg = (): void => {
    cur = null
  }
  const pushChar = (ch: string): void => {
    if (!cur) {
      cur = { text: '', ...topStyle() }
      segs.push(cur)
    }
    cur.text += ch
    charCount++
  }

  let i = 0
  while (i < src.length) {
    const ch = src[i]
    if (ch === '{') {
      if (src[i + 1] === '{') {
        pushChar('{')
        i += 2
        continue
      }
      const close = src.indexOf('}', i + 1)
      if (close > i) {
        const tokenStart = i
        const tag = src.slice(i + 1, close).trim()
        i = close + 1
        if (/^\/(color|size|b|i)?$/.test(tag)) {
          if (tag === '/') stack.pop()
          else {
            const name = tag.slice(1)
            const idx = stack.map((s) => s.tag).lastIndexOf(name)
            if (idx >= 0) stack.length = idx
          }
          breakSeg()
          continue
        }
        let m = tag.match(/^color\s*:\s*(.+)$/)
        if (m) {
          stack.push({ tag: 'color', color: m[1].trim() })
          breakSeg()
          continue
        }
        m = tag.match(/^size\s*:\s*(.+)$/)
        if (m) {
          stack.push({ tag: 'size', size: m[1].trim() })
          breakSeg()
          continue
        }
        if (tag === 'b') {
          stack.push({ tag: 'b', bold: true })
          breakSeg()
          continue
        }
        if (tag === 'i') {
          stack.push({ tag: 'i', italic: true })
          breakSeg()
          continue
        }
        m = tag.match(/^speed\s*:\s*(\d+)$/)
        if (m) {
          speedEvents.push({ at: charCount, ms: Number(m[1]) })
          continue
        }
        m = tag.match(/^pause\s*:\s*(\d+)$/)
        if (m) {
          pauses.push({ at: charCount, ms: Number(m[1]) })
          continue
        }
        // 未知标签：按字面文本输出
        for (const c of src.slice(tokenStart, i)) pushChar(c)
        continue
      }
    }
    pushChar(ch)
    i++
  }
  return { segs: segs.filter((s) => s.text.length > 0), speedEvents, pauses }
}

/** 一次打字会话的状态；player 通过 complete()（跳到结尾）与 cancelled（丢弃）控制 */
export interface TypingState {
  cancelled: boolean
  complete: () => void
  wake: (() => void) | null
}

export interface TypewriterHost {
  /** 全局每字间隔（ms）；快进时宿主应返回 0 */
  getSpeed(): number
  /** 快进中：{pause} 停顿与内联 {speed} 全部跳过，文本立即完整渲染 */
  isSkipping(): boolean
  isDestroyed(): boolean
}

export interface Typewriter {
  /** 往元素里渲染一段标记文本；解析完成（或被跳过/取消）后 resolve */
  renderMarkup(el: HTMLElement, mk: MarkupResult): Promise<void>
  /** 立即完成当前打字（渲染全部剩余文本） */
  finishTyping(): void
  /** 不渲染剩余文本直接停止（切卡/重置时使用） */
  cancelTyping(): void
  /** 当前是否还有未完成的打字会话 */
  readonly active: TypingState | null
}

export function createTypewriter(host: TypewriterHost): Typewriter {
  let typingState: TypingState | null = null

  function finishTyping(): void {
    typingState?.complete()
  }

  function cancelTyping(): void {
    if (typingState) {
      typingState.cancelled = true
      typingState.wake?.()
      typingState = null
    }
  }

  function renderMarkup(el: HTMLElement, mk: MarkupResult): Promise<void> {
    const spanFor = (seg: MarkupSeg): HTMLElement => {
      const s = document.createElement('span')
      if (seg.color) s.style.color = seg.color
      if (seg.size) s.style.fontSize = seg.size
      if (seg.bold) s.style.fontWeight = '700'
      if (seg.italic) s.style.fontStyle = 'italic'
      el.appendChild(s)
      return s
    }
    const skipping = host.isSkipping()
    // 无速度/停顿设置（或快进中）：立即完整渲染
    if (skipping || (host.getSpeed() === 0 && mk.speedEvents.length === 0 && mk.pauses.length === 0)) {
      for (const seg of mk.segs) spanFor(seg).textContent = seg.text
      return Promise.resolve()
    }
    const renderAll = (): void => {
      el.textContent = ''
      for (const seg of mk.segs) spanFor(seg).textContent = seg.text
    }
    const state = {
      cancelled: false,
      wake: null as (() => void) | null,
      complete: (): void => {
        if (state.cancelled) return
        state.cancelled = true
        state.wake?.()
        renderAll()
        if (typingState === state) typingState = null
      }
    }
    typingState = state
    const delay = (ms: number): Promise<void> => new Promise((resolve) => {
      const timer = setTimeout(done, Math.min(ms, 60_000))
      function done(): void { clearTimeout(timer); state.wake = null; resolve() }
      state.wake = done
    })
    return (async () => {
      const speedAt = (ci: number): number => {
        let ms = host.getSpeed()
        for (const e of mk.speedEvents) if (e.at <= ci) ms = e.ms
        return ms
      }
      let ci = 0
      let pauseIdx = 0
      outer: for (const seg of mk.segs) {
        if (state.cancelled || host.isDestroyed()) break
        const span = spanFor(seg)
        for (const ch of seg.text) {
          if (!skipping) {
            while (mk.pauses[pauseIdx] && mk.pauses[pauseIdx].at <= ci) {
              if (state.cancelled) {
                break outer
              }
              await delay(mk.pauses[pauseIdx].ms)
              pauseIdx++
            }
          }
          if (state.cancelled) {
            break outer
          }
          span.textContent += ch
          ci++
          const ms = skipping ? 0 : speedAt(ci)
          if (ms > 0) {
            await delay(ms)
            if (state.cancelled) {
              break outer
            }
          }
        }
      }
      if (typingState === state) typingState = null
    })()
  }

  return {
    renderMarkup,
    finishTyping,
    cancelTyping,
    get active(): TypingState | null {
      return typingState
    }
  }
}
