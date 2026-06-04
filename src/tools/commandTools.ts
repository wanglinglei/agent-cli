/*
 * @Author: wanglinglei
 * @Date: 2026-06-04 00:00:00
 * @Description: 提供本地命令流程使用的 LangChain 标准工具。
 * @FilePath: /agents-cli/src/tools/commandTools.ts
 * @LastEditTime: 2026-06-04 00:00:00
 */
import { stdin as input, stdout as output } from "node:process";
import { createInterface } from "node:readline/promises";

import { tool } from "langchain";
import { z } from "zod";

import { toPrettyJson } from "../text.js";
import { checkCommandRisk } from "./riskChecker.js";
import { executeCommandPlan } from "./shellExecutor.js";
import type { AgentRuntime, AgentState, CommandPlan } from "../types.js";

/**
 * 命令工具创建上下文。
 */
export interface CommandToolContext {
  state: AgentState;
  runtime: AgentRuntime;
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
 * 风险检查，并限制同一轮 ReAct 只执行一次命令计划。
 */
export function createCommandTools(context: CommandToolContext) {
  let commandExecutionAttempted = false;
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
      const risk = checkCommandRisk(plan);
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

      if (commandExecutionAttempted && !readOnlyPlan) {
        return toPrettyJson({
          success: false,
          cancelled: true,
          reason:
            "同一次 ReAct 运行中已有非只读命令计划执行或尝试执行过，禁止重复执行有副作用命令。",
        });
      }

      const risk = checkCommandRisk(plan);
      if (risk.blocked || !risk.safeToExecute) {
        return toPrettyJson({
          success: false,
          blocked: true,
          risk,
          results: [],
        });
      }

      if (!readOnlyPlan) {
        commandExecutionAttempted = true;
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

  return [askUserTool, assessCommandRiskTool, executeCommandPlanTool];
}
