/**
 * highlight.js core 的按需注册表。全量构建（highlight.js 主入口）注册 193
 * 个语法：安装体积大，且 highlightAuto 对每块无语言标注的代码都要探测全部
 * 语法（长输出时是每帧渲染的固定成本）。这里只注册编码代理会话中真正出现
 * 的常用子集——read 卡的扩展名映射 + 常见代码围栏语言——并补齐 pi/web 习惯
 * 的别名（sh/shell、ts/tsx、py、yml…）。未注册的围栏语言回退 auto 探测，
 * 探测不到则按纯文本着色（不会抛错）。
 * @module dsh-tui-app/app/pi/highlight-languages
 */

import type { HLJSApi, LanguageFn } from 'highlight.js'

import bash from 'highlight.js/lib/languages/bash'
import c from 'highlight.js/lib/languages/c'
import clojure from 'highlight.js/lib/languages/clojure'
import cmake from 'highlight.js/lib/languages/cmake'
import cpp from 'highlight.js/lib/languages/cpp'
import csharp from 'highlight.js/lib/languages/csharp'
import css from 'highlight.js/lib/languages/css'
import dart from 'highlight.js/lib/languages/dart'
import diff from 'highlight.js/lib/languages/diff'
import dockerfile from 'highlight.js/lib/languages/dockerfile'
import elixir from 'highlight.js/lib/languages/elixir'
import erlang from 'highlight.js/lib/languages/erlang'
import go from 'highlight.js/lib/languages/go'
import graphql from 'highlight.js/lib/languages/graphql'
import groovy from 'highlight.js/lib/languages/groovy'
import haskell from 'highlight.js/lib/languages/haskell'
import ini from 'highlight.js/lib/languages/ini'
import java from 'highlight.js/lib/languages/java'
import javascript from 'highlight.js/lib/languages/javascript'
import json from 'highlight.js/lib/languages/json'
import julia from 'highlight.js/lib/languages/julia'
import kotlin from 'highlight.js/lib/languages/kotlin'
import less from 'highlight.js/lib/languages/less'
import lua from 'highlight.js/lib/languages/lua'
import makefile from 'highlight.js/lib/languages/makefile'
import markdown from 'highlight.js/lib/languages/markdown'
import matlab from 'highlight.js/lib/languages/matlab'
import nginx from 'highlight.js/lib/languages/nginx'
import objectivec from 'highlight.js/lib/languages/objectivec'
import perl from 'highlight.js/lib/languages/perl'
import php from 'highlight.js/lib/languages/php'
import plaintext from 'highlight.js/lib/languages/plaintext'
import powershell from 'highlight.js/lib/languages/powershell'
import properties from 'highlight.js/lib/languages/properties'
import protobuf from 'highlight.js/lib/languages/protobuf'
import python from 'highlight.js/lib/languages/python'
import r from 'highlight.js/lib/languages/r'
import ruby from 'highlight.js/lib/languages/ruby'
import rust from 'highlight.js/lib/languages/rust'
import scala from 'highlight.js/lib/languages/scala'
import scss from 'highlight.js/lib/languages/scss'
import sql from 'highlight.js/lib/languages/sql'
import swift from 'highlight.js/lib/languages/swift'
import typescript from 'highlight.js/lib/languages/typescript'
import xml from 'highlight.js/lib/languages/xml'
import yaml from 'highlight.js/lib/languages/yaml'

/** 语法 → 语言函数（模块默认导出的 LanguageFn，注册名即模块名）。 */
const GRAMMARS: Record<string, LanguageFn> = {
  bash,
  c,
  clojure,
  cmake,
  cpp,
  csharp,
  css,
  dart,
  diff,
  dockerfile,
  elixir,
  erlang,
  go,
  graphql,
  groovy,
  haskell,
  ini,
  java,
  javascript,
  json,
  julia,
  kotlin,
  less,
  lua,
  makefile,
  markdown,
  matlab,
  nginx,
  objectivec,
  perl,
  php,
  plaintext,
  powershell,
  properties,
  protobuf,
  python,
  r,
  ruby,
  rust,
  scala,
  scss,
  sql,
  swift,
  typescript,
  xml, // xml 模块自带 html/xhtml/svg 等别名（LanguageFn.aliases 随注册生效）
  yaml,
}

/** 额外别名：常见围栏/文件扩展名的习惯写法。 */
const ALIASES: Record<string, string> = {
  // JavaScript 家族
  js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript',
  // TypeScript 家族
  ts: 'typescript', tsx: 'typescript', mts: 'typescript', cts: 'typescript',
  // 脚本与 shell
  py: 'python',
  sh: 'bash', shell: 'bash', zsh: 'bash', console: 'bash',
  rb: 'ruby',
  kt: 'kotlin', kts: 'kotlin',
  rs: 'rust',
  cs: 'csharp',
  'c++': 'cpp', cc: 'cpp', cxx: 'cpp', hpp: 'cpp', h: 'c',
  md: 'markdown',
  txt: 'plaintext', text: 'plaintext', log: 'plaintext',
  yml: 'yaml',
  toml: 'ini', conf: 'ini', env: 'ini',
  patch: 'diff',
  docker: 'dockerfile', containerfile: 'dockerfile',
  ps1: 'powershell', pwsh: 'powershell',
  make: 'makefile', mk: 'makefile',
  gql: 'graphql', graphqls: 'graphql',
  proto: 'protobuf',
  hs: 'haskell',
  ex: 'elixir', exs: 'elixir',
  erl: 'erlang',
  clj: 'clojure', cljs: 'clojure',
  mysql: 'sql', postgres: 'sql',
  objc: 'objectivec',
}

/** 在 core 实例上注册常用子集 + 别名（幂等，多次调用无副作用）。 */
export function registerHighlightLanguages(hljs: HLJSApi): void {
  for (const [name, grammar] of Object.entries(GRAMMARS)) {
    if (hljs.getLanguage(name) === undefined) {
      hljs.registerLanguage(name, grammar)
    }
  }
  for (const [alias, target] of Object.entries(ALIASES)) {
    if (hljs.getLanguage(alias) === undefined) {
      hljs.registerAliases([alias], { languageName: target })
    }
  }
}
