/*
 * @Author: wanglinglei
 * @Date: 2026-05-27 19:16:50
 * @Description: 提供 LLM JSON 调用、修复和文本响应解析工具。
 * @FilePath: /agents-cli/src/json.ts
 * @LastEditTime: 2026-05-27 19:16:50
 */
import type { ChatOpenAI } from "@langchain/openai";
import { z } from "zod";

import { buildJsonRepairPrompt } from "./prompts/jsonRepairPrompts.js";

/**
 * 将 LangChain 消息内容安全转成字符串。
 */
export function messageContentToString(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (typeof item === "string") {
          return item;
        }

        if (
          item &&
          typeof item === "object" &&
          "text" in item &&
          typeof item.text === "string"
        ) {
          return item.text;
        }

        return JSON.stringify(item);
      })
      .join("\n");
  }

  return String(content ?? "");
}

/**
 * 从模型输出中提取 JSON 对象。
 *
 * 模型有时会在 JSON 前后添加说明文本，这里只截取第一个 `{` 到最后一个 `}` 的内容。
 */
export function extractJsonObject(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");

  if (start === -1 || end === -1 || end <= start) {
    throw new Error("模型输出中没有找到 JSON 对象。");
  }

  return JSON.parse(text.slice(start, end + 1));
}

/**
 * 调用 LLM 并解析结构化 JSON，失败后会让模型修复一次。
 *
 * 该函数用于所有需要稳定结构化输出的 Agent，避免每个节点重复写 JSON 修复逻辑。
 */
export async function invokeJson<T>(
  llm: ChatOpenAI,
  prompt: string,
  schema: z.ZodType<T>,
): Promise<T> {
  const first = await llm.invoke(prompt);
  const firstText = messageContentToString(first.content);

  try {
    return schema.parse(extractJsonObject(firstText));
  } catch (firstError) {
    const repair = await llm.invoke(
      buildJsonRepairPrompt(
        firstText,
        firstError instanceof Error ? firstError.message : String(firstError),
      ),
    );
    const repairText = messageContentToString(repair.content);
    return schema.parse(extractJsonObject(repairText));
  }
}

/**
 * 调用 LLM 并返回纯文本。
 */
export async function invokeText(llm: ChatOpenAI, prompt: string): Promise<string> {
  const result = await llm.invoke(prompt);
  return messageContentToString(result.content).trim();
}
