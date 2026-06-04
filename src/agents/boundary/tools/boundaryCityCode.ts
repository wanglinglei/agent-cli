/*
 * @Author: wanglinglei
 * @Date: 2026-05-27 20:05:00
 * @Description: 解析行政区划名称并通过 Tavily 搜索城市编码。
 * @FilePath: /agents-cli/src/agents/boundary/tools/boundaryCityCode.ts
 * @LastEditTime: 2026-05-27 20:05:00
 */
import { requireTavilyApiKey } from "../../../config.js";
import type { AppConfig, BoundaryCityResolution } from "../../../types.js";

const POSTAL_CODE_KEYWORDS = /(邮编|邮政编码|postcode|zip\s*code)/i;
const ADMIN_CODE_KEYWORDS =
  /(行政区划(?:代码|编码)?|区划代码|adcode|统计用区划代码)/i;

/**
 * 判断编码是否符合常见行政区划码格式。
 *
 * 输入候选编码，输出布尔判断；失败时不抛错，由上层决定是否继续解析。
 */
function isValidCityCode(code: string): boolean {
  return /^\d{6,12}$/.test(code);
}

/**
 * 规范化城市名称，移除结尾语气词。
 *
 * 输入原始城市名，输出可用于搜索的稳定名称；空字符串会在上层被拦截。
 */
function normalizeCityName(cityName: string): string {
  return cityName.trim().replace(/[的地得]+$/g, "");
}

/**
 * 提取文本中“行政区划代码”上下文里的候选编码。
 *
 * 输入搜索结果文本，输出高置信候选编码数组；仅做提取，不做最终排序。
 */
function extractAdminContextCodes(text: string): string[] {
  const results = new Set<string>();
  const prefixedPattern =
    /(?:行政区划(?:代码|编码)?|区划代码|adcode|统计用区划代码)\D{0,10}(\d{6,12})/gi;
  const suffixedPattern =
    /(\d{6,12})\D{0,10}(?:行政区划(?:代码|编码)?|区划代码|adcode|统计用区划代码)/gi;

  for (const match of text.matchAll(prefixedPattern)) {
    if (match[1] && isValidCityCode(match[1])) {
      results.add(match[1]);
    }
  }

  for (const match of text.matchAll(suffixedPattern)) {
    if (match[1] && isValidCityCode(match[1])) {
      results.add(match[1]);
    }
  }

  return [...results];
}

/**
 * 判断某个编码上下文是否更像邮编而不是行政区划码。
 *
 * 输入原始文本和编码位置，输出是否应被过滤；失败策略是保守不过滤。
 */
function isPostalCodeContext(text: string, index: number, codeLength: number): boolean {
  const start = Math.max(0, index - 14);
  const end = Math.min(text.length, index + codeLength + 14);
  const context = text.slice(start, end);
  return POSTAL_CODE_KEYWORDS.test(context) && !ADMIN_CODE_KEYWORDS.test(context);
}

/**
 * 从搜索文本中提取所有数字编码候选。
 *
 * 输入长文本，输出去重后的编码列表；会过滤明显的邮编语境，降低误判。
 */
function extractCodesFromText(text: string): string[] {
  const matchedCodes = [...text.matchAll(/\b(\d{6,12})\b/g)];
  const filteredCodes = matchedCodes
    .filter((item) => {
      const code = item[1];
      const index = item.index ?? 0;
      return isValidCityCode(code) && !isPostalCodeContext(text, index, code.length);
    })
    .map((item) => item[1]);

  return [...new Set(filteredCodes)];
}

/**
 * 从候选编码中选择最可信的行政区划码。
 *
 * 输入候选数组，优先输出 6 位编码；没有 6 位时回退到第一个候选。
 */
function pickBestCityCode(codes: string[]): string | undefined {
  const sixDigits = codes.find((code) => code.length === 6);
  return sixDigits ?? codes[0];
}

/**
 * 通过 Tavily 搜索城市行政区划编码。
 *
 * 输入城市名和运行配置，输出结构化 cityCode；当 Tavily 不可用或未搜到编码时抛错。
 */
export async function searchCityCode(
  config: AppConfig,
  cityName: string,
): Promise<BoundaryCityResolution> {
  const normalizedCityName = normalizeCityName(cityName);
  if (!normalizedCityName) {
    throw new Error("cityName 不能为空，无法搜索行政区划编码。");
  }

  const apiKey = requireTavilyApiKey(config);
  const response = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      api_key: apiKey,
      include_answer: true,
      max_results: 3,
      query: `${normalizedCityName} 行政区划代码`,
      search_depth: "advanced",
    }),
  });

  if (!response.ok) {
    throw new Error(`Tavily 搜索请求失败：${response.status}`);
  }

  const payload = (await response.json()) as {
    answer?: string;
    results?: Array<{ content?: string; title?: string }>;
  };

  const chunks: string[] = [];
  if (typeof payload.answer === "string") {
    chunks.push(payload.answer);
  }

  for (const item of payload.results ?? []) {
    if (item.title) {
      chunks.push(item.title);
    }
    if (item.content) {
      chunks.push(item.content);
    }
  }

  const searchText = chunks.join("\n");
  const adminContextCodes = extractAdminContextCodes(searchText);
  const fallbackCodes = extractCodesFromText(searchText);
  const codes =
    adminContextCodes.length > 0
      ? [...new Set([...adminContextCodes, ...fallbackCodes])]
      : fallbackCodes;
  const cityCode = pickBestCityCode(codes);

  if (!cityCode) {
    throw new Error(`未从网络搜索结果中识别到 ${normalizedCityName} 的行政区划编码。`);
  }

  return {
    cityCode,
    cityName: normalizedCityName,
    source: "tavily",
  };
}
