import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.164.1/build/three.module.js";
import {
    getMergedShaderVisual,
    getTagChipBlobRadius,
    getTagChipExportScale,
    scenePostEffects,
    TAG_CHIP_BLOB_RADIUS_BASE,
    TAG_INDEX_MAP,
    TAG_KEYS,
    TAG_STYLE_IDS,
    tagChipLineDetailScale,
    tagConfigs
} from "./data.js";
import {
    buildLineTagBoundarySvg,
    rasterizeSvgToCanvas
} from "./tagBoundaryPaths.js";

export { TAG_KEYS };

export const TAG_CHIP_EXPORT_SIZE = 128;
/** @deprecated `getTagChipBlobRadius(tag)` / `TAG_CHIP_BLOB_RADIUS_BASE` 사용 */
export const TAG_CHIP_BLOB_RADIUS = TAG_CHIP_BLOB_RADIUS_BASE;
export const TAG_CHIP_ASSET_DIR = "./assets/tag-chips";
export const TAG_CHIP_BG_HEX = "#c8c8c8";

const MAX_BLOBS = 1;
const MAX_TAGS_PER_BLOB = 1;
const MAX_TAG_GROUPS = TAG_KEYS.length;
/** 메인 씬·셰이더와 동일. 블롭 반지름과 무관하게 고정 → 텍스쳐 픽셀 크기 유지 */
const PIXEL_CELL_SIZE = 10;

/** @param {string} tag */
export function getTagChipAssetPath(tag) {
    return `${TAG_CHIP_ASSET_DIR}/${tag}.png`;
}

function readInfluenceMaskPair(fillExtents, legacyKey, lowKey, highKey, fallbackLo, fallbackHi) {
    let lo = fillExtents[lowKey];
    let hi = fillExtents[highKey];
    const legacy = fillExtents[legacyKey];

    if (Array.isArray(legacy) && legacy.length >= 2) {
        if (lo === undefined) {
            lo = legacy[0];
        }
        if (hi === undefined) {
            hi = legacy[1];
        }
    }

    if (lo === undefined) {
        lo = fallbackLo;
    }
    if (hi === undefined) {
        hi = fallbackHi;
    }

    return [lo, hi];
}

function applyMaskExpand(lo, hi, expand) {
    const span = Math.max(hi - lo, 1e-6);
    const e = Math.max(0.12, expand ?? 1);
    return [lo, lo + span / e];
}

function parseHexRgb(hex) {
    const color = new THREE.Color(hex);
    return [Math.round(color.r * 255), Math.round(color.g * 255), Math.round(color.b * 255)];
}

function keyOutBackground(ctx, width, height, bgRgb, tolerance = 10) {
    const image = ctx.getImageData(0, 0, width, height);
    const data = image.data;

    for (let i = 0; i < data.length; i += 4) {
        const dr = Math.abs(data[i] - bgRgb[0]);
        const dg = Math.abs(data[i + 1] - bgRgb[1]);
        const db = Math.abs(data[i + 2] - bgRgb[2]);

        if (dr <= tolerance && dg <= tolerance && db <= tolerance) {
            data[i + 3] = 0;
        }
    }

    ctx.putImageData(image, 0, 0);
}

