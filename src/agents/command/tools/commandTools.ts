/*
 * @Author: wanglinglei
 * @Date: 2026-06-04 00:00:00
 * @Description: 提供本地命令流程使用的 LangChain 标准工具。
 * @FilePath: /agents-cli/src/agents/command/tools/commandTools.ts
 * @LastEditTime: 2026-06-04 16:50:00
 */
import { stdin as input, stdout as output } from "node:process";
import { createInterface } from "node:readline/promises";

import { tool } from "langchain";
import { z } from "zod";

import { toPrettyJson } from "../../../text.js";
import { createCurrentTimeTool } from "../../../tools/currentTime.js";
import { checkCommandRisk } from "../../../tools/riskChecker.js";
import { executeCommandPlan } from "../../../tools/shellExecutor.js";
import type { OperationIntentDecision } from "../pluginData.js";
import type {
  AgentRuntime,
  AgentState,
  CommandPlan,
  RiskAssessment,
} from "../../../types.js";

/**
 * 命令工具创建上下文。
 */
export interface CommandToolContext {
  state: AgentState;
  runtime: AgentRuntime;
  operationIntent: OperationIntentDecision;
}

const commandPlanSchema = z.object({
  goal: z.string().min(1).describe("Command plan goal."),
  commands: z
    .array(
      z.object({
        command: z.string().min(1).describe("Shell command to execute."),
        explanation: z.string().min(1).describe("Why this command is needed."),
        expectedOutput: z.string().optional().describe("Expected command output."),
      }),
    )
    .min(1)
    .max(8),
  requiresScript: z.boolean().default(false),
  notes: z.array(z.string()).default([]),
});

const readOnlyCommandPatterns = [
  /^pwd$/,
  /^ls(?:\s|$)/,
  /^cat\s+[^>|&;]+$/,
  /^rg\s+[^>|&;]*$/,
  /^git\s+status(?:\s|$)/,
  /^git\s+diff(?:\s|$)/,
  /^git\s+branch(?:\s|$)/,
  /^git\s+remote(?:\s|$)/,
  /^git\s+log(?:\s|$)/,
  /^git\s+show(?:\s|$)/,
  /^git\s+rev-parse(?:\s|$)/,
  /^git\s+ls-files(?:\s|$)/,
];

/**
 * 判断命令计划是否只包含可重复执行的只读检查。
 *
 * 输入命令计划，输出是否可在同一轮 ReAct 中多次执行；失败策略是保守返回 false，
 * 避免把有副作用命令误判为只读。
 */
function isReadOnlyCommandPlan(plan: CommandPlan): boolean {
  return plan.commands.every((item) => {
    const command = item.command.trim();
    if (!command || /[>|;&]/.test(command)) {
      return false;
    }

    return readOnlyCommandPatterns.some((pattern) => pattern.test(command));
  });
}

/**
 * 规范化已执行命令的去重键。
 *
 * 输入命令文本，输出压缩空白后的稳定键；失败策略是不解析 shell，只避免完全相同
 * 的有副作用命令在同一轮中被重复执行。
 */
function buildExecutedCommandKey(command: string): string {
  return command.trim().replace(/\s+/g, " ");
}

/**
 * 规范化命令前缀比较用文本。
 *
 * 输入命令或命令前缀，输出压缩空白后的文本；失败策略是不解析 shell，只做保守
 * 字面量比较。
 */
