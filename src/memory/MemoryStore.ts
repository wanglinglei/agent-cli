/*
 * @Author: wanglinglei
 * @Date: 2026-05-27 19:16:50
 * @Description: 定义运行状态和记忆事件存储接口。
 * @FilePath: /agents-cli/src/memory/MemoryStore.ts
 * @LastEditTime: 2026-05-27 19:16:50
 */
import type { AgentState, MemoryEvent } from "../types.js";

/**
 * 运行状态与事件存储接口。
 *
 * 第一版只提供内存实现；后续接入长期记忆时，只需要替换该接口实现，不需要改
 * LangGraph 节点的业务代码。
 */
export interface MemoryStore {
  loadRun(runId: string): Promise<AgentState | undefined>;
  saveRun(runId: string, state: AgentState): Promise<void>;
  appendEvent(runId: string, event: MemoryEvent): Promise<void>;
}