function createMetaballUniforms(size) {
    return {
        uResolution: { value: new THREE.Vector2(size, size) },
        uBlobCount: { value: 0 },
        uBlobPositions: { value: [new THREE.Vector2(-9999, -9999)] },
        uBlobRadii: { value: new Float32Array(MAX_BLOBS) },
        uBlobTagCounts: { value: new Float32Array(MAX_BLOBS) },
        uBlobTagIndices: { value: new Float32Array(MAX_BLOBS * MAX_TAGS_PER_BLOB) },
        uTagStyleIds: { value: new Float32Array(TAG_STYLE_IDS) },
        uTagDefaultFill: {
            value: Array.from({ length: MAX_TAG_GROUPS }, () => new THREE.Vector3(0.91, 0.89, 0.84))
        },
        uTagDefaultFillMid: {
            value: Array.from({ length: MAX_TAG_GROUPS }, () => new THREE.Vector3(0.43, 0.35, 0.3))
        },
        uTagDefaultFillOuter: {
            value: Array.from({ length: MAX_TAG_GROUPS }, () => new THREE.Vector3(0.08, 0.07, 0.06))
        },
        uTagTintDefaultFill: {
            value: Array.from({ length: MAX_TAG_GROUPS }, () => new THREE.Vector3(0.78, 0.84, 0.91))
        },
        uTagTintDefaultFillMid: {
            value: Array.from({ length: MAX_TAG_GROUPS }, () => new THREE.Vector3(0.42, 0.55, 0.68))
        },
        uTagTintDefaultFillOuter: {
            value: Array.from({ length: MAX_TAG_GROUPS }, () => new THREE.Vector3(0.1, 0.15, 0.19))
        },
        uTagCheckerLight: {
            value: Array.from({ length: MAX_TAG_GROUPS }, () => new THREE.Vector3(0.93, 0.93, 0.93))
        },
        uTagCheckerDark: {
            value: Array.from({ length: MAX_TAG_GROUPS }, () => new THREE.Vector3(0.08, 0.08, 0.08))
        },
        uTagCrossInk: {
            value: Array.from({ length: MAX_TAG_GROUPS }, () => new THREE.Vector3(0.17, 0.17, 0.17))
        },
        uTagHalftoneInk: {
            value: Array.from({ length: MAX_TAG_GROUPS }, () => new THREE.Vector3(0.1, 0.25, 0.76))
        },
        uTagHalftonePaper: {
            value: Array.from({ length: MAX_TAG_GROUPS }, () => new THREE.Vector3(0.96, 0.95, 0.93))
        },
        uTagFillDefaultLo: { value: new Float32Array(MAX_TAG_GROUPS) },
        uTagFillDefaultHi: { value: new Float32Array(MAX_TAG_GROUPS) },
        uTagFillTintFillLo: { value: new Float32Array(MAX_TAG_GROUPS) },
        uTagFillTintFillHi: { value: new Float32Array(MAX_TAG_GROUPS) },
        uTagFillCheckerPixelThresh: { value: new Float32Array(MAX_TAG_GROUPS) },
        uTagFillCheckerLightTransparent: { value: new Float32Array(MAX_TAG_GROUPS) },
        uTagFillCrossPixelThresh: { value: new Float32Array(MAX_TAG_GROUPS) },
        uTagFillHalftoneLo: { value: new Float32Array(MAX_TAG_GROUPS) },
        uTagFillHalftoneHi: { value: new Float32Array(MAX_TAG_GROUPS) },
        uTagHalftoneSpacing: { value: new Float32Array(MAX_TAG_GROUPS) },
        uTagHalftoneDotMin: { value: new Float32Array(MAX_TAG_GROUPS) },
        uTagHalftoneDotMax: { value: new Float32Array(MAX_TAG_GROUPS) },
        uBlobColor: { value: new THREE.Color("#ffffff") },
        uBackgroundColor: { value: new THREE.Color(TAG_CHIP_BG_HEX) },
        uFilmGrainStrength: { value: 0 },
        uGradientMapA: { value: new THREE.Vector3(1, 1, 1) },
        uGradientMapB: { value: new THREE.Vector3(0.79, 0.75, 0.69) },
        uGradientMapMix: { value: 0 },
        uFillEdgeDitherMix: { value: 0 },
        uFillEdgeDitherBand: { value: 0.42 },
        uFillDitherNoiseAmount: { value: 0 }
    };
}

