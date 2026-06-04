/*
 * @Author: wanglinglei
 * @Date: 2026-06-01 00:00:00
 * @Description: 维护行政边界 Agent flow 的私有状态存储。
 * @FilePath: /agents-cli/src/agents/boundary/pluginData.ts
 * @LastEditTime: 2026-06-01 00:00:00
 */
import { PluginDataStore } from "../../graph/pluginData.js";
import type {
  BoundaryCityResolution,
  BoundaryIntent,
  ReactToolEvent,
} from "../../types.js";

export const BOUNDARY_ROUTE = "boundary_svg";

/**
 * 行政边界流程的私有状态。
 */
export interface BoundaryPluginData {
  boundaryIntent?: BoundaryIntent;
  boundaryResolution?: BoundaryCityResolution;
  toolEvents: ReactToolEvent[];
  finalContent?: string;
}

/**
 * 行政边界流程状态存储。
 *
 * 当前只使用基类读写能力，后续可扩展样式合并、城市上下文等专用状态方法。
 */
class BoundaryPluginDataStore extends PluginDataStore<BoundaryPluginData> {}

export const boundaryPluginData = new BoundaryPluginDataStore(BOUNDARY_ROUTE, {
  toolEvents: [],
});
