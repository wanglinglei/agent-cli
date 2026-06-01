/*
 * @Author: wanglinglei
 * @Date: 2026-05-27 19:16:50
 * @Description: 实现本地命令意图解析、生成、确认、执行和反馈 Agent 节点。
 * @FilePath: /agents-cli/src/agents/command/agents.ts
 * @LastEditTime: 2026-05-28 11:01:33
 */
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

import { z } from "zod";

import { invokeJson } from "../../json.js";
import { commandPluginData } from "./pluginData.js";
import {
  buildCommandIntentPrompt,
  buildCommandPlanPrompt,
} from "./prompts.js";
import { toPrettyJson, truncateText } from "../../text.js";
import { checkCommandRisk } from "../../tools/riskChecker.js";
import { executeCommandPlan } from "../../tools/shellExecutor.js";
import type {
  AgentRuntime,
  AgentState,
  CommandIntent,
  CommandPlan,
  SingleCommandResult,
} from "../../types.js";

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
 * 提取命令输出中最有价值的一小段错误上下文。
 *
 * 优先返回 stderr；如果命令只写 stdout，则退回 stdout。输出会被截断，避免终端
 * 被大段日志淹没。
 */
function getCommandErrorOutput(result: SingleCommandResult): string {
  const outputText = (result.stderr || result.stdout).trim();
  return outputText ? truncateText(outputText, 1_200) : "命令没有输出错误详情。";
}

/**
 * 根据常见命令错误输出推断可能原因。
 *
 * 该函数不修改状态；如果无法识别具体模式，会给出保守的通用解释。
 */
function inferFailureReasons(result: SingleCommandResult): string[] {
  const text = `${result.stderr}\n${result.stdout}`.toLowerCase();
  const reasons: string[] = [];

  if (result.timedOut) {
    reasons.push("命令超过 60 秒超时，可能是网络较慢、远端无响应，或命令在等待交互输入。");
  }

  if (text.includes("already exists and is not an empty directory")) {
    reasons.push("目标目录已存在且不是空目录，Git 无法 clone 到该路径。");
  }

  if (text.includes("repository not found")) {
    reasons.push("仓库不存在、地址拼写错误，或当前账号没有访问权限。");
  }

  if (text.includes("could not resolve host") || text.includes("failed to connect")) {
    reasons.push("网络、DNS 或代理连接失败，无法访问远程服务。");
  }

  if (text.includes("authentication failed") || text.includes("permission denied")) {
    reasons.push("认证或权限不足，可能需要登录、配置 token/SSH key，或调整文件权限。");
  }

  if (text.includes("command not found")) {
    reasons.push("命令未安装，或命令所在目录不在 PATH 中。");
  }

  if (text.includes("no such file or directory")) {
    reasons.push("引用的文件或目录不存在。");
  }

  if (reasons.length === 0) {
    reasons.push("命令返回非零退出码，请优先查看下方原始错误输出。");
  }

  return reasons;
}

/**
 * 构建命令失败时直接展示给终端的反馈。
 *
 * 输入执行结果，输出简短失败说明、可能原因和原始错误片段；不会写入产物文件。
 */