function normalizeCommandPrefixText(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

/**
 * 判断命令是否命中模型给出的禁止前缀。
 *
 * 输入命令和字面量前缀，输出是否命中；前缀为空或包含 shell 控制符时忽略，避免
 * 把模型输出当成可执行语法或正则。
 */
function commandMatchesBlockedPrefix(command: string, prefix: string): boolean {
  const normalizedCommand = normalizeCommandPrefixText(command);
  const normalizedPrefix = normalizeCommandPrefixText(prefix);

  if (!normalizedCommand || !normalizedPrefix || /[>|&;]/.test(normalizedPrefix)) {
    return false;
  }

  return (
    normalizedCommand === normalizedPrefix ||
    normalizedCommand.startsWith(`${normalizedPrefix} `)
  );
}

/**
 * 找出违反模型操作意图边界的命令。
 *
 * 输入命令计划和操作意图，输出命中的命令和禁止前缀；失败策略是没有命中时返回空数组。
 */
function findOperationIntentViolations(
  plan: CommandPlan,
  operationIntent: OperationIntentDecision,
): Array<{ command: string; blockedPrefix: string }> {
  const blockedPrefixes = operationIntent.blockedCommandPrefixes.filter(Boolean);
  const violations: Array<{ command: string; blockedPrefix: string }> = [];

  for (const item of plan.commands) {
    for (const blockedPrefix of blockedPrefixes) {
      if (commandMatchesBlockedPrefix(item.command, blockedPrefix)) {
        violations.push({ command: item.command, blockedPrefix });
      }
    }
  }

  return violations;
}

/**
 * 结合大模型分析出的用户操作意图对命令计划做上下文风险检查。
 *
 * 输入命令计划和操作意图，输出最终风险评估；当命令命中模型给出的
 * blockedCommandPrefixes 时，按 blocked 处理。
 */
function checkCommandRiskWithOperationIntent(
  plan: CommandPlan,
  operationIntent: OperationIntentDecision,
): RiskAssessment {
  const baseRisk = checkCommandRisk(plan);
  const violations = findOperationIntentViolations(plan, operationIntent);

  if (violations.length === 0) {
    return baseRisk;
  }

  const violationReasons = violations.map(
    (item) => `命令 \`${item.command}\` 命中模型判定的越界前缀 \`${item.blockedPrefix}\`。`,
  );

  return {
    level: "blocked",
    blocked: true,
    reasons: [
      `大模型判断该命令计划超出用户操作意图，已拦截。判断理由：${operationIntent.reason}`,
      ...violationReasons,
      ...baseRisk.reasons.filter((reason) => reason !== "未命中高危规则。"),
    ],
    safeToExecute: false,
  };
}

/**
 * 对 high 风险命令执行人工确认。
 *
 * 输入命令计划、风险原因和运行时，输出用户是否批准；autoApprove 为 true 时会直接
 * 批准，但不会跳过上游风险检查。
 */
async function confirmHighRiskCommand(
  plan: CommandPlan,
  reasons: string[],
  context: CommandToolContext,
): Promise<boolean> {
  if (context.state.autoApprove) {
    context.runtime.logger.warn("--yes 已开启，将跳过 high 风险命令交互确认。");
    return true;
  }

  context.runtime.logger.warn(`风险提示：${reasons.join("；")}`);
  context.runtime.logger.info("即将执行以下命令：");
  for (const [index, item] of plan.commands.entries()) {
    context.runtime.logger.info(`${index + 1}. ${item.explanation}`);
    context.runtime.logger.command(item.command);
  }

  const rl = createInterface({ input, output });
  try {
    const answer = await rl.question(
      context.runtime.logger.userPrompt("确认执行以上命令吗？输入 y/yes 执行："),
    );
    return ["y", "yes"].includes(answer.trim().toLowerCase());
  } finally {
    rl.close();
  }
}

/**
 * 创建命令风险评估和执行工具。
 *
 * 输入当前运行状态和运行时，输出 LangChain 工具集合；命令执行工具内部会强制重新
 * 风险检查，并拦截同一轮 ReAct 中完全重复的有副作用命令。
 */
export function createCommandTools(context: CommandToolContext) {
  const executedSideEffectCommandKeys = new Set<string>();
  let userQuestionCount = 0;

  const askUserTool = tool(
    async ({ question }) => {
      userQuestionCount += 1;
      if (userQuestionCount > 3) {
        return toPrettyJson({
          answered: false,
          reason: "同一次 ReAct 运行中用户追问次数超过 3 次，已停止继续追问。",
        });
      }

      const rl = createInterface({ input, output });
      try {
        const answer = await rl.question(
          context.runtime.logger.userPrompt(question),
        );
        return toPrettyJson({
          answered: Boolean(answer.trim()),
          answer: answer.trim(),
        });
      } finally {
        rl.close();
      }
    },
    {
      name: "ask_user",
      description:
        "Ask the terminal user for missing information required to safely continue the command task. Use this instead of ending with a question.",
      schema: z.object({
        question: z.string().min(1).describe("Question to show in terminal."),
      }),
    },
  );

  const assessCommandRiskTool = tool(
    async (plan) => {
      const risk = checkCommandRiskWithOperationIntent(
        plan,
        context.operationIntent,
      );
      return toPrettyJson(risk);
    },
    {
      name: "assess_command_risk",
      description:
        "Assess local shell command risk before execution. This only evaluates risk and never executes commands.",
      schema: commandPlanSchema,
    },
  );

  const executeCommandPlanTool = tool(
    async (plan) => {
      const readOnlyPlan = isReadOnlyCommandPlan(plan);

      if (!readOnlyPlan) {
        const duplicatedCommand = plan.commands.find((item) =>
          executedSideEffectCommandKeys.has(buildExecutedCommandKey(item.command)),
        );

        if (duplicatedCommand) {
          return toPrettyJson({
            success: false,
            cancelled: true,
            reason: `同一次 ReAct 运行中命令 \`${duplicatedCommand.command}\` 已执行过，禁止重复执行相同的有副作用命令。`,
          });
        }
      }

      const risk = checkCommandRiskWithOperationIntent(
        plan,
        context.operationIntent,
      );
      if (risk.blocked || !risk.safeToExecute) {
        return toPrettyJson({
          success: false,
          blocked: true,
          risk,
          results: [],
        });
      }

      if (risk.level === "high") {
        const approved = await confirmHighRiskCommand(plan, risk.reasons, context);
        if (!approved) {
          return toPrettyJson({
            success: false,
            cancelled: true,
            risk,
            results: [],
          });
        }
      }

      for (const command of plan.commands) {
        context.runtime.logger.command(command.command);
      }

      const executionResult = await executeCommandPlan(plan.commands, context.state.cwd);

      if (!readOnlyPlan) {
        for (const result of executionResult.results) {
          if (result.exitCode === 0) {
            executedSideEffectCommandKeys.add(buildExecutedCommandKey(result.command));
          }
        }
      }

      return toPrettyJson({
        risk,
        ...executionResult,
      });
    },
    {
      name: "execute_command_plan",
      description:
        "Execute a local command plan after mandatory risk checks and required human confirmation.",
      schema: commandPlanSchema,
    },
  );

  return [
    createCurrentTimeTool(),
    askUserTool,
    assessCommandRiskTool,
    executeCommandPlanTool,
  ];
}
