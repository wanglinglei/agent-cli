/*
 * @Author: wanglinglei
 * @Date: 2026-06-05 17:05:00
 * @Description: 维护天气查询 Agent flow 的私有状态存储。
 * @FilePath: /agents-cli/src/agents/weather/pluginData.ts
 * @LastEditTime: 2026-06-05 17:05:00
 */
import { PluginDataStore } from "../../graph/pluginData.js";
import type { ReactToolEvent } from "../../types.js";

export const WEATHER_ROUTE = "weather_query";

/**
 * 天气查询流程的私有状态。
 */
export interface WeatherPluginData {
  toolEvents: ReactToolEvent[];
  finalContent?: string;
}

/**
 * 天气查询流程状态存储。
 *
 * 当前只保存 ReAct 工具调用摘要和最终回答，避免把完整天气响应长期塞入图状态。
 */
class WeatherPluginDataStore extends PluginDataStore<WeatherPluginData> {}

export const weatherPluginData = new WeatherPluginDataStore(WEATHER_ROUTE, {
  toolEvents: [],
});