function buildCommandFailureAnswer(result: SingleCommandResult): string {
  const reasons = inferFailureReasons(result)
    .map((reason) => `- ${reason}`)
    .join("\n");
  const exitCodeText = result.exitCode === null ? "未知" : String(result.exitCode);

  return `命令执行失败。\n\n失败命令：\`${result.command}\`\n退出码：${exitCodeText}\n\n可能原因：\n${reasons}\n\n原始错误输出：\n${getCommandErrorOutput(result)}`;
}

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

    return { pluginData: commandPluginData.update(state, { commandIntent }) };
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
  const commandData = commandPluginData.read(state);
  runtime.logger.nodeStart(
    nodeName,
    truncateText(commandData.commandIntent?.goal ?? state.input),
  );

  try {
    const commandPlan = await invokeJson<CommandPlan>(
      runtime.llm,
      buildCommandPlanPrompt(state.input, toPrettyJson(commandData.commandIntent)),
      commandPlanSchema,
    );

    runtime.logger.nodeSuccess(nodeName, `生成 ${commandPlan.commands.length} 条命令`);
    runtime.logger.debug("命令计划", commandPlan);

    return { pluginData: commandPluginData.update(state, { commandPlan }) };
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
  const commandData = commandPluginData.read(state);
  runtime.logger.nodeStart(
    nodeName,
    `${commandData.commandPlan?.commands.length ?? 0} 条命令`,
  );

  try {
    if (!commandData.commandPlan) {
      throw new Error("缺少命令计划，无法检查风险。");
    }

    const risk = checkCommandRisk(commandData.commandPlan);

    if (risk.blocked) {
      runtime.logger.warn(`命令被拦截：${risk.reasons.join("；")}`);
    }

    runtime.logger.nodeSuccess(nodeName, `风险等级：${risk.level}`);
    runtime.logger.debug("风险检查结果", risk);

    return { pluginData: commandPluginData.update(state, { risk }) };
  } catch (error) {
    runtime.logger.nodeError(nodeName, error);
    return {
      errors: [...state.errors, error instanceof Error ? error.message : String(error)],
      pluginData: commandPluginData.update(state, {
        risk: {
          level: "blocked",
          blocked: true,
          reasons: ["风险检查失败，默认拦截。"],
          safeToExecute: false,
        },
      }),
    };
  }
}

/**
 * 用户确认节点。
 *
 * 对 high 风险命令展示命令、解释和风险原因，只有用户明确输入 y/yes 后
 * 才进入执行节点。
 */
export async function confirmNode(
  state: AgentState,
  runtime: AgentRuntime,
): Promise<Partial<AgentState>> {
  const nodeName = "confirmNode";
  const commandData = commandPluginData.read(state);
  runtime.logger.nodeStart(nodeName, "等待用户确认命令执行");

  if (!commandData.commandPlan || !commandData.risk?.safeToExecute) {
    runtime.logger.nodeSuccess(nodeName, "命令不可执行，跳过确认");
    return { pluginData: commandPluginData.update(state, { userApproved: false }) };
  }

  runtime.logger.info("即将执行以下命令：");
  for (const [index, item] of commandData.commandPlan.commands.entries()) {
    runtime.logger.info(`${index + 1}. ${item.explanation}`);
    runtime.logger.command(item.command);
    if (item.expectedOutput) {
      runtime.logger.debug("预期输出", item.expectedOutput);
    }
  }

  if (commandData.risk.reasons.length > 0) {
    runtime.logger.warn(`风险提示：${commandData.risk.reasons.join("；")}`);
  }

  if (state.autoApprove) {
    runtime.logger.warn("--yes 已开启，将跳过交互确认。");
    runtime.logger.nodeSuccess(nodeName, "用户确认：yes");
    return { pluginData: commandPluginData.update(state, { userApproved: true }) };
  }

  const rl = createInterface({ input, output });
  const answer = await rl.question(
    runtime.logger.userPrompt("确认执行以上命令吗？输入 y/yes 执行："),
  );
  rl.close();

  const userApproved = ["y", "yes"].includes(answer.trim().toLowerCase());
  runtime.logger.nodeSuccess(nodeName, userApproved ? "用户确认：yes" : "用户拒绝执行");

  return { pluginData: commandPluginData.update(state, { userApproved }) };
}

/**
 * 本地命令执行 Agent。
 *
 * 只执行已经通过风险检查的命令。high 风险命令必须已获得用户确认；
 * medium 和 low 风险命令可直接执行。命令按顺序执行，任意一条失败后停止后续
 * 执行，避免在未知状态下继续修改本地环境。
 */
