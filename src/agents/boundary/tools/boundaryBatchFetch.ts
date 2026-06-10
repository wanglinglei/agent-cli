/*
 * @Author: wanglinglei
 * @Date: 2026-06-10 00:00:00
 * @Description: 根据行政区划编码批量下载并读取含下级区域的边界 GeoJSON 数据。
 * @FilePath: /agents-cli/src/agents/boundary/tools/boundaryBatchFetch.ts
 * @LastEditTime: 2026-06-10 00:00:00
 */
import AdmZip from "adm-zip";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join, relative } from "node:path";

const FIXED_YEAR = 2023 as const;
const RUIDUOBAO_HOST = "https://map.ruiduobao.com";

/**
 * 行政级别。
 */
export type BoundaryAdminLevel = "city" | "county";

/**
 * 批量边界下载结果。
 */
export interface BoundaryBatchFetchResult {
  boundaryData: Record<string, unknown>;
  cityCode: string;
  source: "ruiduobao_batch";
  year: 2023;
  adminLevel: BoundaryAdminLevel;
  selectedDirectory: string;
  selectedFileCount: number;
}

interface BoundaryDownloadResult {
  fileBuffer: Buffer;
  fileName: string;
}

/**
 * 基于 6 位行政区划编码判断应下载的下级边界类型。
 *
 * 输入 6 位城市或区县编码，输出批量接口需要的行政级别；以 00 结尾的编码按城市
 * 处理并下载县区边界，否则按区县处理并下载乡镇边界。
 */
function resolveAdminLevel(cityCode: string): BoundaryAdminLevel {
  return cityCode.endsWith("00") ? "city" : "county";
}

/**
 * 规范化城市编码。
 *
 * 输入原始编码，输出 6 位行政区划编码；格式不合法时抛错并停止下载流程。
 */
function normalizeCityCode(rawCityCode: string): string {
  const cityCode = rawCityCode.trim();
  if (!/^\d{6,12}$/.test(cityCode)) {
    throw new Error("cityCode 格式无效，应为 6-12 位数字。");
  }

  return cityCode.slice(0, 6);
}

/**
 * 下载瑞多宝含下级区域边界压缩包。
 *
 * 输入 6 位编码和行政级别，输出 zip 文件内容；接口异常或返回空文件时抛错。
 */
async function downloadBoundaryBatchZip(
  cityCode: string,
  adminLevel: BoundaryAdminLevel,
): Promise<BoundaryDownloadResult> {
  const requestPath =
    adminLevel === "city"
      ? `/downloadCityBatch/city/${cityCode}`
      : `/downloadCountyBatch/county/${cityCode}`;
  const requestUrl = `${RUIDUOBAO_HOST}${requestPath}?format=shp&year=${FIXED_YEAR}`;
  const response = await fetch(requestUrl, {
    headers: {
      Referer: `${RUIDUOBAO_HOST}/`,
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 13_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    },
    redirect: "follow",
  });

  if (!response.ok) {
    throw new Error(`批量边界下载失败：${response.status}`);
  }

  const fileBuffer = Buffer.from(await response.arrayBuffer());
  if (!fileBuffer.length) {
    throw new Error("批量边界下载返回空文件。");
  }

  return {
    fileBuffer,
    fileName: `${cityCode}_含下级.zip`,
  };
}

/**
 * 递归收集目录。
 *
 * 输入根目录，输出包含根目录在内的所有子目录绝对路径。
 */
async function collectDirectories(rootDir: string): Promise<string[]> {
  const result: string[] = [rootDir];
  const stack: string[] = [rootDir];

  while (stack.length) {
    const currentDir = stack.pop();
    if (!currentDir) {
      continue;
    }

    const entries = await readdir(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }

      const fullPath = join(currentDir, entry.name);
      result.push(fullPath);
      stack.push(fullPath);
    }
  }

  return result;
}

/**
 * 从解压目录中选择目标下级边界目录。
 *
 * 输入解压根目录和行政级别，输出县区或乡镇层级目录；未找到时抛错，避免静默
 * 回退成只有外轮廓的 SVG。
 */
