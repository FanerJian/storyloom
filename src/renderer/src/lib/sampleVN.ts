import { uid, type StoryProject } from '@shared/schema'

/**
 * 内置视觉小说示例：「雪落车站」
 * 演示背景 / 立绘 / BGM / 音效节点与演出脚本节点（雷声：闪光+震屏）。
 * 素材为程序化生成的 SVG（背景、立绘）与 WAV（音乐、音效）data URL，无外部文件。
 */

/** 生成一段 WAV data URL（16bit 单声道） */
function makeWav(samples: Float32Array, sampleRate = 22050): string {
  const buf = new ArrayBuffer(44 + samples.length * 2)
  const view = new DataView(buf)
  const wstr = (off: number, s: string): void => {
    for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i))
  }
  wstr(0, 'RIFF')
  view.setUint32(4, 36 + samples.length * 2, true)
  wstr(8, 'WAVE')
  wstr(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  wstr(36, 'data')
  view.setUint32(40, samples.length * 2, true)
  let off = 44
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]))
    view.setInt16(off, s * 0x7fff, true)
    off += 2
  }
  let bin = ''
  const bytes = new Uint8Array(buf)
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  return `data:audio/wav;base64,${btoa(bin)}`
}

/** 柔和双音 BGM（约 3.2 秒，可循环） */
function makeBgm(): string {
  const rate = 22050
  const dur = 3.2
  const n = Math.floor(rate * dur)
  const data = new Float32Array(n)
  // A3 + E4 + C#5 泛音，缓慢起伏
  for (let i = 0; i < n; i++) {
    const t = i / rate
    const env = 0.5 + 0.5 * Math.sin((t / dur) * Math.PI * 2 - Math.PI / 2)
    const fade = Math.min(1, t / 0.3) * Math.min(1, (dur - t) / 0.3)
    data[i] =
      (0.16 * Math.sin(2 * Math.PI * 220 * t) +
        0.1 * Math.sin(2 * Math.PI * 330 * t + 0.5) +
        0.07 * Math.sin(2 * Math.PI * 554 * t + 1.2)) *
      env *
      fade
  }
  return makeWav(data, rate)
}

/** 短促风铃音效（约 0.5 秒） */
function makeSfx(): string {
  const rate = 22050
  const dur = 0.5
  const n = Math.floor(rate * dur)
  const data = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const t = i / rate
    const fade = Math.exp(-t * 6)
    data[i] = (0.2 * Math.sin(2 * Math.PI * 1320 * t) + 0.12 * Math.sin(2 * Math.PI * 1980 * t)) * fade
  }
  return makeWav(data, rate)
}

function svgUrl(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}

/** 车站夜景背景 */
function makeBgSvg(): string {
  return svgUrl(`<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720">
  <defs>
    <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#101a33"/>
      <stop offset="0.55" stop-color="#1c2a4d"/>
      <stop offset="1" stop-color="#3a4a72"/>
    </linearGradient>
    <radialGradient id="lamp" cx="0.5" cy="0.35" r="0.6">
      <stop offset="0" stop-color="#ffd9a0" stop-opacity="0.9"/>
      <stop offset="1" stop-color="#ffd9a0" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="1280" height="720" fill="url(#sky)"/>
  ${Array.from({ length: 60 }, (_, i) => {
    const x = (i * 197) % 1280
    const y = (i * 83) % 340
    const r = 0.6 + (i % 4) * 0.5
    return `<circle cx="${x}" cy="${y}" r="${r}" fill="#dfe6ff" opacity="0.7"/>`
  }).join('')}
  <ellipse cx="1040" cy="120" rx="90" ry="60" fill="#e8eeff" opacity="0.12"/>
  <!-- 远处车灯 -->
  <rect x="0" y="470" width="1280" height="10" fill="#243155"/>
  <rect x="0" y="480" width="1280" height="240" fill="#151d36"/>
  <!-- 月台 -->
  <rect x="0" y="560" width="1280" height="30" fill="#2c3757"/>
  <rect x="0" y="590" width="1280" height="130" fill="#1a2340"/>
  <!-- 站牌 -->
  <rect x="170" y="380" width="14" height="180" fill="#3b4667"/>
  <rect x="120" y="330" width="220" height="70" rx="10" fill="#41508a"/>
  <rect x="120" y="330" width="220" height="70" rx="10" fill="none" stroke="#8fa3e8" stroke-width="3" opacity="0.7"/>
  <!-- 灯柱与光晕 -->
  <rect x="920" y="300" width="10" height="260" fill="#3b4667"/>
  <circle cx="925" cy="290" r="14" fill="#ffe9c4"/>
  <ellipse cx="925" cy="300" rx="150" ry="110" fill="url(#lamp)"/>
  <!-- 雪 -->
  ${Array.from({ length: 46 }, (_, i) => {
    const x = (i * 331) % 1280
    const y = (i * 151) % 700
    const r = 1.2 + (i % 5) * 0.7
    return `<circle cx="${x}" cy="${y}" r="${r}" fill="#ffffff" opacity="${0.25 + (i % 4) * 0.15}"/>`
  }).join('')}
</svg>`)
}

