/*
 * @Author: wanglinglei
 * @Date: 2026-05-27 19:16:50
 * @Description: 实现本地命令意图解析、生成、确认、执行和反馈 Agent 节点。
 * @FilePath: /agents-cli/src/agents/commandAgents.ts
 * @LastEditTime: 2026-05-27 19:16:50
 */
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

import { z } from "zod";

import { appendArtifact, formatArtifactPath, writeAgentArtifact } from "../artifacts.js";
import { invokeJson, invokeText } from "../json.js";
import {
  buildCommandFeedbackPrompt,
  buildCommandIntentPrompt,
  buildCommandPlanPrompt,
  buildUnknownTaskMessage,
} from "../prompts/commandPrompts.js";
import { toPrettyJson, truncateText } from "../text.js";
import { checkCommandRisk } from "../tools/riskChecker.js";
import { executeCommandPlan } from "../tools/shellExecutor.js";
import type {
  AgentRuntime,
  AgentState,
  CommandIntent,
  CommandPlan,
} from "../types.js";

const commandIntentSchema = z.object({
  goal: z.string(),
  commandType: z.enum(["shell", "git", "script", "mixed"]),
  target: z.string(),
  cwd: z.string(),
  constraints: z.array(z.string()),
});

const commandPlanSchema = z.object({
  goal: z.string(),
  commands: z
    .array(
      z.object({
        command: z.string(),
        explanation: z.string(),
        expectedOutput: z.string().optional(),
      }),
    )
    .min(1)
    .max(8),
  requiresScript: z.boolean(),
  notes: z.array(z.string()),
});

/**
 * 命令意图解析 Agent。
 *
 * 该节点把用户的自然语言目标拆成“目标、命令类型、操作对象、限制条件”，为命令
 * 生成 Agent 提供更稳定的上下文。
 */
export async function intentAgent(
  state: AgentState,
  runtime: AgentRuntime,
): Promise<Partial<AgentState>> {
  const nodeName = "intentAgent";
  runtime.logger.nodeStart(nodeName, truncateText(state.input));

  try {
    const commandIntent = await invokeJson<CommandIntent>(
      runtime.llm,
      buildCommandIntentPrompt(state.input, state.cwd),
      commandIntentSchema,
    );

    runtime.logger.nodeSuccess(
      nodeName,
      `${commandIntent.commandType}: ${commandIntent.goal}`,
    );
    runtime.logger.debug("命令意图", commandIntent);

    return { commandIntent };
  } catch (error) {
    runtime.logger.nodeError(nodeName, error);
    return {
      errors: [...state.errors, error instanceof Error ? error.message : String(error)],
      finalAnswer: "命令意图解析失败，无法安全生成本地命令。",
    };
  }
}

/**
 * 命令生成 Agent。
 *
 * 根据命令意图生成可审查的 Shell/Git/脚本命令。第一版必须优先生成非破坏性命令，
 * 并把命令解释和预期输出一起返回，供用户确认。
 */
export async function commandAgent(
  state: AgentState,
  runtime: AgentRuntime,
): Promise<Partial<AgentState>> {
  const nodeName = "commandAgent";
  runtime.logger.nodeStart(
    nodeName,
    truncateText(state.commandIntent?.goal ?? state.input),
  );

  try {
    const commandPlan = await invokeJson<CommandPlan>(
      runtime.llm,
      buildCommandPlanPrompt(state.input, toPrettyJson(state.commandIntent)),
      commandPlanSchema,
    );

    runtime.logger.nodeSuccess(nodeName, `生成 ${commandPlan.commands.length} 条命令`);
    runtime.logger.debug("命令计划", commandPlan);

    return { commandPlan };
  } catch (error) {
    runtime.logger.nodeError(nodeName, error);
    return {
      errors: [...state.errors, error instanceof Error ? error.message : String(error)],
      finalAnswer: "命令生成失败，无法继续执行。",
    };
  }
}

