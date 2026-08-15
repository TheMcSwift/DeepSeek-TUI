# 贡献指南 / Contributing

欢迎为 DeepSeek-TUI 做贡献。本项目的开发由 **dsh（DeepSeek Harness）协助完成**——人类贡献与 AI 协助都遵循同一套规则。

Contributions are welcome. This project is developed **with the assistance of dsh (DeepSeek Harness)** — human and AI-assisted contributions follow the same rules.

## 开发流程 / Development workflow

```bash
git clone https://github.com/TheMcSwift/DeepSeek-TUI.git
git clone --depth 1 https://github.com/deepseek-ai/deepseek-harness.git ../deepseek-harness   # 与仓库同级（link 依赖需要）
cd DeepSeek-TUI
pnpm install
pnpm build
```

> `devDependencies` 是 `link:../deepseek-harness/...` 相对链接——harness checkout 必须与本仓库**同级目录**（CI 也是同样的双 checkout 布局，见 `.github/workflows/ci.yml`）。

## 提交前必过 / Before you commit

```bash
pnpm typecheck   # 严格类型检查（含 tests）
pnpm test        # vitest 单测
pnpm build       # tsc 构建
python3 scripts/e2e-pty.py   # 至少一轮完整 E2E（6 场景）
```

## AI 协助政策 / AI-assistance policy

- **允许并欢迎** AI 编码代理（dsh / Claude Code / Codex 等）协助开发。
- **署名约定**：AI 协助的提交必须携带标准 trailer（不是 `Co-Authored-By`——AI 不是作者）：

```
Assisted-by: dsh <noreply@deepseek-ai.dev>
```

- **审查责任在人**：AI 生成的改动必须通过上述全部检查；提交者对其正确性负责。

## 提交信息约定 / Commit message rules

- 中文优先；类型前缀：`feat:` / `fix:` / `docs:` / `test:` / `refactor:` / `chore:`
- 尾部空行后携带 `Assisted-by` trailer（见上）

## 代码约定 / Code rules

- 架构与硬性禁忌见 [AGENTS.md](AGENTS.md)（单向数据流、`cordis.patch.yml` 必填、禁止提交构建产物等）
- 用户可见文案一律经 `src/view/strings.ts` 双语词典
- 新功能以 dsh web 客户端为基线（[FEATURE-CHECKLIST.md](FEATURE-CHECKLIST.md)），改动同步更新清单状态

## 许可证 / License

[MIT](LICENSE) © 2026 TheMcSwift
