/*
 * @Author: wanglinglei
 * @Date: 2026-05-27 19:16:50
 * @Description: 管理最终 Agent 产物的文件写入和路径展示。
 * @FilePath: /agents-cli/src/artifacts.ts
 * @LastEditTime: 2026-05-27 20:05:00
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import type { AgentArtifact, AgentRuntime, AgentState } from "./types.js";

type ArtifactExtension = "geojson" | "json" | "md" | "svg" | "txt" | "sh";

interface WriteArtifactOptions {
  agentName: string;
  label: string;
  extension: ArtifactExtension;
  content: unknown;
}

/**
 * 清理文件名片段，避免模型生成内容影响本地路径。
 */
function sanitizePathSegment(value: string): string {
  return value
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

/**
 * 将产物内容转换为最终写入文件的字符串。
 */
function stringifyArtifactContent(content: unknown, extension: ArtifactExtension): string {
  if (extension === "json" || extension === "geojson") {
    return `${JSON.stringify(content, null, 2)}\n`;
  }

  return typeof content === "string" ? content : `${JSON.stringify(content, null, 2)}\n`;
}

/**
 * 写入某个 Agent 的文件产物。
 *
 * 产物统一放到 output/<agentName>/ 下，文件名包含 runId，便于一次运行的多个
 * Agent 产物相互关联，也便于后续扩展长期记忆或审计。
 */
export async function writeAgentArtifact(
  state: AgentState,
  runtime: AgentRuntime,
  options: WriteArtifactOptions,
): Promise<AgentArtifact> {
  const agentDir = path.join(
    runtime.outputDir,
    sanitizePathSegment(options.agentName),
  );
  await mkdir(agentDir, { recursive: true });

  const fileName = `${sanitizePathSegment(state.runId)}-${sanitizePathSegment(
    options.label,
  )}.${options.extension}`;
  const filePath = path.join(agentDir, fileName);
  await writeFile(
    filePath,
    stringifyArtifactContent(options.content, options.extension),
    "utf8",
  );

  const artifact: AgentArtifact = {
    agentName: options.agentName,
    label: options.label,
    filePath,
    createdAt: new Date().toISOString(),
  };

  runtime.logger.info(
    `${options.agentName} 产物已写入：${formatArtifactPath(state.cwd, artifact.filePath)}`,
  );

  return artifact;
}

/**
 * 追加新的产物记录到图状态。
 */
export function appendArtifact(
  state: AgentState,
  artifact: AgentArtifact,
): AgentArtifact[] {
  return [...state.artifacts, artifact];
}

/**
 * 将绝对路径转换成相对工作目录的展示路径。
 */
export function formatArtifactPath(cwd: string, filePath: string): string {
  const relative = path.relative(cwd, filePath);
  return relative.startsWith("..") ? filePath : relative;
}