/**
 * 风险检查 Agent。
 *
 * 对命令计划进行本地规则检查，拦截明显危险命令。被拦截的命令不会进入确认或执行
 * 节点，避免 LLM 生成内容直接影响本机。
 */
export async function riskAgent(
  state: AgentState,
  runtime: AgentRuntime,
): Promise<Partial<AgentState>> {
  const nodeName = "riskAgent";
  runtime.logger.nodeStart(
    nodeName,
    `${state.commandPlan?.commands.length ?? 0} 条命令`,
  );

  try {
    if (!state.commandPlan) {
      throw new Error("缺少命令计划，无法检查风险。");
    }

    const risk = checkCommandRisk(state.commandPlan);

    if (risk.blocked) {
      runtime.logger.warn(`命令被拦截：${risk.reasons.join("；")}`);
    }

    runtime.logger.nodeSuccess(nodeName, `风险等级：${risk.level}`);
    runtime.logger.debug("风险检查结果", risk);

    return { risk };
  } catch (error) {
    runtime.logger.nodeError(nodeName, error);
    return {
      errors: [...state.errors, error instanceof Error ? error.message : String(error)],
      risk: {
        level: "blocked",
        blocked: true,
        reasons: ["风险检查失败，默认拦截。"],
        safeToExecute: false,
      },
    };
  }
}

/**
 * 用户确认节点。
 *
 * 在终端展示命令、解释和风险原因，只有用户明确输入 y/yes 后才进入执行节点。
 */
export async function confirmNode(
  state: AgentState,
  runtime: AgentRuntime,
): Promise<Partial<AgentState>> {
  const nodeName = "confirmNode";
  runtime.logger.nodeStart(nodeName, "等待用户确认命令执行");

  if (!state.commandPlan || !state.risk?.safeToExecute) {
    runtime.logger.nodeSuccess(nodeName, "命令不可执行，跳过确认");
    return { userApproved: false };
  }

  runtime.logger.info("即将执行以下命令：");
  for (const [index, item] of state.commandPlan.commands.entries()) {
    runtime.logger.info(`${index + 1}. ${item.explanation}`);
    runtime.logger.command(item.command);
    if (item.expectedOutput) {
      runtime.logger.debug("预期输出", item.expectedOutput);
    }
  }

  if (state.risk.reasons.length > 0) {
    runtime.logger.warn(`风险提示：${state.risk.reasons.join("；")}`);
  }

  if (state.autoApprove) {
    runtime.logger.warn("--yes 已开启，将跳过交互确认。");
    runtime.logger.nodeSuccess(nodeName, "用户确认：yes");
    return { userApproved: true };
  }

  const rl = createInterface({ input, output });
  const answer = await rl.question("确认执行以上命令吗？输入 y/yes 执行：");
  rl.close();

  const userApproved = ["y", "yes"].includes(answer.trim().toLowerCase());
  runtime.logger.nodeSuccess(nodeName, userApproved ? "用户确认：yes" : "用户拒绝执行");

  return { userApproved };
}

/**
 * 本地命令执行 Agent。
 *
 * 只执行已经通过风险检查且用户确认的命令。命令按顺序执行，任意一条失败后停止
 * 后续执行，避免在未知状态下继续修改本地环境。
 */
export async function shellExecutorAgent(
  state: AgentState,
  runtime: AgentRuntime,
): Promise<Partial<AgentState>> {
  const nodeName = "shellExecutor";
  runtime.logger.nodeStart(nodeName, state.cwd);

  try {
    if (!state.commandPlan) {
      throw new Error("缺少命令计划，无法执行。");
    }

    if (!state.userApproved) {
      runtime.logger.nodeSuccess(nodeName, "用户未确认，未执行命令");
      return {
        executionResult: {
          success: false,
          results: [],
        },
      };
    }

    for (const command of state.commandPlan.commands) {
      runtime.logger.command(command.command);
    }

    const executionResult = await executeCommandPlan(
      state.commandPlan.commands,
      state.cwd,
    );

    runtime.logger.nodeSuccess(
      nodeName,
      executionResult.success ? "所有命令执行成功" : "命令执行失败或被中断",
    );
    runtime.logger.debug("执行结果", executionResult);

    return { executionResult };
  } catch (error) {
    runtime.logger.nodeError(nodeName, error);
    return {
      errors: [...state.errors, error instanceof Error ? error.message : String(error)],
      executionResult: {
        success: false,
        results: [],
      },
    };
  }
}

