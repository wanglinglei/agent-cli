/*
 * @Author: wanglinglei
 * @Date: 2026-05-27 19:16:50
 * @Description: 定义多 Agent CLI 的共享类型和状态结构。
 * @FilePath: /agents-cli/src/types.ts
 * @LastEditTime: 2026-05-28 10:50:05
 */
import type { ChatOpenAI } from "@langchain/openai";

import type { Logger } from "./logger.js";

/**
 * 顶层任务路由类型。
 *
 * - research_write：需要联网搜索、总结、写作和 Markdown 格式化。
 * - local_command：需要把自然语言转换为 Shell/Git/脚本命令。
 * - boundary_svg：需要解析行政区划边界并输出 SVG 或 GeoJSON 文件。
 * - unknown：任务目标不明确，系统不会继续执行危险动作。
 */
export type RouteType =
  | "research_write"
  | "local_command"
  | "boundary_svg"
  | "unknown";

/**
 * 命令风险等级。
 *
 * blocked 表示命令包含禁止执行的危险操作；high 表示必须人工确认后执行；
 * medium 和 low 表示通过风险检查后可直接执行。
 */
export type RiskLevel = "low" | "medium" | "high" | "blocked";

/**
 * 本地命令任务类别，用于给命令生成 Agent 更明确的上下文。
 */
export type CommandType = "shell" | "git" | "script" | "mixed";

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
 * 命令意图解析结果。
 */
export interface CommandIntent {
  goal: string;
  commandType: CommandType;
  target: string;
  cwd: string;
  constraints: string[];
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
 * 边界任务动作类型。
 */
export type BoundaryAction = "generate_boundary" | "update_svg_style";

/**
 * 边界 SVG 意图解析结果。
 *
 * 该结构只保留单次 CLI 运行所需的最小字段，不维护服务端会话上下文。
 */
export interface BoundaryIntent {
  action: BoundaryAction;
  cityCode?: string;
  cityName?: string;
  needSvg: boolean;
  year: 2023;
  stylePatch?: Partial<BoundarySvgStyle>;
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
 * LangGraph 共享状态。
 *
 * 所有 Agent 通过读写该状态传递信息，便于后续接入 checkpointer 或长期记忆。
 */
export interface AgentState {
  input: string;
  cwd: string;
  verbose: boolean;
  autoApprove: boolean;
  runId: string;
  route?: RouteDecision;
  searchQueries: string[];
  searchResults: SearchResult[];
  summary?: string;
  draft?: string;
  finalMarkdown?: string;
  commandIntent?: CommandIntent;
  commandPlan?: CommandPlan;
  boundaryIntent?: BoundaryIntent;
  boundaryResolution?: BoundaryCityResolution;
  risk?: RiskAssessment;
  userApproved?: boolean;
  executionResult?: ExecutionResult;
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
