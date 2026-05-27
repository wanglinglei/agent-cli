/*
 * @Author: wanglinglei
 * @Date: 2026-05-27 20:05:00
 * @Description: 将行政边界 GeoJSON 转换为可下载的 SVG 文本。
 * @FilePath: /agents-cli/src/tools/boundarySvg.ts
 * @LastEditTime: 2026-05-27 20:05:00
 */
import type { BoundarySvgStyle } from "../types.js";

const SVG_CANVAS_SIZE = 1024;
const SVG_PADDING = 16;
const COLOR_ALIAS: Record<string, string> = {
  白色: "#ffffff",
  白: "#ffffff",
  黑色: "#000000",
  黑: "#000000",
  红色: "#ff0000",
  红: "#ff0000",
  蓝色: "#0000ff",
  蓝: "#0000ff",
  绿色: "#008000",
  绿: "#008000",
  黄色: "#ffff00",
  黄: "#ffff00",
  灰色: "#808080",
  灰: "#808080",
  橙色: "#ffa500",
  橙: "#ffa500",
  紫色: "#800080",
  紫: "#800080",
};

type Point = [number, number];
type Ring = Point[];

/**
 * 默认 SVG 样式。
 */
export const DEFAULT_BOUNDARY_SVG_STYLE: BoundarySvgStyle = {
  fillColor: "#dbeafe",
  strokeColor: "#1f2937",
  strokeWidth: 1,
};

/**
 * SVG 生成入参。
 */
export interface BoundarySvgBuildInput {
  boundaryData: Record<string, unknown>;
  style?: Partial<BoundarySvgStyle>;
}

/**
 * SVG 生成结果。
 */
export interface BoundarySvgBuildResult {
  svg: string;
  style: BoundarySvgStyle;
}

/**
 * 判断值是否是普通对象。
 *
 * 输入任意值，输出是否为对象记录；失败策略是返回 false，由上层跳过该节点。
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * 归一化颜色值。
 *
 * 输入中文色名、英文色名或十六进制颜色，输出可直接写入 SVG 的颜色值。
 */
function normalizeColor(rawColor: string): string | undefined {
  const trimmed = rawColor.trim().toLowerCase();
  if (!trimmed) {
    return undefined;
  }

  if (/^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(trimmed)) {
    return trimmed;
  }

  if (/^[a-z]+$/.test(trimmed)) {
    return trimmed;
  }

  return COLOR_ALIAS[rawColor.trim()];
}

/**
 * 归一化样式补丁。
 *
 * 输入用户解析出的局部样式，输出合并前可用的安全样式；无效字段会被静默丢弃。
 */
