/*
 * @Author: wanglinglei
 * @Date: 2026-06-01 00:00:00
 * @Description: 提供 Agent 私有状态 pluginData 的公共存储基类。
 * @FilePath: /agents-cli/src/graph/pluginData.ts
 * @LastEditTime: 2026-06-01 00:00:00
 */
import type { AgentState } from "../types.js";

/**
 * 判断输入是否是可合并的普通对象。
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * 读取指定 route 下的插件私有状态，并合并默认值。
 */
export class PluginDataStore<TData extends object> {
  constructor(
    public readonly route: string,
    private readonly defaults: TData,
  ) {}

  /**
   * 读取当前 flow 的私有状态，并合并默认值。
   */
  read(state: AgentState): TData {
    const current = state.pluginData[this.route];
    return {
      ...this.defaults,
      ...(isRecord(current) ? current : {}),
    } as TData;
  }

  /**
   * 不可变更新当前 flow 的私有状态。
   */
  update(state: AgentState, patch: Partial<TData>): Record<string, unknown> {
    return {
      ...state.pluginData,
      [this.route]: {
        ...this.read(state),
        ...patch,
      },
    };
  }
}
