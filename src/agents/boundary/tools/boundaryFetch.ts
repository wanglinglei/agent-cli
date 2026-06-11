/*
 * @Author: wanglinglei
 * @Date: 2026-05-27 20:05:00
 * @Description: 根据行政区划编码下载边界 GeoJSON 数据。
 * @FilePath: /agents-cli/src/agents/boundary/tools/boundaryFetch.ts
 * @LastEditTime: 2026-06-11 00:00:00
 */
import { fetchBoundaryJson } from "./boundaryHttpClient.js";

const FIXED_YEAR = 2023 as const;
const RUIDUOBAO_HOST = "https://map.ruiduobao.com";

interface BoundaryIndexResponse {
  filepath?: string;
}

/**
 * 规范化城市编码并限制为 6 位行政区划码。
 *
 * 输入原始编码，输出稳定编码字符串；格式不合法时直接抛错并停止流程。
 */
function normalizeCityCode(rawCityCode: string): string {
  const cityCode = rawCityCode.trim();
  if (!/^\d{6,12}$/.test(cityCode)) {
    throw new Error("cityCode 格式无效，应为 6-12 位数字。");
  }

  return cityCode.slice(0, 6);
}

/**
 * 根据城市编码下载瑞多宝边界数据。
 *
 * 输入城市编码，输出 GeoJSON 对象；当远端接口不可用或返回无效结构时抛错。
 */
export async function fetchBoundaryDataByCityCode(
  rawCityCode: string,
): Promise<Record<string, unknown>> {
  const cityCode = normalizeCityCode(rawCityCode);
  const indexUrl = `${RUIDUOBAO_HOST}/getgsondb?code=${cityCode}&year=${FIXED_YEAR}`;
  const indexData = await fetchBoundaryJson<BoundaryIndexResponse>(indexUrl);
  const filepath = indexData.filepath?.trim();
  if (!filepath) {
    throw new Error("边界接口返回缺少 filepath，无法下载几何数据。");
  }

  const geometryUrl = filepath.startsWith("http")
    ? filepath
    : filepath.startsWith("//")
      ? `https:${filepath}`
    : `${RUIDUOBAO_HOST}${filepath.startsWith("/") ? "" : "/"}${filepath}`;
  return fetchBoundaryJson<Record<string, unknown>>(geometryUrl);
}
