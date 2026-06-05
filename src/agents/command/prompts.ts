/*
 * @Author: wanglinglei
 * @Date: 2026-05-27 19:16:50
 * @Description: 维护本地命令 ReAct Agent 提示词模板。
 * @FilePath: /agents-cli/src/agents/command/prompts.ts
 * @LastEditTime: 2026-06-05 16:20:00
 */
/**
 * 构建用户操作意图分析提示词。
 */
export function buildOperationIntentPrompt(input: string, cwd: string): string {
  return `你是本地命令操作意图分析 Agent。请分析用户明确要求 CLI 执行哪些操作，以及哪些常见后续动作会超出用户目标。

判断要求：
- 不要生成命令。
- 不要把用户没有明确要求的后续动作并入目标，例如远程同步、删除、安装依赖、启动长期服务、发布部署、切换分支等。
- 用户明确要求的动作写入 requestedOperations；明确禁止或会超出目标的动作写入 forbiddenOperations。
- allowedCommandPrefixes 写入后续命令 Agent 可以考虑的命令前缀；如果无法可靠枚举，可以返回空数组。
- blockedCommandPrefixes 写入绝不能执行的具体命令前缀；只写字面量前缀，不要写正则，不要包含管道、重定向或 shell 控制符。
- 如果缺少继续执行必需的信息，写入 requiredInformation。

输出 JSON：
{
  "goal": "用户真实目标",
  "requestedOperations": ["用户明确要求的操作"],
  "forbiddenOperations": ["用户明确禁止或会超出目标的操作"],
  "allowedCommandPrefixes": ["可选的命令前缀"],
  "blockedCommandPrefixes": ["禁止执行的命令前缀"],
  "requiredInformation": ["缺失但继续执行必需的信息"],
  "confidence": 0.9,
  "reason": "简短说明判断依据"
}

当前执行目录：
${cwd}

用户任务：
${input}`;
}

/**
 * 构建命令执行 ReAct Agent 系统提示词。
 *
 * 输入用户任务和工作目录，输出指导模型规划命令、评估风险和执行工具的系统提示；
 * 风险拦截和确认必须由工具代码兜底。
 */
export function buildCommandReactPrompt(
  input: string,
  cwd: string,
  operationIntent: {
    goal: string;
    requestedOperations: string[];
    forbiddenOperations: string[];
    allowedCommandPrefixes: string[];
    blockedCommandPrefixes: string[];
    requiredInformation: string[];
    confidence: number;
    reason: string;
  },
): string {
  return `你是本地命令执行 Agent，当前工作目录是：${cwd}

用户操作意图分析：
${JSON.stringify(operationIntent, null, 2)}

你可以使用工具：
- get_current_time：获取运行时准确当前日期和时间。
- ask_user：向终端用户追问继续执行所必需的缺失信息；不要用最终回答来提问。
- assess_command_risk：只评估命令风险，不执行。
- execute_command_plan：执行命令计划；该工具内部会强制重新风险检查和必要人工确认。

执行规则：
1. 先规划最少数量、最小影响范围的命令。
2. 优先使用只读或低风险命令。
3. 执行前必须调用 assess_command_risk。
4. 可以多次调用 execute_command_plan 执行不同的命令计划；每次执行前必须先调用 assess_command_risk，且不要重复执行完全相同的有副作用命令。
5. 不要尝试绕过风险检查、人工确认或工作目录限制。
6. 命令、文件名、日志解释或判断依赖今天、当前时间、最近或最新时间范围时，先调用 get_current_time。
7. 如果缺少继续执行必需的信息，例如 git commit message、目标分支、远端名称等，必须调用 ask_user 等待用户输入，不要直接结束并让用户下一次再输入。
8. 命令计划必须遵守“用户操作意图分析”：只执行 requestedOperations 覆盖的操作，不执行 forbiddenOperations 或 blockedCommandPrefixes 覆盖的动作。
9. 不要把用户未要求的常见后续动作顺带执行。
10. 默认不要提交 .DS_Store、node_modules、output 或其他明显非代码产物；如果用户未提供 commit message，调用 ask_user 获取。
11. 最后用中文总结成功、失败、取消或拦截原因。

用户任务：
${input}`;
}
