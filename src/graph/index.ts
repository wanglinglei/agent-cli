/*
 * @Author: wanglinglei
 * @Date: 2026-05-27 19:16:50
 * @Description: 构建 LangGraph 多 Agent 状态图和初始运行状态。
 * @FilePath: /agents-cli/src/graph/index.ts
 * @LastEditTime: 2026-05-27 20:05:00
 */
import { Annotation, END, START, StateGraph } from "@langchain/langgraph";

import {
  boundaryIntentAgent,
  boundaryOutputAgent,
  boundaryResolveAgent,
} from "../agents/boundaryAgents.js";
import {
  commandAgent,
  confirmNode,
  feedbackAgent,
  intentAgent,
  riskAgent,
  shellExecutorAgent,
  unknownAgent,
} from "../agents/commandAgents.js";
import { routerAgent } from "../agents/routerAgent.js";
import {
  formatAgent,
  searchAgent,
  summaryAgent,
  writingAgent,
} from "../agents/researchAgents.js";
import type { AgentRuntime, AgentState, CliOptions } from "../types.js";

const AgentStateAnnotation = Annotation.Root({
  input: Annotation<string>(),
  cwd: Annotation<string>(),
  verbose: Annotation<boolean>(),
  autoApprove: Annotation<boolean>(),
  runId: Annotation<string>(),
  route: Annotation<AgentState["route"]>(),
  searchQueries: Annotation<string[]>(),
  searchResults: Annotation<AgentState["searchResults"]>(),
  summary: Annotation<string | undefined>(),
  draft: Annotation<string | undefined>(),
  finalMarkdown: Annotation<string | undefined>(),
  commandIntent: Annotation<AgentState["commandIntent"]>(),
  commandPlan: Annotation<AgentState["commandPlan"]>(),
  boundaryIntent: Annotation<AgentState["boundaryIntent"]>(),
  boundaryResolution: Annotation<AgentState["boundaryResolution"]>(),
  risk: Annotation<AgentState["risk"]>(),
  userApproved: Annotation<boolean | undefined>(),
  executionResult: Annotation<AgentState["executionResult"]>(),
  finalAnswer: Annotation<string | undefined>(),
  artifacts: Annotation<AgentState["artifacts"]>(),
  errors: Annotation<string[]>(),
  events: Annotation<AgentState["events"]>(),
});

type GraphState = typeof AgentStateAnnotation.State;
type AgentNode = (
  state: AgentState,
  runtime: AgentRuntime,
) => Promise<Partial<AgentState>>;

/**
 * 创建 LangGraph 节点包装器。
 *
 * 业务 Agent 使用项目自己的 AgentRuntime；这里通过闭包把 LLM、配置和 logger 注入
 * 节点，避免每个节点直接依赖 LangGraph 的底层运行时结构。
 */
function bindNode(node: AgentNode, runtime: AgentRuntime) {
  return async (state: GraphState): Promise<Partial<AgentState>> => {
    return node(state as AgentState, runtime);
  };
}

/**
 * 在节点失败并已经写入 finalAnswer 时提前结束当前流程。
 */
function continueOrEnd(nextNode: string) {
  return (state: GraphState): string => {
    return state.finalAnswer ? END : nextNode;
  };
}

/**
 * 根据 routerAgent 的判断选择后续 Agent 流程。
 */
function routeAfterRouter(state: GraphState): string {
  if (state.route?.route === "research_write") {
    return "research_write";
  }

  if (state.route?.route === "boundary_svg") {
    return "boundary_svg";
  }

  if (state.route?.route === "local_command") {
    return "local_command";
  }

  return "unknown";
}

/**
 * 风险检查后的条件分支。
 *
 * blocked/high 风险会进入反馈 Agent 生成拦截说明；通过检查的命令进入用户确认节点。
 */
function routeAfterRisk(state: GraphState): string {
  if (state.finalAnswer) {
    return END;
  }

  if (state.risk?.blocked || !state.risk?.safeToExecute) {
    return "feedbackAgent";
  }

  return "confirmNode";
}

/**
 * 用户确认后的条件分支。
 *
 * 只有明确确认时才进入本地命令执行节点，否则直接进入反馈 Agent 说明已取消。
 */
function routeAfterConfirm(state: GraphState): string {
  return state.userApproved ? "shellExecutor" : "feedbackAgent";
}