export async function shellExecutorAgent(
  state: AgentState,
  runtime: AgentRuntime,
): Promise<Partial<AgentState>> {
  const nodeName = "shellExecutor";
  const commandData = commandPluginData.read(state);
  runtime.logger.nodeStart(nodeName, state.cwd);

  try {
    if (!commandData.commandPlan) {
      throw new Error("缺少命令计划，无法执行。");
    }

    if (!commandData.risk?.safeToExecute) {
      runtime.logger.nodeSuccess(nodeName, "风险检查未通过，未执行命令");
      return {
        pluginData: commandPluginData.update(state, {
          executionResult: {
            success: false,
            results: [],
          },
        }),
      };
    }

    if (commandData.risk.level === "high" && !commandData.userApproved) {
      runtime.logger.nodeSuccess(nodeName, "high 风险命令未确认，未执行命令");
      return {
        pluginData: commandPluginData.update(state, {
          executionResult: {
            success: false,
            results: [],
          },
        }),
      };
    }

    for (const command of commandData.commandPlan.commands) {
      runtime.logger.command(command.command);
    }

    const executionResult = await executeCommandPlan(
      commandData.commandPlan.commands,
      state.cwd,
    );

    runtime.logger.nodeSuccess(
      nodeName,
      executionResult.success ? "所有命令执行成功" : "命令执行失败或被中断",
    );
    runtime.logger.debug("执行结果", executionResult);

    return { pluginData: commandPluginData.update(state, { executionResult }) };
  } catch (error) {
    runtime.logger.nodeError(nodeName, error);
    return {
      errors: [...state.errors, error instanceof Error ? error.message : String(error)],
      pluginData: commandPluginData.update(state, {
        executionResult: {
          success: false,
          results: [],
        },
      }),
    };
  }
}

/**
 * 执行反馈 Agent。
 *
 * 汇总风险检查、用户确认和命令执行结果，直接给出面向终端的最终解释。命令型
 * 任务默认不写产物文件；如果命令失败，会基于 stdout/stderr 给出可能原因。
 */
export async function feedbackAgent(
  state: AgentState,
  runtime: AgentRuntime,
): Promise<Partial<AgentState>> {
  const nodeName = "feedbackAgent";
  const commandData = commandPluginData.read(state);
  runtime.logger.nodeStart(nodeName, "整理命令执行反馈");

  try {
    if (commandData.risk?.blocked) {
      const finalAnswer = `命令已被安全策略拦截，未执行。\n\n原因：\n${commandData.risk.reasons
        .map((item) => `- ${item}`)
        .join("\n")}`;
      runtime.logger.nodeSuccess(nodeName, "已生成拦截说明");
      return { finalAnswer };
    }

    if (commandData.userApproved === false) {
      const finalAnswer = "用户未确认执行，命令已取消。";
      runtime.logger.nodeSuccess(nodeName, finalAnswer);
      return { finalAnswer };
    }

    if (!commandData.executionResult) {
      const finalAnswer = "命令未执行，未生成执行结果。";
      runtime.logger.nodeSuccess(nodeName, finalAnswer);
      return { finalAnswer };
    }

    if (commandData.executionResult.success) {
      const finalAnswer = "命令执行成功。";
      runtime.logger.nodeSuccess(nodeName, finalAnswer);
      return { finalAnswer };
    }

    const failedResult = commandData.executionResult.results.find(
      (result) => result.exitCode !== 0 || result.timedOut,
    );

    const finalAnswer = failedResult
      ? buildCommandFailureAnswer(failedResult)
      : "命令执行失败，但没有捕获到具体失败命令。";
    runtime.logger.nodeSuccess(nodeName, "已生成失败原因说明");

    return { finalAnswer };
  } catch (error) {
    runtime.logger.nodeError(nodeName, error);
    return {
      errors: [...state.errors, error instanceof Error ? error.message : String(error)],
      finalAnswer: "命令执行反馈生成失败，请查看 verbose 日志中的执行结果。",
    };
  }
}