async function selectTargetDirectory(
  rootDir: string,
  adminLevel: BoundaryAdminLevel,
): Promise<string> {
  const directoryList = await collectDirectories(rootDir);
  const normalizedWithPath = directoryList.map((dirPath) => ({
    dirPath,
    normalized: relative(rootDir, dirPath).replaceAll("\\", "/").toLowerCase(),
  }));

  const targetKeywords =
    adminLevel === "city"
      ? ["县级", "县区", "区县", "county"]
      : ["乡镇", "镇街", "街道", "town"];

  const matched = normalizedWithPath.find(({ normalized }) =>
    targetKeywords.some((keyword) => normalized.includes(keyword)),
  );
  if (!matched) {
    throw new Error(
      `未找到目标层级目录：${adminLevel === "city" ? "县级" : "乡镇"}。`,
    );
  }

  return matched.dirPath;
}

/**
 * 递归收集指定扩展名文件。
 *
 * 输入根目录和扩展名，输出命中的文件绝对路径列表；读取失败会向上抛出。
 */
async function collectFilesByExtension(
  rootDir: string,
  extension: string,
): Promise<string[]> {
  const matchedFiles: string[] = [];
  const stack: string[] = [rootDir];
  const normalizedExt = extension.toLowerCase();

  while (stack.length) {
    const currentDir = stack.pop();
    if (!currentDir) {
      continue;
    }

    const entries = await readdir(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(currentDir, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
        continue;
      }

      if (extname(entry.name).toLowerCase() === normalizedExt) {
        matchedFiles.push(fullPath);
      }
    }
  }

  return matchedFiles;
}

/**
 * 读取并校验 GeoJSON 文件。
 *
 * 输入文件路径，输出 GeoJSON 对象；文件不是 JSON 对象或缺少 type 字段时抛错。
 */
async function readGeoJsonFile(geojsonPath: string): Promise<Record<string, unknown>> {
  const rawContent = await readFile(geojsonPath, "utf-8");
  const parsed = JSON.parse(rawContent) as unknown;
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    Array.isArray(parsed) ||
    typeof (parsed as { type?: unknown }).type !== "string"
  ) {
    throw new Error("geojson 文件内容无效，缺少合法的对象结构。");
  }

  return parsed as Record<string, unknown>;
}

/**
 * 通过批量压缩包获取含下级区域边界的 GeoJSON。
 *
 * 输入城市或区县编码，输出下一级行政边界 GeoJSON；临时文件始终在 finally 中清理。
 */
export async function fetchBoundaryDataByBatchZip(
  rawCityCode: string,
): Promise<BoundaryBatchFetchResult> {
  const cityCode = normalizeCityCode(rawCityCode);
  const adminLevel = resolveAdminLevel(cityCode);
  const tempRoot = await mkdtemp(join(tmpdir(), "boundary-batch-"));

  try {
    const zipDownload = await downloadBoundaryBatchZip(cityCode, adminLevel);
    const zipPath = join(tempRoot, zipDownload.fileName);
    await writeFile(zipPath, zipDownload.fileBuffer);

    const extractDir = join(tempRoot, "extracted");
    const zip = new AdmZip(zipPath);
    zip.extractAllTo(extractDir, true);

    const targetDirectory = await selectTargetDirectory(extractDir, adminLevel);
    const geojsonFiles = await collectFilesByExtension(targetDirectory, ".geojson");
    if (!geojsonFiles.length) {
      throw new Error("目标目录未找到 .geojson 文件。");
    }

    const selectedGeoJsonPath = geojsonFiles.sort()[0];
    const boundaryData = await readGeoJsonFile(selectedGeoJsonPath);

    return {
      adminLevel,
      boundaryData: JSON.parse(JSON.stringify(boundaryData)) as Record<
        string,
        unknown
      >,
      cityCode,
      selectedDirectory: relative(extractDir, targetDirectory) || ".",
      selectedFileCount: geojsonFiles.length,
      source: "ruiduobao_batch",
      year: FIXED_YEAR,
    };
  } finally {
    await rm(tempRoot, { force: true, recursive: true });
  }
}
