/*
 * @Author: wanglinglei
 * @Date: 2026-05-27 19:16:50
 * @Description: 构建 LangGraph 多 Agent 状态图和初始运行状态。
 * @FilePath: /agents-cli/src/graph/index.ts
 * @LastEditTime: 2026-06-11 00:00:00
 */
import { Annotation, END, START, StateGraph } from "@langchain/langgraph";

import { routerAgent } from "../agents/router/agents.js";
import { unknownAgent } from "../agents/unknown/agents.js";
import {
  agentFlowRegistry,
  isRegisteredRoute,
} from "./agentRegistry.js";
import { GRAPH_END } from "./flowTypes.js";
import { truncateText } from "../text.js";
import type { AgentNode } from "./flowTypes.js";
import type { AgentRuntime, AgentState, CliOptions } from "../types.js";

const AgentStateAnnotation = Annotation.Root({
  input: Annotation<string>(),
  cwd: Annotation<string>(),
  verbose: Annotation<boolean>(),
  autoApprove: Annotation<boolean>(),
  runId: Annotation<string>(),
  route: Annotation<AgentState["route"]>(),
  pluginData: Annotation<Record<string, unknown>>(),
  finalAnswer: Annotation<string | undefined>(),
  artifacts: Annotation<AgentState["artifacts"]>(),
  errors: Annotation<string[]>(),
  events: Annotation<AgentState["events"]>(),
});

type GraphState = typeof AgentStateAnnotation.State;

/**
 * 创建 LangGraph 节点包装器。
 *
 * 业务 Agent 使用项目自己的 AgentRuntime；这里通过闭包把 LLM、配置和 logger 注入
 * 节点，避免每个节点直接依赖 LangGraph 的底层运行时结构。
 */
function bindNode(nodeName: string, node: AgentNode, runtime: AgentRuntime) {
  return async (state: GraphState): Promise<Partial<AgentState>> => {
    const startedAt = Date.now();
    runtime.logger.chainStart(
      "subAgent",
      nodeName,
      `输入: ${truncateText(state.input, 160)}`,
    );

    try {
      const result = await node(state as AgentState, runtime);
      const previousErrorCount = state.errors.length;
      const nextErrors = result.errors ?? state.errors;
      const latestError = nextErrors[nextErrors.length - 1];
      if (nextErrors.length > previousErrorCount && latestError) {
        runtime.logger.chainError(
          "subAgent",
          nodeName,
          latestError,
          Date.now() - startedAt,
        );
      } else {
        runtime.logger.chainSuccess(
          "subAgent",
          nodeName,
          Date.now() - startedAt,
          result.finalAnswer
            ? `输出: ${truncateText(result.finalAnswer, 160)}`
            : undefined,
        );
      }
      return result;
    } catch (error) {
      runtime.logger.chainError(
        "subAgent",
        nodeName,
        error,
        Date.now() - startedAt,
      );
      throw error;
    }
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
  const route = state.route?.route;
  return route && isRegisteredRoute(route) ? route : "unknown";
}

/**
 * 构建多 Agent 状态图。
 *
 * 图中只有一个入口 routerAgent，用户输入的自然语言任务会先被路由，再进入
 * registry 中注册的业务流程。后续新增 Agent 时，应优先注册 flow definition，
 * 而不是新增 CLI 入口或在图中分散硬编码分支。
 */
export function buildAgentGraph(runtime: AgentRuntime) {
  const graph = new StateGraph(AgentStateAnnotation) as any;

  graph.addNode("routerAgent", bindNode("routerAgent", routerAgent, runtime));
  graph.addNode("unknownAgent", bindNode("unknownAgent", unknownAgent, runtime));

  for (const flow of agentFlowRegistry) {
    for (const flowNode of flow.nodes) {
      graph.addNode(flowNode.name, bindNode(flowNode.name, flowNode.node, runtime));
    }
  }

  graph.addEdge(START, "routerAgent");
  graph.addConditionalEdges("routerAgent", routeAfterRouter, {
    ...Object.fromEntries(
      agentFlowRegistry.map((flow) => [flow.route, flow.startNode]),
    ),
    unknown: "unknownAgent",
  });

  for (const flow of agentFlowRegistry) {
    for (const edge of flow.edges) {
      const destination = edge.to === GRAPH_END ? END : edge.to;
      if (edge.stopWhenFinalAnswer && destination !== END) {
        graph.addConditionalEdges(edge.from, continueOrEnd(destination), {
          [destination]: destination,
          [END]: END,
        });
        continue;
      }

      graph.addEdge(edge.from, destination);
    }

    for (const edge of flow.conditionalEdges ?? []) {
      graph.addConditionalEdges(
        edge.from,
        (state: GraphState) => edge.choose(state as AgentState),
        Object.fromEntries(
          Object.entries(edge.targets).map(([key, value]) => [
            key,
            value === GRAPH_END ? END : value,
          ]),
        ),
      );
    }
  }

  graph.addEdge("unknownAgent", END);
  return graph.compile();
}

/**
 * 创建图运行的初始状态。
 *
 * 顶层只初始化公共状态；业务流程私有状态由 pluginData 访问器按 route 管理。
 */
export function createInitialState(input: string, options: CliOptions): AgentState {
  return {
    input,
    cwd: options.cwd,
    verbose: options.verbose,
    autoApprove: options.autoApprove,
    runId: crypto.randomUUID(),
    pluginData: {},
    artifacts: [],
    errors: [],
    events: [],
  };
}
