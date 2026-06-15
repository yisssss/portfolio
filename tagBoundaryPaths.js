import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.164.1/build/three.module.js";

export const BOUNDARY_PIXEL_CELL_SIZE = 10;

/** 태그 칩 PNG 베이크 전용: line 태그 경계/선 두께 배율 (메인 씬과 별도) */
export const TAG_CHIP_LINE_STROKE_SCALE = 2;

const TAG_CHIP_ARROW_SAMPLE_SPACING = 20;

function distanceBetween(a, b) {
    return Math.hypot(a.x - b.x, a.y - b.y);
}

function normalizePoint(point) {
    const length = Math.hypot(point.x, point.y) || 1;
    return {
        x: point.x / length,
        y: point.y / length
    };
}

function polygonArea(points) {
    let area = 0;

    for (let i = 0; i < points.length; i += 1) {
        const current = points[i];
        const next = points[(i + 1) % points.length];
        area += current.x * next.y - next.x * current.y;
    }

    return area * 0.5;
}

function buildLinearPath(points) {
    if (points.length < 2) {
        return "";
    }

    return points.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`).join(" ") + " Z";
}

function buildSmoothPath(points) {
    if (points.length < 3) {
        return "";
    }

    const curve = new THREE.CatmullRomCurve3(
        points.map((point) => new THREE.Vector3(point.x, point.y, 0)),
        true,
        "catmullrom",
        0.08
    );
    const smoothPoints = curve.getPoints(Math.max(points.length * 8, 32));

    return smoothPoints.map(
        (point, index) => `${index === 0 ? "M" : "L"} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`
    ).join(" ") + " Z";
}

function getSmoothContourPoints(points, resolution) {
    const curve = new THREE.CatmullRomCurve3(
        points.map((point) => new THREE.Vector3(point.x, point.y, 0)),
        true,
        "catmullrom",
        0.08
    );

    return curve.getPoints(resolution).map((point) => ({
        x: point.x,
        y: point.y
    }));
}

function getStableContourPoints(points, resolution) {
    const smoothPoints = getSmoothContourPoints(points, resolution);

    if (smoothPoints.length === 0) {
        return smoothPoints;
    }

    let anchorIndex = 0;

    for (let i = 1; i < smoothPoints.length; i += 1) {
        const current = smoothPoints[i];
        const anchor = smoothPoints[anchorIndex];

        if (current.y < anchor.y || (Math.abs(current.y - anchor.y) < 0.001 && current.x < anchor.x)) {
            anchorIndex = i;
        }
    }

    return smoothPoints.slice(anchorIndex).concat(smoothPoints.slice(0, anchorIndex));
}

function samplePointOnClosedContour(closedPoints, cumulative, targetDistance) {
    const totalLength = cumulative[cumulative.length - 1];
    const wrappedDistance = ((targetDistance % totalLength) + totalLength) % totalLength;

    for (let i = 1; i < cumulative.length; i += 1) {
        if (wrappedDistance > cumulative[i]) {
            continue;
        }

        const start = closedPoints[i - 1];
        const end = closedPoints[i];
        const segmentLength = cumulative[i] - cumulative[i - 1];
        const t = segmentLength <= 0 ? 0 : (wrappedDistance - cumulative[i - 1]) / segmentLength;

        return {
            x: start.x + (end.x - start.x) * t,
            y: start.y + (end.y - start.y) * t
        };
    }

    return closedPoints[0];
}

function sampleContourBySpacing(points, spacing) {
    if (points.length < 2) {
        return points;
    }

    const closedPoints = [...points, points[0]];
    const cumulative = [0];

    for (let i = 1; i < closedPoints.length; i += 1) {
        cumulative.push(cumulative[i - 1] + distanceBetween(closedPoints[i - 1], closedPoints[i]));
    }

    const totalLength = cumulative[cumulative.length - 1];

    if (totalLength <= 0) {
        return points;
    }

    const sampleCount = Math.max(3, Math.floor(totalLength / spacing));
    const samples = [];

    for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex += 1) {
        const targetDistance = sampleIndex * spacing;
        samples.push(samplePointOnClosedContour(closedPoints, cumulative, targetDistance));
    }

    return samples;
}

/** main.js buildCircleContour 와 동일 */
export function buildChipCircleContour(cx, cy, circleRadius, config) {
    const pointCount = 28;
    const radius = circleRadius * Math.max((config.hullPadding ?? 1.6) * 0.92, 1.15);
    const contour = [];

    for (let i = 0; i < pointCount; i += 1) {
        const angle = (Math.PI * 2 * i) / pointCount;
        contour.push({
            x: cx + Math.cos(angle) * radius,
            y: cy + Math.sin(angle) * radius
        });
    }

    return contour;
}

function createBoundaryPath(config) {
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    const strokeScale = config.chipLineStrokeScale ?? TAG_CHIP_LINE_STROKE_SCALE;

    path.setAttribute("fill", "none");
    path.setAttribute("stroke", config.lineStroke ?? "#111111");
    path.setAttribute("stroke-width", String((config.strokeWidth ?? 1.5) * strokeScale));
    path.setAttribute("stroke-linecap", "round");
    path.setAttribute("stroke-linejoin", "round");
    path.setAttribute("opacity", String(config.opacity ?? 0.8));

    if (config.dash) {
        const detailScale = config.chipLineDetailScale ?? 1;
        const dash = config.dash
            .split(/\s+/)
            .map((value) => String(Number(value) / detailScale))
            .join(" ");
        path.setAttribute("stroke-dasharray", dash);
    }

    return path;
}

function createArrowStampPath(contour, config) {
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    const points = getStableContourPoints(contour, Math.max(contour.length * 6, 48));
    const detailScale = config.chipLineDetailScale ?? 1;
    const sampleSpacing = TAG_CHIP_ARROW_SAMPLE_SPACING / detailScale;
    const samples = sampleContourBySpacing(points, sampleSpacing);
    const winding = Math.sign(polygonArea(points)) || 1;
    const strokeScale = config.chipLineStrokeScale ?? TAG_CHIP_LINE_STROKE_SCALE;
    const tangentHalfWidth = 4.5 * strokeScale;
    const inwardLength = 13 * strokeScale;
    let d = "";

    if (samples.length < 3) {
        path.setAttribute("d", "");
        return path;
    }

    for (let i = 0; i < samples.length; i += 1) {
        const current = samples[i];
        const next = samples[(i + 1) % samples.length];
        const tangent = normalizePoint({
            x: next.x - current.x,
            y: next.y - current.y
        });
        const inward = winding >= 0
            ? { x: -tangent.y, y: tangent.x }
            : { x: tangent.y, y: -tangent.x };
        const baseLeft = {
            x: current.x - tangent.x * tangentHalfWidth,
            y: current.y - tangent.y * tangentHalfWidth
        };
        const baseRight = {
            x: current.x + tangent.x * tangentHalfWidth,
            y: current.y + tangent.y * tangentHalfWidth
        };
        const tip = {
            x: current.x + inward.x * inwardLength,
            y: current.y + inward.y * inwardLength
        };

        d += `M ${baseLeft.x.toFixed(2)} ${baseLeft.y.toFixed(2)} L ${tip.x.toFixed(2)} ${tip.y.toFixed(2)} L ${baseRight.x.toFixed(2)} ${baseRight.y.toFixed(2)} Z `;
    }

    path.setAttribute("d", d.trim());
    path.setAttribute("fill", config.lineStroke ?? "#111111");
    path.setAttribute("stroke", "none");
    path.setAttribute("opacity", String(config.opacity ?? 0.8));

    return path;
}

function createPixelLinePath(contour, config) {
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    const strokeScale = config.chipLineStrokeScale ?? TAG_CHIP_LINE_STROKE_SCALE;
    const points = getStableContourPoints(contour, Math.max(contour.length * 6, 48));
    const cellSize = BOUNDARY_PIXEL_CELL_SIZE;
    const snapped = points
        .map((point) => ({
            x: Math.round(point.x / cellSize) * cellSize,
            y: Math.round(point.y / cellSize) * cellSize
        }))
        .filter((point, index, array) => index === 0 || distanceBetween(point, array[index - 1]) > 0.1);

    path.setAttribute("d", buildLinearPath(snapped));
    path.setAttribute("fill", "none");
    path.setAttribute("stroke", config.lineStroke ?? "#111111");
    path.setAttribute("stroke-width", String(((config.strokeWidth ?? 1.5) + 0.35) * strokeScale));
    path.setAttribute("stroke-linecap", "square");
    path.setAttribute("stroke-linejoin", "miter");
    path.setAttribute("opacity", String(config.opacity ?? 0.8));

    return path;
}

/** main.js renderBoundaryContours 와 동일한 line 태그 경계 생성 */
export function appendLineTagBoundary(group, contour, config) {
    if (contour.length < 4) {
        return;
    }

    if (config.styleType === "arrow-line") {
        group.append(createArrowStampPath(contour, config));
        return;
    }

    if (config.styleType === "pixel-line") {
        group.append(createPixelLinePath(contour, config));
        return;
    }

    const path = createBoundaryPath(config);
    path.setAttribute("d", buildSmoothPath(contour));
    group.append(path);
}

/**
 * @param {object} config  tagConfigs + lineStroke
 * @param {number} size
 * @param {number} blobRadius  Matter 원 반지름(칩 스케일)
 */
export function buildLineTagBoundarySvg(config, size, blobRadius) {
    const cx = size / 2;
    const cy = size / 2;
    const hullScale = Math.max((config.hullPadding ?? 1.6) * 0.92, 1.15);
    const maxContourRadius = size * 0.42;
    const bodyRadius = Math.min(blobRadius, maxContourRadius / hullScale);
    const contour = buildChipCircleContour(cx, cy, bodyRadius, config);
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");

    svg.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    svg.setAttribute("width", String(size));
    svg.setAttribute("height", String(size));
    svg.setAttribute("viewBox", `0 0 ${size} ${size}`);

    const group = document.createElementNS("http://www.w3.org/2000/svg", "g");
    appendLineTagBoundary(group, contour, config);
    svg.append(group);

    return svg;
}

/** @returns {Promise<HTMLCanvasElement>} */
export function rasterizeSvgToCanvas(svg, width, height) {
    return new Promise((resolve, reject) => {
        const svgString = new XMLSerializer().serializeToString(svg);
        const blob = new Blob([svgString], { type: "image/svg+xml;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const img = new Image();

        img.onload = () => {
            const canvas = document.createElement("canvas");
            canvas.width = width;
            canvas.height = height;

            const ctx = canvas.getContext("2d");
            ctx.clearRect(0, 0, width, height);
            ctx.drawImage(img, 0, 0, width, height);
            URL.revokeObjectURL(url);
            resolve(canvas);
        };

        img.onerror = (error) => {
            URL.revokeObjectURL(url);
            reject(error);
        };

        img.src = url;
    });
}