function syncTagShaderVisualUniforms(uniforms) {
    TAG_KEYS.forEach((key, i) => {
        const { colors, fillExtents } = getMergedShaderVisual(key);
        const setRgb = (arr, hex) => {
            const col = new THREE.Color(hex);
            arr[i].set(col.r, col.g, col.b);
        };

        setRgb(uniforms.uTagDefaultFill.value, colors.defaultFill);
        setRgb(uniforms.uTagDefaultFillMid.value, colors.defaultFillMid ?? colors.defaultFill);
        setRgb(uniforms.uTagDefaultFillOuter.value, colors.defaultFillOuter ?? colors.defaultFill);
        setRgb(uniforms.uTagTintDefaultFill.value, colors.tintDefaultFill);
        setRgb(uniforms.uTagTintDefaultFillMid.value, colors.tintDefaultFillMid ?? colors.tintDefaultFill);
        setRgb(uniforms.uTagTintDefaultFillOuter.value, colors.tintDefaultFillOuter ?? colors.tintDefaultFill);
        setRgb(uniforms.uTagCheckerLight.value, colors.checkerLight);
        setRgb(uniforms.uTagCheckerDark.value, colors.checkerDark);
        setRgb(uniforms.uTagCrossInk.value, colors.crossInk);
        setRgb(uniforms.uTagHalftoneInk.value, colors.halftoneInk);
        setRgb(uniforms.uTagHalftonePaper.value, colors.halftonePaper);

        const [defLo, defHi0] = readInfluenceMaskPair(
            fillExtents,
            "defaultMask",
            "defaultFillMaskLow",
            "defaultFillMaskHigh",
            0.5,
            5.5
        );
        const [defLo2, defHi2] = applyMaskExpand(defLo, defHi0, fillExtents.defaultFillExpand);
        uniforms.uTagFillDefaultLo.value[i] = defLo2;
        uniforms.uTagFillDefaultHi.value[i] = defHi2;

        const [tLo, tHi0] = readInfluenceMaskPair(
            fillExtents,
            "tintFillMask",
            "tintFillMaskLow",
            "tintFillMaskHigh",
            0.92,
            5.2
        );
        const [tLo2, tHi2] = applyMaskExpand(tLo, tHi0, fillExtents.tintFillExpand);
        uniforms.uTagFillTintFillLo.value[i] = tLo2;
        uniforms.uTagFillTintFillHi.value[i] = tHi2;

        uniforms.uTagFillCheckerPixelThresh.value[i] = fillExtents.checkerPixelThreshold;
        uniforms.uTagFillCheckerLightTransparent.value[i] = fillExtents.checkerLightTransparent !== false ? 1 : 0;
        uniforms.uTagFillCrossPixelThresh.value[i] = fillExtents.crossPixelThreshold;

        const [hLo, hHi0] = readInfluenceMaskPair(
            fillExtents,
            "halftoneMask",
            "halftoneMaskLow",
            "halftoneMaskHigh",
            0.78,
            1.18
        );
        const [hLo2, hHi2] = applyMaskExpand(hLo, hHi0, fillExtents.halftoneExpand);
        uniforms.uTagFillHalftoneLo.value[i] = hLo2;
        uniforms.uTagFillHalftoneHi.value[i] = hHi2;
        uniforms.uTagHalftoneSpacing.value[i] = fillExtents.halftoneSpacing;
        uniforms.uTagHalftoneDotMin.value[i] = fillExtents.halftoneDotRadiusMin;
        uniforms.uTagHalftoneDotMax.value[i] = fillExtents.halftoneDotRadiusMax;
    });
}

function syncScenePostUniforms(uniforms) {
    const p = scenePostEffects;
    uniforms.uFilmGrainStrength.value = p.filmGrainStrength ?? 0;
    uniforms.uGradientMapMix.value = p.gradientMapMix ?? 0;
    uniforms.uFillEdgeDitherMix.value = p.fillEdgeDitherMix ?? 0;
    uniforms.uFillEdgeDitherBand.value = Math.max(0.001, p.fillEdgeDitherBand ?? 0.35);
    uniforms.uFillDitherNoiseAmount.value = p.fillDitherNoiseAmount ?? 0;

    const colorA = new THREE.Color(p.gradientMapColorA ?? "#ffffff");
    const colorB = new THREE.Color(p.gradientMapColorB ?? "#ffffff");
    uniforms.uGradientMapA.value.set(colorA.r, colorA.g, colorA.b);
    uniforms.uGradientMapB.value.set(colorB.r, colorB.g, colorB.b);
}

