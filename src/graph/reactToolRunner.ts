/*
 * @Author: wanglinglei
 * @Date: 2026-06-04 00:00:00
 * @Description: 封装 LangGraph ReAct 工具调用子图执行逻辑。
 * @FilePath: /agents-cli/src/graph/reactToolRunner.ts
 * @LastEditTime: 2026-06-04 00:00:00
 */
import { createAgent } from "langchain";
import type { StructuredToolInterface } from "@langchain/core/tools";

import { messageContentToString } from "../json.js";
import { truncateText } from "../text.js";
import type { AgentRuntime, AgentState, ReactToolEvent } from "../types.js";

/**
 * ReAct 子图执行入参。
 */
export interface ReactToolRunnerInput {
  nodeName: string;
  prompt: string;
  state: AgentState;
  runtime: AgentRuntime;
  tools: StructuredToolInterface[];
}

/**
 * ReAct 子图执行结果。
 */
export interface ReactToolRunnerResult {
  finalAnswer: string;
  toolEvents: ReactToolEvent[];
}

/**
 * 判断消息是否是 LangChain 工具响应消息。
 *
 * 输入 LangChain 返回的任意消息对象，输出是否应作为工具调用摘要记录；失败策略是
 * 返回 false，由最终回答兜底。
 */
function isToolMessage(message: unknown): boolean {
  if (!message || typeof message !== "object") {
    return false;
  }

  const typed = message as { _getType?: () => string; type?: string };
  return typed.type === "tool" || typed._getType?.() === "tool";
}

/**
 * 提取工具消息里的工具名。
 *
 * 输入工具响应消息，输出稳定展示名；缺失时返回 unknown_tool，避免日志中断。
 */
function getToolMessageName(message: unknown): string {
  if (!message || typeof message !== "object") {
    return "unknown_tool";
  }

  const typed = message as {
    name?: string;
    tool_call_id?: string;
    lc_kwargs?: { name?: string; tool_call_id?: string };
  };

  return (
    typed.name ??
    typed.lc_kwargs?.name ??
    typed.tool_call_id ??
    typed.lc_kwargs?.tool_call_id ??
    "unknown_tool"
  );
}

/**
 * 从 ReAct 子图消息中提取最终文本回答。
 *
 * 输入消息列表，输出最后一条非工具消息内容；如果没有有效文本，则返回保守兜底说明。
 */
function extractFinalAnswer(messages: unknown[]): string {
  for (const message of [...messages].reverse()) {
    if (isToolMessage(message)) {
      continue;
    }

    if (message && typeof message === "object" && "content" in message) {
      const content = messageContentToString((message as { content: unknown }).content);
      if (content.trim()) {
        return content.trim();
      }
    }
  }

  return "ReAct Agent 已结束，但没有生成最终说明。";
}

/**
 * 将工具消息转换为图状态可保存的短事件。
 *
 * 输入完整消息列表，输出工具调用摘要；长输出会被截断，避免污染状态。
 */
function extractToolEvents(messages: unknown[]): ReactToolEvent[] {
  return messages.filter(isToolMessage).map((message) => ({
    toolName: getToolMessageName(message),
    summary:
      message && typeof message === "object" && "content" in message
        ? truncateText(
            messageContentToString((message as { content: unknown }).content),
            800,
          )
        : "",
  }));
}

/**
 * 执行一个 LangGraph ReAct 工具调用子图。
 *
 * 输入项目运行时、flow 专属系统提示词和 LangChain Tool 列表，输出最终回答和工具
 * 调用摘要；当模型或兼容接口不支持 tool calling 时，会抛出明确错误给上层节点处理。
 */
export async function runReactToolAgent(
  input: ReactToolRunnerInput,
): Promise<ReactToolRunnerResult> {
  const agent = createAgent({
    model: input.runtime.llm,
    tools: input.tools,
    systemPrompt: input.prompt,
  });

  try {
    const result = await agent.invoke(
      {
        messages: [
          { role: "user", content: input.state.input },
        ],
      },
      { recursionLimit: 20 },
    );
    const messages = Array.isArray(result.messages) ? result.messages : [];

    return {
      finalAnswer: extractFinalAnswer(messages),
      toolEvents: extractToolEvents(messages),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/bindTools|tool_calls|tool calling|tools/i.test(message)) {
      throw new Error(
        `当前模型或兼容接口不支持 LangChain tool calling：${message}`,
      );
    }

    throw error;
  }
}
