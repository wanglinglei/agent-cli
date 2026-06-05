/*
 * @Author: wanglinglei
 * @Date: 2026-06-05 17:05:00
 * @Description: 实现天气查询 ReAct Agent 节点。
 * @FilePath: /agents-cli/src/agents/weather/agents.ts
 * @LastEditTime: 2026-06-05 17:05:00
 */
import { runReactToolAgent } from "../../graph/reactToolRunner.js";
import { truncateText } from "../../text.js";
import { buildWeatherReactPrompt } from "./prompts.js";
import { weatherPluginData } from "./pluginData.js";
import { createWeatherTools } from "./tools/weatherTools.js";
import type { AgentRuntime, AgentState } from "../../types.js";

/**
 * 将日期格式化为本地 YYYY-MM-DD 字符串。
 *
 * 输入 Date 对象，输出天气提示词使用的当前本地日期；失败策略是使用运行时 Date
 * 的本地时区结果，不访问网络或外部状态。
 */
function formatLocalDate(date: Date): string {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");

  return `${year}-${month}-${day}`;
}

/**
 * 天气查询 ReAct Agent。
 *
 * 输入用户天气查询任务，调用和风天气城市查询和天气查询工具生成自然语言回答；工具
 * 调用摘要写入本 flow 私有状态，失败时直接终止并返回错误说明。
 */
export async function weatherReactAgent(
  state: AgentState,
  runtime: AgentRuntime,
): Promise<Partial<AgentState>> {
  const nodeName = "weatherReactAgent";
  runtime.logger.nodeStart(nodeName, truncateText(state.input));

  try {
    const result = await runReactToolAgent({
      nodeName,
      prompt: buildWeatherReactPrompt(state.input, formatLocalDate(new Date())),
      state,
      runtime,
      tools: createWeatherTools({ runtime }),
    });

    runtime.logger.nodeSuccess(nodeName, truncateText(result.finalAnswer));
    runtime.logger.debug("ReAct 工具调用摘要", result.toolEvents);

    return {
      pluginData: weatherPluginData.update(state, {
        toolEvents: result.toolEvents,
        finalContent: result.finalAnswer,
      }),
      finalAnswer: result.finalAnswer,
    };
  } catch (error) {
    runtime.logger.nodeError(nodeName, error);
    return {
      errors: [
        ...state.errors,
        error instanceof Error ? error.message : String(error),
      ],
      finalAnswer: "天气查询 Agent 执行失败，未能获取天气数据。",
    };
  }
}