function buildFragmentShader() {
    return `
        precision highp float;

        #define MAX_BLOBS ${MAX_BLOBS}
        #define MAX_TAGS_PER_BLOB ${MAX_TAGS_PER_BLOB}
        #define MAX_TAG_GROUPS ${MAX_TAG_GROUPS}
        #define PIXEL_CELL_SIZE ${PIXEL_CELL_SIZE.toFixed(1)}

        uniform vec2 uResolution;
        uniform int uBlobCount;
        uniform vec2 uBlobPositions[MAX_BLOBS];
        uniform float uBlobRadii[MAX_BLOBS];
        uniform float uBlobTagCounts[MAX_BLOBS];
        uniform float uBlobTagIndices[MAX_BLOBS * MAX_TAGS_PER_BLOB];
        uniform float uTagStyleIds[MAX_TAG_GROUPS];
        uniform vec3 uTagDefaultFill[MAX_TAG_GROUPS];
        uniform vec3 uTagDefaultFillMid[MAX_TAG_GROUPS];
        uniform vec3 uTagDefaultFillOuter[MAX_TAG_GROUPS];
        uniform vec3 uTagTintDefaultFill[MAX_TAG_GROUPS];
        uniform vec3 uTagTintDefaultFillMid[MAX_TAG_GROUPS];
        uniform vec3 uTagTintDefaultFillOuter[MAX_TAG_GROUPS];
        uniform vec3 uTagCheckerLight[MAX_TAG_GROUPS];
        uniform vec3 uTagCheckerDark[MAX_TAG_GROUPS];
        uniform vec3 uTagCrossInk[MAX_TAG_GROUPS];
        uniform vec3 uTagHalftoneInk[MAX_TAG_GROUPS];
        uniform vec3 uTagHalftonePaper[MAX_TAG_GROUPS];
        uniform float uTagFillDefaultLo[MAX_TAG_GROUPS];
        uniform float uTagFillDefaultHi[MAX_TAG_GROUPS];
        uniform float uTagFillTintFillLo[MAX_TAG_GROUPS];
        uniform float uTagFillTintFillHi[MAX_TAG_GROUPS];
        uniform float uTagFillCheckerPixelThresh[MAX_TAG_GROUPS];
        uniform float uTagFillCheckerLightTransparent[MAX_TAG_GROUPS];
        uniform float uTagFillCrossPixelThresh[MAX_TAG_GROUPS];
        uniform float uTagFillHalftoneLo[MAX_TAG_GROUPS];
        uniform float uTagFillHalftoneHi[MAX_TAG_GROUPS];
        uniform float uTagHalftoneSpacing[MAX_TAG_GROUPS];
        uniform float uTagHalftoneDotMin[MAX_TAG_GROUPS];
        uniform float uTagHalftoneDotMax[MAX_TAG_GROUPS];
        uniform vec3 uBlobColor;
        uniform vec3 uBackgroundColor;
        uniform float uFilmGrainStrength;
        uniform vec3 uGradientMapA;
        uniform vec3 uGradientMapB;
        uniform float uGradientMapMix;
        uniform float uFillEdgeDitherMix;
        uniform float uFillEdgeDitherBand;
        uniform float uFillDitherNoiseAmount;

        varying vec2 vUv;

        float getBlobTagIndex(int blobIndex, int tagIndex) {
            return uBlobTagIndices[blobIndex * MAX_TAGS_PER_BLOB + tagIndex];
        }

        float hash12(vec2 point) {
            return fract(sin(dot(point, vec2(127.1, 311.7))) * 43758.5453123);
        }

        float bayer4(float ix, float iy) {
            if (iy < 1.0) {
                if (ix < 1.0) return 0.0 / 16.0;
                if (ix < 2.0) return 8.0 / 16.0;
                if (ix < 3.0) return 2.0 / 16.0;
                return 10.0 / 16.0;
            }
            if (iy < 2.0) {
                if (ix < 1.0) return 12.0 / 16.0;
                if (ix < 2.0) return 4.0 / 16.0;
                if (ix < 3.0) return 14.0 / 16.0;
                return 6.0 / 16.0;
            }
            if (iy < 3.0) {
                if (ix < 1.0) return 3.0 / 16.0;
                if (ix < 2.0) return 11.0 / 16.0;
                if (ix < 3.0) return 1.0 / 16.0;
                return 9.0 / 16.0;
            }
            if (ix < 1.0) return 15.0 / 16.0;
            if (ix < 2.0) return 7.0 / 16.0;
            if (ix < 3.0) return 13.0 / 16.0;
            return 5.0 / 16.0;
        }

        float fillEdgeDither(float softMask, vec2 fragPx) {
            float t = uFillEdgeDitherMix;
            if (t < 0.0001) {
                return softMask;
            }
            float ix = mod(floor(fragPx.x), 4.0);
            float iy = mod(floor(fragPx.y), 4.0);
            float bth = bayer4(ix, iy);
            float n = hash12(floor(fragPx) + vec2(19.7, 71.3));
            float jitter = (n - 0.5) * uFillDitherNoiseAmount * 0.38;
            float thr = clamp(bth + jitter, 0.001, 0.999);
            float edgeW = smoothstep(0.0, uFillEdgeDitherBand, min(softMask, 1.0 - softMask) * 2.0);
            float hard = step(thr, softMask);
            return mix(softMask, hard, t * edgeW);
        }

        vec4 defaultFillLayer(vec2 screenUv, vec3 tint) {
            float shade = 0.93 + 0.04 * (1.0 - abs(screenUv.y - 0.5) * 2.0);
            return vec4(tint * shade, 1.0);
        }

        vec3 defaultFillThreeStop(float tCore, vec3 inner, vec3 mid, vec3 outer, vec2 screenUv) {
            float s = clamp(tCore, 0.0, 1.0);
            vec3 g = mix(outer, mid, smoothstep(0.0, 0.52, s));
            g = mix(g, inner, smoothstep(0.48, 1.0, s));
            float shade = 0.93 + 0.04 * (1.0 - abs(screenUv.y - 0.5) * 2.0);
            return g * shade;
        }

        vec4 checkerLayer(vec2 pixelUv, vec3 lightRgb, vec3 darkRgb, float lightCellsTransparent) {
            vec2 cells = floor((pixelUv * uResolution) / PIXEL_CELL_SIZE);
            float checker = mod(cells.x + cells.y, 2.0);
            vec3 cellRgb = mix(lightRgb, darkRgb, checker);
            float darkCell = checker;
            float cellAlpha = mix(1.0 - darkCell, darkCell, lightCellsTransparent);
            return vec4(cellRgb, cellAlpha);
        }

        vec4 pixelCrossLayer(vec2 point, vec3 inkRgb) {
            vec2 cellOrigin = floor(point / PIXEL_CELL_SIZE) * PIXEL_CELL_SIZE;
            vec2 p = (point - cellOrigin) / PIXEL_CELL_SIZE;
            float d1 = abs(p.x - p.y);
            float d2 = abs(p.x + p.y - 1.0);
            float dist = min(d1, d2);
            float lineHalf = 0.1;
            float stroke = 1.0 - step(lineHalf, dist);
            return vec4(inkRgb, stroke);
        }

        vec4 halftoneLayer(vec2 point, vec2 screenUv, float groupInfluence, vec3 inkColor, vec3 paperColor, float spacing, float dotMin, float dotMax, float fieldLo, float fieldHi) {
            float angle = radians(24.0);
            mat2 rotation = mat2(cos(angle), -sin(angle), sin(angle), cos(angle));
            vec2 rotatedPoint = rotation * point;
            vec2 cellCenter = floor(rotatedPoint / spacing) * spacing + vec2(spacing * 0.5);
            vec2 local = (rotatedPoint - cellCenter) / spacing;
            float dist = length(local);
            float inkCoverage = clamp((groupInfluence - 0.74) / 0.62, 0.0, 1.0);
            float dotRadiusCore = mix(dotMin, dotMax, inkCoverage);
            float shrinkBand = max(fieldHi - fieldLo, 0.0001);
            float edgeScale = clamp((groupInfluence - fieldLo) / shrinkBand, 0.0, 1.0);
            float r = dotRadiusCore * edgeScale;
            float minVisible = 0.006;
            float allow = step(minVisible, r);
            vec3 paper = paperColor;
            vec3 ink = inkColor;
            float aa = 0.0015;
            float dotMask = (1.0 - smoothstep(r - aa, r + aa, dist)) * allow;
            vec3 color = mix(paper, ink, dotMask);
            return vec4(color, dotMask);
        }

        void main() {
            vec2 point = vUv * uResolution;
            vec2 screenUv = vUv;
            vec2 pixelPoint = floor(point / PIXEL_CELL_SIZE) * PIXEL_CELL_SIZE;
            vec2 pixelUv = pixelPoint / uResolution;
            float totalInfluence[MAX_TAG_GROUPS];
            float pixelInfluence[MAX_TAG_GROUPS];
            bool groupHasFill[MAX_TAG_GROUPS];

            for (int tag = 0; tag < MAX_TAG_GROUPS; tag++) {
                totalInfluence[tag] = 0.0;
                pixelInfluence[tag] = 0.0;
                float styleId = uTagStyleIds[tag];
                groupHasFill[tag] = styleId < 4.5;
            }

            for (int i = 0; i < MAX_BLOBS; i++) {
                if (i >= uBlobCount) {
                    break;
                }

                vec2 delta = point - uBlobPositions[i];
                vec2 pixelDelta = pixelPoint - uBlobPositions[i];
                float radius = max(uBlobRadii[i], 1.0);
                float contribution = (radius * radius) / (dot(delta, delta) + 0.0001);
                float pixelContribution = (radius * radius) / (dot(pixelDelta, pixelDelta) + 0.0001);

                for (int tagIndex = 0; tagIndex < MAX_TAGS_PER_BLOB; tagIndex++) {
                    if (float(tagIndex) >= uBlobTagCounts[i]) {
                        break;
                    }

                    int actualTagIndex = int(getBlobTagIndex(i, tagIndex));

                    if (actualTagIndex < 0 || actualTagIndex >= MAX_TAG_GROUPS) {
                        continue;
                    }

                    totalInfluence[actualTagIndex] += contribution;
                    pixelInfluence[actualTagIndex] += pixelContribution;
                }
            }

            vec3 baseColorSum = vec3(0.0);
            float baseMaskSum = 0.0;
            float maxBaseMask = 0.0;
            vec3 checkerRgb = vec3(0.0);
            float checkerPaintMask = 0.0;
            float checkerSilhouetteMask = 0.0;
            vec4 crossColor = vec4(0.0);
            float crossMask = 0.0;
            vec4 halftoneColor = vec4(0.0);
            float halftoneMask = 0.0;
            float compositeMask = 0.0;

            for (int tag = 0; tag < MAX_TAG_GROUPS; tag++) {
                if (!groupHasFill[tag]) {
                    continue;
                }

                float styleId = uTagStyleIds[tag];
                float groupMask = 0.0;
                vec4 layerColor = vec4(0.0);

                if (styleId < 1.5) {
                    if (styleId < 0.5) {
                        float softDef = smoothstep(uTagFillDefaultLo[tag], uTagFillDefaultHi[tag], totalInfluence[tag]);
                        vec3 fillGrad = defaultFillThreeStop(softDef, uTagDefaultFill[tag], uTagDefaultFillMid[tag], uTagDefaultFillOuter[tag], screenUv);
                        layerColor = vec4(fillGrad, 1.0);
                        groupMask = fillEdgeDither(softDef, point);
                    } else {
                        float softTint = smoothstep(uTagFillTintFillLo[tag], uTagFillTintFillHi[tag], totalInfluence[tag]);
                        vec3 tintGrad = defaultFillThreeStop(softTint, uTagTintDefaultFill[tag], uTagTintDefaultFillMid[tag], uTagTintDefaultFillOuter[tag], screenUv);
                        layerColor = vec4(tintGrad, 1.0);
                        groupMask = fillEdgeDither(softTint, point);
                    }

                    if (groupMask > 0.001) {
                        baseColorSum += layerColor.rgb * groupMask;
                        baseMaskSum += groupMask;
                        maxBaseMask = max(maxBaseMask, groupMask);
                    }
                } else if (styleId < 2.5) {
                    layerColor = checkerLayer(pixelUv, uTagCheckerLight[tag], uTagCheckerDark[tag], uTagFillCheckerLightTransparent[tag]);
                    groupMask = step(uTagFillCheckerPixelThresh[tag], pixelInfluence[tag]);
                    checkerRgb = layerColor.rgb;
                    checkerPaintMask = max(checkerPaintMask, groupMask * layerColor.a);
                    checkerSilhouetteMask = max(checkerSilhouetteMask, groupMask);
                } else if (styleId < 3.5) {
                    layerColor = pixelCrossLayer(point, uTagCrossInk[tag]);
                    groupMask = step(uTagFillCrossPixelThresh[tag], pixelInfluence[tag]);
                    crossColor = layerColor;
                    crossMask = max(crossMask, groupMask * layerColor.a);
                } else if (styleId < 4.5) {
                    layerColor = halftoneLayer(point, screenUv, totalInfluence[tag], uTagHalftoneInk[tag], uTagHalftonePaper[tag], uTagHalftoneSpacing[tag], uTagHalftoneDotMin[tag], uTagHalftoneDotMax[tag], uTagFillHalftoneLo[tag], uTagFillHalftoneHi[tag]);
                    float fieldShell = smoothstep(uTagFillHalftoneLo[tag], uTagFillHalftoneHi[tag], totalInfluence[tag]);
                    float shellD = fillEdgeDither(fieldShell, point);
                    groupMask = max(shellD, layerColor.a);
                    halftoneColor = layerColor;
                    halftoneMask = max(halftoneMask, layerColor.a);
                }

                if (groupMask > 0.001) {
                    compositeMask = max(compositeMask, groupMask);
                }
            }

            vec3 neutralBase = defaultFillLayer(screenUv, vec3(0.97)).rgb;
            vec3 finalRgb = neutralBase;

            if (baseMaskSum > 0.001) {
                vec3 blendedBase = baseColorSum / baseMaskSum;
                finalRgb = mix(neutralBase, blendedBase, clamp(maxBaseMask, 0.0, 1.0));
            }

            if (crossMask > 0.001) {
                finalRgb = mix(finalRgb, crossColor.rgb, clamp(crossMask, 0.0, 1.0));
            }

            if (checkerPaintMask > 0.001) {
                finalRgb = mix(finalRgb, checkerRgb, clamp(checkerPaintMask, 0.0, 1.0));
            }

            if (halftoneMask > 0.001) {
                finalRgb = mix(finalRgb, halftoneColor.rgb, clamp(halftoneMask, 0.0, 1.0));
            }

            vec3 gradMul = mix(uGradientMapA, uGradientMapB, screenUv.y);
            finalRgb = mix(finalRgb, finalRgb * gradMul, clamp(uGradientMapMix, 0.0, 1.0));

            float shapeMask = max(maxBaseMask, max(checkerSilhouetteMask, max(crossMask, halftoneMask)));
            float alpha = compositeMask * shapeMask;

            float grain = hash12(point * 0.71 + vec2(11.0, 29.0));
            finalRgb += (grain - 0.5) * 2.0 * uFilmGrainStrength * clamp(shapeMask, 0.0, 1.0);
            finalRgb = clamp(finalRgb, 0.0, 1.0);

            vec3 color = mix(uBackgroundColor, finalRgb, clamp(alpha, 0.0, 1.0));
            gl_FragColor = vec4(color, 1.0);
        }
    `;
}

