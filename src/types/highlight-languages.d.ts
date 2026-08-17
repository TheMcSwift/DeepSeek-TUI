/**
 * highlight.js 只为 core 入口提供 d.ts；语言模块（lib/languages/*）没有独立
 * 声明文件。此环境声明把它们统一收敛为 LanguageFn，配合
 * src/app/pi/highlight-languages.ts 的按需注册（全量包 190+ 语法换成常用
 * 子集，降低安装体积与每块代码的 auto 探测耗时）。
 * @module dsh-tui-app/types/highlight-languages
 */
declare module 'highlight.js/lib/languages/*' {
  import type { LanguageFn } from 'highlight.js'
  const language: LanguageFn
  export default language
}
