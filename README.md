# agents-cli

Node + LangGraph + LangChain + TypeScript 多 Agent 自动化任务执行器。

所有能力共享一个命令行入口：`agents`。
用户只输入自然语言任务，不选择 Agent 名称；系统会先做意图分析，再自动决定调用哪条 Agent 流程。

用户只需要在命令行输入自然语言任务，系统会由 `routerAgent` 自动判断要调用哪组 Agent：

- 资料型任务：搜索 Agent -> 总结 Agent -> 写作 Agent -> 格式化 Agent
- 行政边界任务：边界意图解析 Agent -> 城市编码解析 Agent -> 边界下载/产物输出 Agent
- 本地命令任务：意图解析 Agent -> 命令生成 Agent -> 风险检查 Agent -> Shell 执行或高风险确认 -> 反馈 Agent

终端展示运行状态、最终结果和必要的产物路径。搜索结果、摘要、初稿、命令计划等过程产物不会写文件；只有明确需要文件产物的任务才写入 `output/<最终Agent>/`。

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
    │   ├── agentRegistry.ts
    │   ├── flowTypes.ts
    │   ├── index.ts
    │   └── pluginData.ts
    ├── prompts/
    │   ├── jsonRepairPrompts.ts
    │   └── routerPrompts.ts
    ├── agents/
    │   ├── boundary/
    │   │   ├── agents.ts
    │   │   ├── flow.ts
    │   │   ├── pluginData.ts
    │   │   └── prompts.ts
    │   ├── command/
    │   │   ├── agents.ts
    │   │   ├── flow.ts
    │   │   ├── pluginData.ts
    │   │   └── prompts.ts
    │   ├── research/
    │   │   ├── agents.ts
    │   │   ├── flow.ts
    │   │   ├── pluginData.ts
    │   │   └── prompts.ts
    │   ├── router/
    │   │   └── agents.ts
    │   └── unknown/
    │       └── agents.ts
    ├── tools/
    │   ├── boundaryCityCode.ts
    │   ├── boundaryFetch.ts
    │   ├── boundarySvg.ts
    │   ├── riskChecker.ts
    │   ├── shellExecutor.ts
    │   └── tavilySearch.ts
    └── memory/
        ├── InMemoryMemoryStore.ts
        └── MemoryStore.ts
```

业务 flow 采用目录内聚结构：`src/agents/<flow>/` 下同时维护 Agent 节点、提示词、私有状态和 flow 注册定义。`src/prompts/` 只保留 router、JSON 修复等公共提示词。
业务流程通过 `src/graph/agentRegistry.ts` 聚合 flow definition；`AgentState` 顶层只保存公共数据，资料、边界、命令等流程私有中间态统一存入 `pluginData`，并由各 flow 的 `PluginDataStore` 子类读写。

最终产物目录示例：

```text
output/
├── boundaryOutputAgent/
│   ├── <runId>-boundary-geojson.geojson
│   └── <runId>-boundary-svg.svg
└── formatAgent/
    └── <runId>-final.md
```

## 安装

```bash
pnpm install
```

安装到全局命令，推荐开发时使用全局链接。

如果 pnpm 还没有配置过全局命令目录，先执行：

```bash
pnpm setup
```

然后重开终端，或重新加载 shell 配置：

```bash
source ~/.zshrc
```

再回到项目根目录执行：

```bash
pnpm link --global
```

之后在任意终端窗口都可以使用：

```bash
agents
agents "你的自然语言任务"
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

全局 `agents` 命令会优先读取当前工作目录的 `.env`，再读取 CLI 项目根目录的 `.env` 作为兜底。

## 使用

统一入口命令：

```bash
agents
```

或：

```bash
agents "你的自然语言任务"
```

如果当前还没安装到 PATH，可在项目根目录先直接用：

```bash
./agents
```

交互式输入任务：

```bash
agents
```

启动后直接在终端输入自然语言任务即可。

直接传入自然语言任务：

```bash
agents "写一篇 LangGraph 多 Agent 学习笔记，包含资料来源并生成 markdown"
```

资料型任务：

```bash
agents "写一篇 LangGraph 多 Agent 学习笔记，包含资料来源并生成 markdown"
```

行政边界 SVG 任务：

```bash
agents "生成高邮市行政边界 SVG，填充浅蓝色，描边深灰色"
```

行政边界 GeoJSON 任务：

```bash
agents "下载321084的行政边界 geojson"
```

本地命令型任务：

```bash
agents "帮我批量压缩当前目录所有图片"
```

Git 任务：

```bash
agents "帮我查看当前仓库最近三次提交并解释"
```

打印中间状态：

```bash
agents --verbose "帮我批量压缩当前目录所有图片"
```

跳过需要人工确认的命令：

```bash
agents --yes "帮我查看当前仓库最近三次提交并解释"
```

## 安全策略

本地命令必须先经过风险检查，执行策略由风险等级决定：

- `blocked`：禁止执行，直接生成拦截说明。
- `high`：展示命令和风险原因，人工确认后执行。
- `medium` 和 `low`：通过风险检查后直接执行。

`--yes` 只跳过需要人工确认的命令，不跳过风险检查。

`high` 规则包含 `sudo`，会在人工确认后执行。

`blocked` 规则会禁止执行这些命令：

- `rm -rf`
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

新增 Agent 流程时，默认创建 `src/agents/<flow>/`，在目录内维护 `agents.ts`、`prompts.ts`、`pluginData.ts` 和 `flow.ts`；再在 `src/graph/agentRegistry.ts` 聚合该 flow definition。业务中间态默认放入 `pluginData[route]`，并通过继承 `PluginDataStore<T>` 的 flow 专属 store 读写；只有任务规划、多 Agent 协作、全局审计等跨流程公共数据才放入 `AgentState` 顶层。

Agent 扩展开发规范见 [.cursor/rules/agent-development-standard.mdc](.cursor/rules/agent-development-standard.mdc)，Cursor 会按项目规则默认读取。

在 Cursor 终端中使用 Codex CLI 时，Codex 会读取根目录 [AGENTS.md](AGENTS.md)，其中会要求 Codex 遵循同一份 Cursor 规则文件。

## 长期记忆扩展

当前只实现 `InMemoryMemoryStore`，进程结束后状态会丢失。

后续可以实现同一个 `MemoryStore` 接口，把运行记录保存到：

- JSON 文件
- SQLite
- 向量数据库
- LangGraph checkpointer