/**
 * 构建多 Agent 状态图。
 *
 * 图中只有一个入口 routerAgent，用户输入的自然语言任务会先被路由，再进入资料型、
 * 边界 SVG 子流程或命令型子流程。后续新增 Agent 时，应优先扩展路由枚举和
 * 条件分支，而不是新增 CLI 入口。
 */
export function buildAgentGraph(runtime: AgentRuntime) {
  return new StateGraph(AgentStateAnnotation)
    .addNode("routerAgent", bindNode(routerAgent, runtime))
    .addNode("searchAgent", bindNode(searchAgent, runtime))
    .addNode("summaryAgent", bindNode(summaryAgent, runtime))
    .addNode("writingAgent", bindNode(writingAgent, runtime))
    .addNode("formatAgent", bindNode(formatAgent, runtime))
    .addNode("boundaryIntentAgent", bindNode(boundaryIntentAgent, runtime))
    .addNode("boundaryResolveAgent", bindNode(boundaryResolveAgent, runtime))
    .addNode("boundaryOutputAgent", bindNode(boundaryOutputAgent, runtime))
    .addNode("intentAgent", bindNode(intentAgent, runtime))
    .addNode("commandAgent", bindNode(commandAgent, runtime))
    .addNode("riskAgent", bindNode(riskAgent, runtime))
    .addNode("confirmNode", bindNode(confirmNode, runtime))
    .addNode("shellExecutor", bindNode(shellExecutorAgent, runtime))
    .addNode("feedbackAgent", bindNode(feedbackAgent, runtime))
    .addNode("unknownAgent", bindNode(unknownAgent, runtime))
    .addEdge(START, "routerAgent")
    .addConditionalEdges("routerAgent", routeAfterRouter, {
      research_write: "searchAgent",
      boundary_svg: "boundaryIntentAgent",
      local_command: "intentAgent",
      unknown: "unknownAgent",
    })
    .addConditionalEdges("searchAgent", continueOrEnd("summaryAgent"), {
      summaryAgent: "summaryAgent",
      [END]: END,
    })
    .addConditionalEdges("summaryAgent", continueOrEnd("writingAgent"), {
      writingAgent: "writingAgent",
      [END]: END,
    })
    .addConditionalEdges("writingAgent", continueOrEnd("formatAgent"), {
      formatAgent: "formatAgent",
      [END]: END,
    })
    .addEdge("formatAgent", END)
    .addConditionalEdges("boundaryIntentAgent", continueOrEnd("boundaryResolveAgent"), {
      boundaryResolveAgent: "boundaryResolveAgent",
      [END]: END,
    })
    .addConditionalEdges("boundaryResolveAgent", continueOrEnd("boundaryOutputAgent"), {
      boundaryOutputAgent: "boundaryOutputAgent",
      [END]: END,
    })
    .addEdge("boundaryOutputAgent", END)
    .addConditionalEdges("intentAgent", continueOrEnd("commandAgent"), {
      commandAgent: "commandAgent",
      [END]: END,
    })
    .addConditionalEdges("commandAgent", continueOrEnd("riskAgent"), {
      riskAgent: "riskAgent",
      [END]: END,
    })
    .addConditionalEdges("riskAgent", routeAfterRisk, {
      confirmNode: "confirmNode",
      feedbackAgent: "feedbackAgent",
      [END]: END,
    })
    .addConditionalEdges("confirmNode", routeAfterConfirm, {
      shellExecutor: "shellExecutor",
      feedbackAgent: "feedbackAgent",
    })
    .addEdge("shellExecutor", "feedbackAgent")
    .addEdge("feedbackAgent", END)
    .addEdge("unknownAgent", END)
    .compile();
}

/**
 * 创建图运行的初始状态。
 *
 * 所有数组字段在入口初始化，避免后续节点读取未定义状态；可选字段由对应 Agent
 * 在执行过程中写入。
 */
export function createInitialState(input: string, options: CliOptions): AgentState {
  return {
    input,
    cwd: options.cwd,
    verbose: options.verbose,
    autoApprove: options.autoApprove,
    runId: crypto.randomUUID(),
    searchQueries: [],
    searchResults: [],
    artifacts: [],
    errors: [],
    events: [],
  };
}
