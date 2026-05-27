# agents-cli

Node + LangGraph + LangChain + TypeScript 多 Agent 自动化任务执行器。

用户只需要在命令行输入自然语言任务，系统会由 `routerAgent` 自动判断要调用哪组 Agent：

- 资料型任务：搜索 Agent -> 总结 Agent -> 写作 Agent -> 格式化 Agent
- 本地命令任务：意图解析 Agent -> 命令生成 Agent -> 风险检查 Agent -> 用户确认 -> Shell 执行 Agent -> 反馈 Agent

终端只展示运行状态和最终产物路径。搜索结果、摘要、初稿、命令计划等过程产物不会写文件；只有最终结果会写入 `output/<最终Agent>/`。

## 项目架构

```text
agents-cli/
├── package.json
├── pnpm-lock.yaml
├── tsconfig.json
├── .env.example
├── README.md
└── src/
    ├── cli.ts
    ├── config.ts
    ├── json.ts
    ├── llm.ts
    ├── logger.ts
    ├── text.ts
    ├── types.ts
    ├── graph/
    │   └── index.ts
    ├── prompts/
    │   ├── commandPrompts.ts
    │   ├── jsonRepairPrompts.ts
    │   ├── researchPrompts.ts
    │   └── routerPrompts.ts
    ├── agents/
    │   ├── commandAgents.ts
    │   ├── researchAgents.ts
    │   └── routerAgent.ts
    ├── tools/
    │   ├── riskChecker.ts
    │   ├── shellExecutor.ts
    │   └── tavilySearch.ts
    └── memory/
        ├── InMemoryMemoryStore.ts
        └── MemoryStore.ts
```

提示词统一维护在 `src/prompts/`，Agent 业务逻辑只负责准备上下文、调用模型和更新状态。

最终产物目录示例：

```text
output/
├── formatAgent/
│   └── <runId>-final.md
└── feedbackAgent/
    └── <runId>-final.md
```

## 安装

```bash
pnpm install
```

复制环境变量示例：

```bash
cp .env.example .env
```

配置：

```bash
DASHSCOPE_API_KEY=your_dashscope_api_key
TAVILY_API_KEY=your_tavily_api_key
LLM_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
LLM_MODEL=qwen-plus
```

## 使用

资料型任务：

```bash
pnpm start -- "写一篇 LangGraph 多 Agent 学习笔记，包含资料来源并生成 markdown"
```

本地命令型任务：

```bash
pnpm start -- "帮我批量压缩当前目录所有图片"
```

Git 任务：

```bash
pnpm start -- "帮我查看当前仓库最近三次提交并解释"
```

打印中间状态：

```bash
pnpm start -- --verbose "帮我批量压缩当前目录所有图片"
```

跳过命令确认：

```bash
pnpm start -- --yes "帮我查看当前仓库最近三次提交并解释"
```

## 安全策略

本地命令默认必须人工确认后才会执行。

第一版会拦截这些高危命令：

- `rm -rf`
- `sudo`
- `chmod -R`
- `chown -R`
- `git reset --hard`
- `git clean -fd`
- 疑似直接写磁盘设备的命令

图片压缩类任务默认要求输出到 `compressed/`，不覆盖原图。

## 开发检查

```bash
pnpm type-check
```

Agent 扩展开发规范见 [.cursor/rules/agent-development-standard.mdc](.cursor/rules/agent-development-standard.mdc)，Cursor 会按项目规则默认读取。

在 Cursor 终端中使用 Codex CLI 时，Codex 会读取根目录 [AGENTS.md](AGENTS.md)，其中会要求 Codex 遵循同一份 Cursor 规则文件。

## 长期记忆扩展

当前只实现 `InMemoryMemoryStore`，进程结束后状态会丢失。

后续可以实现同一个 `MemoryStore` 接口，把运行记录保存到：

- JSON 文件
- SQLite
- 向量数据库
- LangGraph checkpointer