/** 小雪立绘（围巾少女剪影） */
function makeSpriteSvg(coat: string, scarf: string, hair: string): string {
  return svgUrl(`<svg xmlns="http://www.w3.org/2000/svg" width="420" height="720" viewBox="0 0 420 720">
  <ellipse cx="210" cy="700" rx="130" ry="18" fill="#000" opacity="0.28"/>
  <!-- 腿 -->
  <rect x="168" y="500" width="30" height="190" rx="14" fill="#2e3450"/>
  <rect x="222" y="500" width="30" height="190" rx="14" fill="#2e3450"/>
  <!-- 大衣 -->
  <path d="M150 300 Q210 268 270 300 L288 540 Q210 566 132 540 Z" fill="${coat}"/>
  <path d="M150 300 Q210 268 270 300 L276 380 Q210 404 144 380 Z" fill="#000" opacity="0.08"/>
  <!-- 围巾 -->
  <path d="M162 296 Q210 330 258 296 L262 336 Q210 366 158 336 Z" fill="${scarf}"/>
  <path d="M246 330 Q262 380 250 430 L226 424 Q238 378 230 344 Z" fill="${scarf}"/>
  <!-- 头 -->
  <circle cx="210" cy="212" r="74" fill="#f3d9c4"/>
  <!-- 头发 -->
  <path d="M132 220 Q128 108 210 104 Q292 108 288 220 Q282 156 210 152 Q138 156 132 220 Z" fill="${hair}"/>
  <path d="M130 210 Q118 320 140 380 L162 372 Q146 300 152 220 Z" fill="${hair}"/>
  <path d="M290 210 Q302 320 280 380 L258 372 Q274 300 268 220 Z" fill="${hair}"/>
  <!-- 眼睛（闭眼微笑） -->
  <path d="M176 214 Q186 224 196 214" stroke="#3a3f5c" stroke-width="5" fill="none" stroke-linecap="round"/>
  <path d="M224 214 Q234 224 244 214" stroke="#3a3f5c" stroke-width="5" fill="none" stroke-linecap="round"/>
  <path d="M202 246 Q210 252 218 246" stroke="#d98f8f" stroke-width="4" fill="none" stroke-linecap="round"/>
  <!-- 手 -->
  <circle cx="146" cy="470" r="16" fill="#f3d9c4"/>
  <circle cx="274" cy="470" r="16" fill="#f3d9c4"/>
</svg>`)
}