let baker = null;

function createBaker(size = TAG_CHIP_EXPORT_SIZE) {
    const uniforms = createMetaballUniforms(size);
    syncTagShaderVisualUniforms(uniforms);
    syncScenePostUniforms(uniforms);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(1);
    renderer.setSize(size, size);

    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const material = new THREE.ShaderMaterial({
        transparent: true,
        uniforms,
        vertexShader: `
            varying vec2 vUv;
            void main() {
                vUv = uv;
                gl_Position = vec4(position.xy, 0.0, 1.0);
            }
        `,
        fragmentShader: buildFragmentShader()
    });

    scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material));

    return { renderer, scene, camera, uniforms, size };
}

function getBaker() {
    if (!baker) {
        baker = createBaker();
    }
    return baker;
}

function isFillTag(tagKey) {
    return tagConfigs[tagKey]?.styleRole === "fill";
}

/** line 태그: 메인 씬 SVG 경계선(arrow / pixel-line / dash)을 그대로 래스터화 */
async function bakeLineTagAsBlob(tagKey, size = TAG_CHIP_EXPORT_SIZE) {
    const visual = getMergedShaderVisual(tagKey);
    const config = {
        ...tagConfigs[tagKey],
        lineStroke: visual.line.stroke,
        chipLineDetailScale: tagChipLineDetailScale[tagKey] ?? 1
    };
    const svg = buildLineTagBoundarySvg(config, size, getTagChipBlobRadius(tagKey));

    return rasterizeSvgToCanvas(svg, size, size);
}