/**
 * 执行反馈 Agent。
 *
 * 汇总风险检查、用户确认和命令执行结果，给出面向用户的最终解释；如果命令失败，
 * 会基于 stdout/stderr 给出排查建议。
 */
export async function feedbackAgent(
  state: AgentState,
  runtime: AgentRuntime,
): Promise<Partial<AgentState>> {
  const nodeName = "feedbackAgent";
  runtime.logger.nodeStart(nodeName, "整理命令执行反馈");

  try {
    if (state.risk?.blocked) {
      const content = `命令已被安全策略拦截，未执行。\n\n原因：\n${state.risk.reasons
        .map((item) => `- ${item}`)
        .join("\n")}`;
      const artifact = await writeAgentArtifact(state, runtime, {
        agentName: nodeName,
        label: "final",
        extension: "md",
        content,
      });
      const finalAnswer = `安全拦截说明已写入：${formatArtifactPath(
        state.cwd,
        artifact.filePath,
      )}`;
      runtime.logger.nodeSuccess(nodeName, "已生成拦截说明");
      return { finalAnswer, artifacts: appendArtifact(state, artifact) };
    }

    if (state.userApproved === false) {
      const content = "用户未确认执行，命令已取消。";
      const artifact = await writeAgentArtifact(state, runtime, {
        agentName: nodeName,
        label: "final",
        extension: "md",
        content,
      });
      const finalAnswer = `取消执行说明已写入：${formatArtifactPath(
        state.cwd,
        artifact.filePath,
      )}`;
      runtime.logger.nodeSuccess(nodeName, finalAnswer);
      return { finalAnswer, artifacts: appendArtifact(state, artifact) };
    }

    const content = await invokeText(
      runtime.llm,
      buildCommandFeedbackPrompt({
        input: state.input,
        commandPlan: state.commandPlan,
        risk: state.risk,
        executionResult: state.executionResult,
        stringify: toPrettyJson,
      }),
    );

    const artifact = await writeAgentArtifact(state, runtime, {
      agentName: nodeName,
      label: "final",
      extension: "md",
      content,
    });
    const finalAnswer = `命令执行反馈已写入：${formatArtifactPath(
      state.cwd,
      artifact.filePath,
    )}`;

    runtime.logger.nodeSuccess(nodeName, truncateText(finalAnswer));
    runtime.logger.debug("最终反馈", content);

    return { finalAnswer, artifacts: appendArtifact(state, artifact) };
  } catch (error) {
    runtime.logger.nodeError(nodeName, error);
    return {
      errors: [...state.errors, error instanceof Error ? error.message : String(error)],
      finalAnswer: "命令执行反馈生成失败，请查看 verbose 日志中的执行结果。",
    };
  }
}

/**
 * 未知任务处理节点。
 *
 * 当 routerAgent 无法可靠判断任务类型时，不进入任何可能产生副作用的流程，而是
 * 要求用户补充更明确的目标。
 */
export async function unknownAgent(
  state: AgentState,
  runtime: AgentRuntime,
): Promise<Partial<AgentState>> {
  const nodeName = "unknownAgent";
  runtime.logger.nodeStart(nodeName, truncateText(state.input));

  const finalAnswer = buildUnknownTaskMessage(state.route?.reason);

  runtime.logger.nodeSuccess(nodeName, "已生成澄清提示");
  return { finalAnswer };
}
