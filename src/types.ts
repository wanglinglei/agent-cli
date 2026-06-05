/*
 * @Author: wanglinglei
 * @Date: 2026-05-27 19:16:50
 * @Description: 定义多 Agent CLI 的共享类型和状态结构。
 * @FilePath: /agents-cli/src/types.ts
 * @LastEditTime: 2026-06-05 16:20:00
 */
import type { ChatOpenAI } from "@langchain/openai";

import type { Logger } from "./logger.js";

/**
 * 顶层任务路由类型。
 *
 * 具体业务 route 由 Agent flow registry 注册；unknown 是路由失败或低置信度兜底。
 */
export type RouteType = string;

/**
 * 命令风险等级。
 *
 * blocked 表示命令包含禁止执行的危险操作；high 表示必须人工确认后执行；
 * medium 和 low 表示通过风险检查后可直接执行。
 */
export type RiskLevel = "low" | "medium" | "high" | "blocked";

/**
 * CLI 运行配置。
 */
export interface CliOptions {
  verbose: boolean;
  autoApprove: boolean;
  cwd: string;
  outputDir: string;
}

/**
 * 应用级环境配置。
 */
export interface AppConfig {
  dashscopeApiKey: string;
  tavilyApiKey?: string;
  llmBaseUrl: string;
  llmModel: string;
}

/**
 * routerAgent 的结构化判断结果。
 */
export interface RouteDecision {
  route: RouteType;
  reason: string;
  confidence: number;
}

/**
 * Tavily 搜索结果的统一结构。
 */
export interface SearchResult {
  query: string;
  title: string;
  url: string;
  content: string;
  rawContent?: string;
  score?: number;
}

/**
 * 当前时间工具入参。
 *
 * timeZone 使用 IANA 时区名；未传入时由运行机器的系统时区决定。
 */
export interface CurrentTimeInput {
  timeZone?: string;
}

/**
 * 当前时间工具返回结果。
 *
 * 同时提供 UTC、Unix 时间戳和目标时区格式化时间，方便 Agent 在相对日期、
 * 今天、当前时间等任务中使用准确运行时信息。
 */
export interface CurrentTimeResult {
  isoUtc: string;
  epochMs: number;
  unixSeconds: number;
  timeZone: string;
  utcOffset: string;
  localizedTime: string;
}

/**
 * 单条待执行命令。
 */
export interface GeneratedCommand {
  command: string;
  explanation: string;
  expectedOutput?: string;
}

/**
 * 命令生成 Agent 的输出计划。
 */
export interface CommandPlan {
  goal: string;
  commands: GeneratedCommand[];
  requiresScript: boolean;
  notes: string[];
}

/**
 * 边界 SVG 样式配置。
 */
export interface BoundarySvgStyle {
  fillColor: string;
  strokeColor: string;
  strokeWidth: number;
}

/**
 * 城市编码解析结果。
 */
export interface BoundaryCityResolution {
  cityCode: string;
  cityName?: string;
  source: "explicit_input" | "tavily";
}

/**
 * 风险检查结果。
 */
export interface RiskAssessment {
  level: RiskLevel;
  blocked: boolean;
  reasons: string[];
  safeToExecute: boolean;
}

/**
 * 单条命令的执行结果。
 */
export interface SingleCommandResult {
  command: string;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  durationMs: number;
  timedOut: boolean;
}

/**
 * 多条命令顺序执行后的聚合结果。
 */
export interface ExecutionResult {
  success: boolean;
  results: SingleCommandResult[];
}

/**
 * 预留的记忆事件结构。
 *
 * 第一版只保存在内存中，后续可以直接落到 JSON、SQLite 或向量库。
 */
export interface MemoryEvent {
  runId: string;
  type: string;
  message: string;
  createdAt: string;
  payload?: unknown;
}

/**
 * Agent 生成的文件产物记录。
 */
export interface AgentArtifact {
  agentName: string;
  label: string;
  filePath: string;
  createdAt: string;
}

/**
 * ReAct 工具调用事件摘要。
 *
 * 只保存工具名和截断后的结果摘要，避免把完整工具输出或长日志塞入图状态。
 */
export interface ReactToolEvent {
  toolName: string;
  summary: string;
}

/**
 * LangGraph 共享状态。
 *
 * 顶层只保存跨流程公共数据；业务流程私有中间态统一存入 pluginData，
 * 便于新增 Agent 时不再扩展全局状态结构。
 */
export interface AgentState {
  input: string;
  cwd: string;
  verbose: boolean;
  autoApprove: boolean;
  runId: string;
  route?: RouteDecision;
  pluginData: Record<string, unknown>;
  finalAnswer?: string;
  artifacts: AgentArtifact[];
  errors: string[];
  events: MemoryEvent[];
}

/**
 * Agent 节点运行时上下文。
 */
export interface AgentRuntime {
  config: AppConfig;
  verbose: boolean;
  llm: ChatOpenAI;
  logger: Logger;
  outputDir: string;
}
