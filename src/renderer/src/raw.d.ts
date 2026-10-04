/**
 * Vite ?raw 导入声明（runtime.js / runtime.css 以字符串内联进渲染层包，
 * 供「导出可玩 HTML」三端一致合成，见 lib/exportHtml.ts）。
 * 必须放在无 import/export 的全局脚本 d.ts 中才能生效。
 */

declare module '@rtdist/runtime.js?raw' {
  const content: string
  export default content
}

declare module '@rtdist/runtime.css?raw' {
  const content: string
  export default content
}

declare module '*?raw' {
  const content: string
  export default content
}
