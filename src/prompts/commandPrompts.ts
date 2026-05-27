/*
 * @Author: wanglinglei
 * @Date: 2026-05-27 19:16:50
 * @Description: 维护本地命令意图、计划和执行反馈相关提示词。
 * @FilePath: /agents-cli/src/prompts/commandPrompts.ts
 * @LastEditTime: 2026-05-27 19:16:50
 */
import type { CommandPlan, ExecutionResult, RiskAssessment } from "../types.js";

/**
 * 构建命令意图解析提示词。
 */
export function buildCommandIntentPrompt(input: string, cwd: string): string {
  return `你是命令意图解析 Agent。请分析用户想让 CLI 做什么。

输出 JSON：
{
  "goal": "用户真实目标",
  "commandType": "shell | git | script | mixed",
  "target": "主要操作对象",
  "cwd": "执行目录",
  "constraints": ["限制条件"]
}

当前执行目录：
${cwd}

用户任务：
${input}`;
}

/**
 * 构建命令计划生成提示词。
 */
export function buildCommandPlanPrompt(
  input: string,
  commandIntentJson: string,
): string {
  return `你是命令生成 Agent。请把用户目标转换为安全、可执行、可审查的命令计划。

安全要求：
1. 不要生成 sudo、rm -rf、git reset --hard、git clean -fd。
2. 默认不要覆盖原文件。
3. 需要批量处理图片时，在 macOS 优先使用 sips，并输出到 compressed/ 目录。
4. 如果需要创建目录，命令可以包含 mkdir -p。
5. 命令必须能在 zsh 中执行。
6. 只输出 JSON，不要 Markdown。

输出 JSON：
{
  "goal": "命令计划目标",
  "commands": [
    {
      "command": "可执行命令",
      "explanation": "为什么执行这条命令",
      "expectedOutput": "预期输出"
    }
  ],
  "requiresScript": false,
  "notes": ["执行前需要知道的注意事项"]
}

命令意图：
${commandIntentJson}

用户原始任务：
${input}`;
}

/**
 * 构建命令执行反馈提示词。
 */
export function buildCommandFeedbackPrompt(params: {
  input: string;
  commandPlan: CommandPlan | undefined;
  risk: RiskAssessment | undefined;
  executionResult: ExecutionResult | undefined;
  stringify: (value: unknown) => string;
}): string {
  return `你是命令执行反馈 Agent。请解释命令执行结果，并给出必要的下一步建议。

用户任务：
${params.input}

命令计划：
${params.stringify(params.commandPlan)}

风险检查：
${params.stringify(params.risk)}

执行结果：
${params.stringify(params.executionResult)}

要求：
1. 用中文回答。
2. 先说明是否成功。
3. 如果失败，指出最可能的原因和下一步排查命令。
4. 不要声称执行了没有执行的命令。`;
}

/**
 * 构建未知任务提示文案。
 */
export function buildUnknownTaskMessage(reason: string | undefined): string {
  return `我无法可靠判断这个任务应该走搜索写作流程还是本地命令流程，因此没有执行任何操作。

路由原因：${reason ?? "未知"}

请补充你希望我完成的具体目标，例如：
- 写一篇包含资料来源的学习笔记
- 帮我批量压缩当前目录所有图片
- 帮我查看最近三次 Git 提交并解释`;
}
