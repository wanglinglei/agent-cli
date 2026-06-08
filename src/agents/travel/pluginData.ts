/*
 * @Author: wanglinglei
 * @Date: 2026-06-05 18:20:00
 * @Description: 维护旅行规划 Agent flow 的私有状态存储。
 * @FilePath: /agents-cli/src/agents/travel/pluginData.ts
 * @LastEditTime: 2026-06-05 18:20:00
 */
import { PluginDataStore } from "../../graph/pluginData.js";
import type { ReactToolEvent } from "../../types.js";

export const TRAVEL_ROUTE = "travel_plan";

/**
 * 旅行规划流程的私有状态。
 */
export interface TravelPluginData {
  toolEvents: ReactToolEvent[];
  finalContent?: string;
}

/**
 * 旅行规划流程状态存储。
 *
 * 当前只保存 ReAct 工具调用摘要和最终回答，避免把完整 POI、路线和天气数据写入
 * 图状态。
 */
class TravelPluginDataStore extends PluginDataStore<TravelPluginData> {}

export const travelPluginData = new TravelPluginDataStore(TRAVEL_ROUTE, {
  toolEvents: [],
});