export function vnSampleProject(): StoryProject {
  const bg = 'a_bg_station'
  const spriteXue = 'a_sp_xue'
  const spriteLin = 'a_sp_lin'
  const musicA = 'a_bgm'
  const dingA = 'a_sfx'

  const nStart = 'n_start'
  const nBg = 'n_bg'
  const nBgm = 'n_bgm'
  const nSpXue = 'n_sp_xue'
  const d1 = 'n_d1'
  const d2 = 'n_d2'
  const thunder = 'n_thunder'
  const c1 = 'n_c1'
  const oAsk = 'o_ask'
  const oQuiet = 'o_quiet'
  const dAsk = 'n_d_ask'
  const sfx = 'n_sfx'
  const spLin = 'n_sp_lin'
  const dLin = 'n_d_lin'
  const eTrain = 'n_end_train'
  const spHide = 'n_sp_hide'
  const dQuiet = 'n_d_quiet'
  const eSnow = 'n_end_snow'

  return {
    version: 3,
    meta: {
      title: '雪落车站',
      author: 'StoryLoom',
      description:
        '视觉小说示例：末班车站台上的相遇与选择。演示背景 / 立绘 / BGM / 音效节点与演出脚本节点（自定义效果 API）。'
    },
    assets: {
      [bg]: { name: '雪夜车站.svg', type: 'image', dataUrl: makeBgSvg() },
      [spriteXue]: {
        name: '小雪（蓝围巾）.svg',
        type: 'image',
        dataUrl: makeSpriteSvg('#43518c', '#7fb3e8', '#3c4668')
      },
      [spriteLin]: {
        name: '临（红围巾）.svg',
        type: 'image',
        dataUrl: makeSpriteSvg('#5c4a6e', '#e88b9d', '#2e3448')
      },
      [musicA]: { name: '晚安小调.wav', type: 'audio', dataUrl: makeBgm() },
      [dingA]: { name: '风铃.wav', type: 'audio', dataUrl: makeSfx() }
    },
    customCss: `.tgr-speaker { letter-spacing: 0.12em; }`,
    customJs: '',
    variables: [],
    nodes: [
      { id: nStart, type: 'start', position: { x: -80, y: 260 }, data: {} },
      { id: nBg, type: 'bg', position: { x: 120, y: 260 }, data: { asset: bg } },
      {
        id: nBgm,
        type: 'audio',
        position: { x: 320, y: 260 },
        data: { asset: musicA, audioKind: 'bgm', audioAction: 'play', loop: true, volume: 45 }
      },
      {
        id: nSpXue,
        type: 'sprite',
        position: { x: 520, y: 260 },
        data: { asset: spriteXue, character: '小雪', spritePos: 'center', spriteAction: 'show' }
      },
      {
        id: d1,
        type: 'dialogue',
        position: { x: 740, y: 250 },
        data: { speaker: '小雪', text: '……你也在等末班车吗？\n这一班，听说大雪天经常会晚点很久。' }
      },
      {
        id: d2,
        type: 'dialogue',
        position: { x: 960, y: 250 },
        data: {
          speaker: '',
          text: '她的围巾上落了薄薄一层雪，说话时呵出白色的气。\n站台的灯把两个人的影子拉得很长。'
        }
      },
      {
        id: thunder,
        type: 'script',
        position: { x: 1070, y: 430 },
        data: {
          code: `// 远处传来闷雷：闪光 + 震屏（演出脚本演示）\nawait api.flash('#dfe8ff', 260)\nawait api.shake(7, 500)\nawait api.wait(200)\nawait api.say('旁白', '远处传来一声闷雷，铁轨轻轻震了震。')`
        }
      },
      {
        id: c1,
        type: 'choice',
        position: { x: 1180, y: 260 },
        data: {
          options: [
            { id: oAsk, text: '「要一起等吗？总比一个人站着好。」', condition: null },
            { id: oQuiet, text: '什么都不说，只是把伞往她那边偏了偏', condition: null }
          ]
        }
      },
      {
        id: dAsk,
        type: 'dialogue',
        position: { x: 1460, y: 140 },
        data: {
          speaker: '小雪',
          text: '「好呀。」她笑了，眼睛弯成月牙，「其实……我等的人，刚刚坐上一班开走的车。」'
        }
      },
      {
        id: sfx,
        type: 'audio',
        position: { x: 1700, y: 140 },
        data: { asset: dingA, audioKind: 'sfx', audioAction: 'play', loop: false, volume: 60 }
      },
      {
        id: spLin,
        type: 'sprite',
        position: { x: 1900, y: 140 },
        data: { asset: spriteLin, character: '临', spritePos: 'right', spriteAction: 'show' }
      },
      {
        id: dLin,
        type: 'dialogue',
        position: { x: 2120, y: 140 },
        data: {
          speaker: '临',
          text: '「让你久等了。」从检票口跑来的人停下脚步，看了看你们两个，「这位是……？」'
        }
      },
      { id: eTrain, type: 'end', position: { x: 2360, y: 140 }, data: { label: '末班车与第三个人' } },
      {
        id: spHide,
        type: 'sprite',
        position: { x: 1460, y: 420 },
        data: { character: '', spritePos: 'center', spriteAction: 'hide' }
      },
      {
        id: dQuiet,
        type: 'dialogue',
        position: { x: 1680, y: 420 },
        data: {
          speaker: '',
          text: '你没有说话。雪落在伞面上，沙沙地响。\n过了很久，她轻轻靠了过来半步，像是终于放下了什么。'
        }
      },
      { id: eSnow, type: 'end', position: { x: 1920, y: 420 }, data: { label: '共伞的沉默' } }
    ],
    edges: [
      { id: uid('e_'), source: nStart, sourceHandle: null, target: nBg },
      { id: uid('e_'), source: nBg, sourceHandle: null, target: nBgm },
      { id: uid('e_'), source: nBgm, sourceHandle: null, target: nSpXue },
      { id: uid('e_'), source: nSpXue, sourceHandle: null, target: d1 },
      { id: uid('e_'), source: d1, sourceHandle: null, target: d2 },
      { id: uid('e_'), source: d2, sourceHandle: null, target: thunder },
      { id: uid('e_'), source: thunder, sourceHandle: null, target: c1 },
      { id: uid('e_'), source: c1, sourceHandle: oAsk, target: dAsk },
      { id: uid('e_'), source: c1, sourceHandle: oQuiet, target: spHide },
      { id: uid('e_'), source: dAsk, sourceHandle: null, target: sfx },
      { id: uid('e_'), source: sfx, sourceHandle: null, target: spLin },
      { id: uid('e_'), source: spLin, sourceHandle: null, target: dLin },
      { id: uid('e_'), source: dLin, sourceHandle: null, target: eTrain },
      { id: uid('e_'), source: spHide, sourceHandle: null, target: dQuiet },
      { id: uid('e_'), source: dQuiet, sourceHandle: null, target: eSnow }
    ]
  }
}