function bakeFillTagWithShader(tagKey, size = TAG_CHIP_EXPORT_SIZE) {
    const { renderer, scene, camera, uniforms } = getBaker();
    const cx = size / 2;
    const cy = size / 2;
    const tagIndex = TAG_INDEX_MAP[tagKey];

    uniforms.uResolution.value.set(size, size);
    uniforms.uBlobCount.value = 1;
    uniforms.uBlobPositions.value[0].set(cx, size - cy);
    uniforms.uBlobRadii.value[0] = getTagChipBlobRadius(tagKey);
    uniforms.uBlobTagCounts.value[0] = 1;
    uniforms.uBlobTagIndices.value[0] = tagIndex;
    uniforms.uBackgroundColor.value.set(TAG_CHIP_BG_HEX);

    renderer.setSize(size, size);
    renderer.render(scene, camera);

    const output = document.createElement("canvas");
    output.width = size;
    output.height = size;

    const ctx = output.getContext("2d");
    ctx.drawImage(renderer.domElement, 0, 0, size, size);
    keyOutBackground(ctx, size, size, parseHexRgb(TAG_CHIP_BG_HEX));

    return output;
}

/** 베이크된 PNG 내용을 중심 기준으로 확대 (캔버스 128px 유지, 가장자리 클립) */
function scaleBakedCanvas(canvas, factor) {
    if (factor === 1) {
        return canvas;
    }

    const size = canvas.width;
    const scaled = document.createElement("canvas");
    scaled.width = size;
    scaled.height = size;

    const ctx = scaled.getContext("2d");
    ctx.clearRect(0, 0, size, size);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.save();
    ctx.translate(size / 2, size / 2);
    ctx.scale(factor, factor);
    ctx.drawImage(canvas, -size / 2, -size / 2, size, size);
    ctx.restore();

    return scaled;
}

/**
 * @param {string} tagKey
 * @param {number} [size]
 * @returns {Promise<HTMLCanvasElement>}
 */
export async function bakeTagChip(tagKey, size = TAG_CHIP_EXPORT_SIZE) {
    let canvas;

    if (isFillTag(tagKey)) {
        canvas = bakeFillTagWithShader(tagKey, size);
    } else {
        canvas = await bakeLineTagAsBlob(tagKey, size);
    }

    return scaleBakedCanvas(canvas, getTagChipExportScale(tagKey));
}

/** @param {string} tagKey */
export async function downloadTagChip(tagKey) {
    const canvas = await bakeTagChip(tagKey);
    canvas.toBlob((blob) => {
        if (!blob) {
            return;
        }

        const url = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = `${tagKey}.png`;
        anchor.click();
        URL.revokeObjectURL(url);
    }, "image/png");
}

/** @returns {Promise<void>} */
export async function downloadAllTagChips() {
    for (const tag of TAG_KEYS) {
        await downloadTagChip(tag);
        await new Promise((resolve) => {
            window.setTimeout(resolve, 180);
        });
    }
}