export function normalizeBoundaryStylePatch(
  style?: Partial<BoundarySvgStyle>,
): Partial<BoundarySvgStyle> | undefined {
  if (!style) {
    return undefined;
  }

  const fillColor =
    typeof style.fillColor === "string" ? normalizeColor(style.fillColor) : undefined;
  const strokeColor =
    typeof style.strokeColor === "string"
      ? normalizeColor(style.strokeColor)
      : undefined;
  const strokeWidth =
    typeof style.strokeWidth === "number" &&
    Number.isFinite(style.strokeWidth) &&
    style.strokeWidth > 0
      ? style.strokeWidth
      : undefined;

  const normalized = {
    ...(fillColor ? { fillColor } : {}),
    ...(strokeColor ? { strokeColor } : {}),
    ...(strokeWidth ? { strokeWidth } : {}),
  };

  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

/**
 * 从任意 GeoJSON 结构中收集所有 Polygon ring。
 *
 * 输入边界数据，输出可绘制的 ring 数组；不可识别节点会被跳过。
 */
function collectRings(boundaryData: Record<string, unknown>): Ring[] {
  const rings: Ring[] = [];

  /**
   * 深度遍历 GeoJSON 节点。
   *
   * 输入当前节点，输出通过闭包把有效 ring 追加到结果数组；失败时静默跳过异常节点。
   */
  const walk = (node: unknown): void => {
    if (!isRecord(node)) {
      return;
    }

    const nodeType = typeof node.type === "string" ? node.type : "";

    if (nodeType === "FeatureCollection" && Array.isArray(node.features)) {
      for (const feature of node.features) {
        walk(feature);
      }
      return;
    }

    if (nodeType === "Feature") {
      walk(node.geometry);
      return;
    }

    if (nodeType === "Polygon") {
      const coordinates = node.coordinates;
      if (Array.isArray(coordinates)) {
        for (const ring of coordinates) {
          const normalized = normalizeRing(ring);
          if (normalized.length > 2) {
            rings.push(normalized);
          }
        }
      }
      return;
    }

    if (nodeType === "MultiPolygon") {
      const coordinates = node.coordinates;
      if (Array.isArray(coordinates)) {
        for (const polygon of coordinates) {
          if (!Array.isArray(polygon)) {
            continue;
          }
          for (const ring of polygon) {
            const normalized = normalizeRing(ring);
            if (normalized.length > 2) {
              rings.push(normalized);
            }
          }
        }
      }
    }
  };

  walk(boundaryData);
  return rings;
}

/**
 * 归一化 ring 坐标结构。
 *
 * 输入原始坐标数组，输出二维点集合；无效点会被过滤。
 */
function normalizeRing(input: unknown): Ring {
  if (!Array.isArray(input)) {
    return [];
  }

  const points: Point[] = [];
  for (const item of input) {
    if (!Array.isArray(item) || item.length < 2) {
      continue;
    }

    const x = Number(item[0]);
    const y = Number(item[1]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      continue;
    }

    points.push([x, y]);
  }

  return points;
}

/**
 * 计算所有 ring 的边界框。
 *
 * 输入 ring 数组，输出投影所需的边界框；调用前必须保证至少存在一个点。
 */
function computeBounds(rings: Ring[]): {
  maxX: number;
  maxY: number;
  minX: number;
  minY: number;
} {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (const ring of rings) {
    for (const [x, y] of ring) {
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }

  return { maxX, maxY, minX, minY };
}

/**
 * 将 ring 转换为 SVG path。
 *
 * 输入多组坐标，输出 path d 字符串；坐标会等比缩放并居中到固定画布。
 */
function buildPathData(rings: Ring[]): string {
  const { maxX, maxY, minX, minY } = computeBounds(rings);
  const dx = Math.max(maxX - minX, 1e-8);
  const dy = Math.max(maxY - minY, 1e-8);
  const availableSize = SVG_CANVAS_SIZE - SVG_PADDING * 2;
  const scale = Math.min(availableSize / dx, availableSize / dy);
  const projectedWidth = dx * scale;
  const projectedHeight = dy * scale;
  const offsetX = (SVG_CANVAS_SIZE - projectedWidth) / 2;
  const offsetY = (SVG_CANVAS_SIZE - projectedHeight) / 2;

  const projectPoint = ([x, y]: Point): Point => [
    (x - minX) * scale + offsetX,
    (maxY - y) * scale + offsetY,
  ];

  const commands: string[] = [];
  for (const ring of rings) {
    if (ring.length < 3) {
      continue;
    }

    const projected = ring.map(projectPoint);
    const [firstX, firstY] = projected[0];
    commands.push(`M ${firstX.toFixed(2)} ${firstY.toFixed(2)}`);

    for (let index = 1; index < projected.length; index += 1) {
      const [x, y] = projected[index];
      commands.push(`L ${x.toFixed(2)} ${y.toFixed(2)}`);
    }

    commands.push("Z");
  }

  return commands.join(" ");
}

/**
 * 根据边界数据构建最终 SVG。
 *
 * 输入 GeoJSON 和样式补丁，输出完整 SVG 文本与最终样式；无可绘制几何时抛错。
 */
export function buildBoundarySvg(input: BoundarySvgBuildInput): BoundarySvgBuildResult {
  const rings = collectRings(input.boundaryData);
  if (!rings.length) {
    throw new Error("边界数据不包含可绘制的 Polygon/MultiPolygon。");
  }

  const style: BoundarySvgStyle = {
    ...DEFAULT_BOUNDARY_SVG_STYLE,
    ...(normalizeBoundaryStylePatch(input.style) ?? {}),
  };
  const pathData = buildPathData(rings);
  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SVG_CANVAS_SIZE} ${SVG_CANVAS_SIZE}" width="${SVG_CANVAS_SIZE}" height="${SVG_CANVAS_SIZE}" preserveAspectRatio="xMidYMid meet">`,
    '<rect width="100%" height="100%" fill="#ffffff" />',
    `<path d="${pathData}" fill="${style.fillColor}" stroke="${style.strokeColor}" stroke-width="${style.strokeWidth}" />`,
    "</svg>",
  ].join("");

  return { svg, style };
}
