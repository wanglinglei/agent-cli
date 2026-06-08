# agents-cli

Node + LangGraph + LangChain + TypeScript 多 Agent 自动化任务执行器。

所有能力共享一个命令行入口：`agents`。
用户只输入自然语言任务，不选择 Agent 名称；系统会先做意图分析，再自动决定调用哪条 Agent 流程。

用户只需要在命令行输入自然语言任务，系统会由 `routerAgent` 自动判断要调用哪组 ReAct 工具调用流程：

- 旅行规划任务：`travelReactAgent` 自主调用当前时间、天气、高德 MCP、Pexels MCP 和 Markdown 产物工具。
- 天气任务：`weatherReactAgent` 自主调用和风天气城市查询和天气查询工具。
- 资料型任务：`researchReactAgent` 自主调用搜索和 Markdown 产物工具。
- 行政边界任务：`boundaryReactAgent` 自主调用城市编码、边界下载、SVG 和产物工具。
- 本地命令任务：`commandReactAgent` 自主调用风险评估和命令执行工具。

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
    │   ├── pluginData.ts
    │   └── reactToolRunner.ts
    ├── prompts/
    │   ├── jsonRepairPrompts.ts
    │   └── routerPrompts.ts
    ├── agents/
    │   ├── travel/
    │   │   ├── agents.ts
    │   │   ├── flow.ts
    │   │   ├── pluginData.ts
    │   │   ├── prompts.ts
    │   │   └── tools/
    │   │       ├── amapMcpClient.ts
    │   │       ├── pexelsMcpClient.ts
    │   │       └── travelTools.ts
    │   ├── weather/
    │   │   ├── agents.ts
    │   │   ├── flow.ts
    │   │   ├── pluginData.ts
    │   │   ├── prompts.ts
    │   │   └── tools/
    │   │       ├── qweatherClient.ts
    │   │       └── weatherTools.ts
    │   ├── boundary/
    │   │   ├── agents.ts
    │   │   ├── flow.ts
    │   │   ├── pluginData.ts
    │   │   ├── prompts.ts
    │   │   └── tools/
    │   │       ├── boundaryCityCode.ts
    │   │       ├── boundaryFetch.ts
    │   │       ├── boundarySvg.ts
    │   │       └── boundaryTools.ts
    │   ├── command/
    │   │   ├── agents.ts
    │   │   ├── flow.ts
    │   │   ├── pluginData.ts
    │   │   ├── prompts.ts
    │   │   └── tools/
    │   │       └── commandTools.ts
    │   ├── research/
    │   │   ├── agents.ts
    │   │   ├── flow.ts
    │   │   ├── pluginData.ts
    │   │   ├── prompts.ts
    │   │   └── tools/
    │   │       └── researchTools.ts
    │   ├── router/
    │   │   └── agents.ts
    │   └── unknown/
    │       └── agents.ts
    ├── tools/
    │   ├── currentTime.ts
    │   ├── riskChecker.ts
    │   ├── shellExecutor.ts
    │   └── tavilySearch.ts
    └── memory/
        ├── InMemoryMemoryStore.ts
        └── MemoryStore.ts
```

业务 flow 采用目录内聚结构：`src/agents/<flow>/` 下同时维护 Agent 节点、提示词、私有状态、flow 注册定义和业务专属 `tools/`。`src/tools/` 只保留跨业务复用的公共基础能力，例如当前时间读取、统一搜索封装、本地命令执行和风险检查；`src/prompts/` 只保留 router、JSON 修复等公共提示词。
业务流程通过 `src/graph/agentRegistry.ts` 聚合 flow definition；路由后进入对应 ReAct 节点，由 `src/graph/reactToolRunner.ts` 使用 LangChain v1 的 `createAgent` 创建工具调用子图。`AgentState` 顶层只保存公共数据，资料、边界、命令等流程私有中间态统一存入 `pluginData`，并由各 flow 的 `PluginDataStore` 子类读写。

命令执行工具会在执行前强制重新运行风险检查：`blocked` 命令不执行，`high` 风险命令必须确认或使用 `--yes`，`medium` 和 `low` 通过检查后执行。`--yes` 只跳过确认，不跳过风险检查。

最终产物目录示例：

```text
output/
├── boundaryReactAgent/
│   ├── <runId>-boundary-geojson.geojson
│   └── <runId>-boundary-svg.svg
└── researchReactAgent/
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
WEATHER_API_HOST=https://your-qweather-api-host
WEATHER_API_TOKEN=your_qweather_api_token
AMAP_MCP_URL=https://mcp.amap.com/mcp?key=your_amap_key
AMAP_MAPS_API_KEY=your_amap_maps_api_key
PEXELS_MCP_COMMAND=your_pexels_mcp_command
PEXELS_MCP_ARGS=["--your","args"]
PEXELS_API_KEY=your_pexels_api_key
LLM_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
LLM_MODEL=qwen-plus
```

`WEATHER_API_HOST` 使用和风天气控制台分配的 API Host；天气查询工具会同时用它访问 `/geo/v2/city/lookup` 和 `/v7/weather/...`。
旅行规划使用高德地图 MCP 查询景点、酒店、餐饮和距离；如果配置了 `AMAP_MCP_URL` 会优先使用它，否则用 `AMAP_MAPS_API_KEY` 组装官方 MCP 地址。
旅行规划还会通过本地 stdio Pexels MCP 为最终景点配图，每个景点返回 1-3 张图片；配置 `PEXELS_MCP_COMMAND` 和可选的 `PEXELS_MCP_ARGS`，`PEXELS_API_KEY` 会注入到 MCP 子进程环境中。图片会下载到 `output/travelReactAgent/<runId>-travel-plan-assets/`，Markdown 使用本地绝对路径引用这些图片，避免预览器拒绝超长 data URI 或无法解析相对路径。景点候选以卡片块展示，景点信息和配图放在同一个卡片中，不再单独生成“景点配图”章节；同一景点的多张配图会以每行 3 张的 Markdown 表格展示。

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

旅行规划任务：

```bash
agents "帮我规划未来7天杭州旅行，考虑天气、景点和酒店"
```

天气任务：

```bash
agents "明天北京适合跑步吗？"
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
