/*
 * @Author: wanglinglei
 * @Date: 2026-06-01 00:00:00
 * @Description: 维护本地命令 Agent flow 的私有状态存储。
 * @FilePath: /agents-cli/src/agents/command/pluginData.ts
 * @LastEditTime: 2026-06-01 00:00:00
 */
import { PluginDataStore } from "../../graph/pluginData.js";
import type {
  CommandIntent,
  CommandPlan,
  ExecutionResult,
  RiskAssessment,
} from "../../types.js";

export const COMMAND_ROUTE = "local_command";

/**
 * 本地命令流程的私有状态。
 */
export interface CommandPluginData {
  commandIntent?: CommandIntent;
  commandPlan?: CommandPlan;
  risk?: RiskAssessment;
  userApproved?: boolean;
  executionResult?: ExecutionResult;
}

/**
 * 本地命令流程状态存储。
 *
 * 当前只使用基类读写能力，后续可扩展命令追加、风险状态归并等专用状态方法。
 */
class CommandPluginDataStore extends PluginDataStore<CommandPluginData> {}

export const commandPluginData = new CommandPluginDataStore(COMMAND_ROUTE, {});

