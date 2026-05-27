/*
 * @Author: wanglinglei
 * @Date: 2026-05-27 19:16:50
 * @Description: 提供内存版运行状态和记忆事件存储实现。
 * @FilePath: /agents-cli/src/memory/InMemoryMemoryStore.ts
 * @LastEditTime: 2026-05-27 19:16:50
 */
import type { AgentState, MemoryEvent } from "../types.js";
import type { MemoryStore } from "./MemoryStore.js";

/**
 * 内存版运行状态存储。
 *
 * 适合第一版 CLI 单次运行；进程结束后数据会丢失，但接口已经为 JSON、SQLite、
 * 向量库或 LangGraph checkpointer 预留。
 */
export class InMemoryMemoryStore implements MemoryStore {
  private readonly runs = new Map<string, AgentState>();
  private readonly events = new Map<string, MemoryEvent[]>();

  async loadRun(runId: string): Promise<AgentState | undefined> {
    return this.runs.get(runId);
  }

  async saveRun(runId: string, state: AgentState): Promise<void> {
    this.runs.set(runId, state);
  }

  async appendEvent(runId: string, event: MemoryEvent): Promise<void> {
    const current = this.events.get(runId) ?? [];
    current.push(event);
    this.events.set(runId, current);
  }
}
