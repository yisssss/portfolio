import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.164.1/build/three.module.js";
import {
    getMergedShaderVisual,
    projects,
    scenePostEffects,
    TAG_INDEX_MAP,
    TAG_KEYS,
    TAG_STYLE_IDS,
    tagConfigs,
    viewportPhysics
} from "./data.js";

const {
    Bodies,
    Body,
    Composite,
    Constraint,
    Engine,
    Events,
    Mouse,
    MouseConstraint,
    Query,
    Vector
} = Matter;

const MAX_BLOBS = 24;
const MAX_TAGS_PER_BLOB = 5;
const MAX_TAG_GROUPS = TAG_KEYS.length;
/** 블롭 물리 반지름(px). Matter 원 크기·메타볼 기여도에 직접 영향. */
const BLOB_RADIUS = 48;
/**
 * 보이는 캔버스보다 안쪽에 물리 벽을 둬서, 화면 밖으로 나가기 전에 실제 충돌로 튕기게 만든다.
 * 좌우/하단은 넉넉히, 상단은 헤더 row 위치를 건드리지 않도록 작게 유지.
 */
const WORLD_WALL_INSET_X = BLOB_RADIUS * 2.2;
const WORLD_WALL_INSET_TOP = 22;
const WORLD_WALL_INSET_BOTTOM = BLOB_RADIUS * 2.35;
/**
 * 체크무늬 한 칸의 화면 픽셀 크기(전역). 모든 checkerboard 태그가 같은 격자에 맞춤.
 * (태그마다 다른 격자 크기를 원하면 셰이더에 태그별 uniform을 추가해야 함.)
 */
const PIXEL_CELL_SIZE = 10;
const CLICK_MOVE_THRESHOLD = 8;
const CLICK_TIME_THRESHOLD = 220;
const PHYSICS_TIMESTEP = 1000 / 60;
const CONTOUR_GRID_SIZE = 18;
const CONTOUR_THRESHOLD = 0.9;
const CONTOUR_PADDING = 128;
const BOUNDARY_CLUSTER_DISTANCE = 400;
const TAG_REPULSION_DISTANCE = 500;
const TAG_REPULSION_STRENGTH = 0.00022;

/** 블롭 필터링: displayRadius → targetRadius 보간 속도 */
const FILTER_LERP_SPEED = 0.075;
/** 마스크된 블롭에 주는 미세 분산력 (화면 중앙 척력) */
const FILTER_SCATTER_FORCE = 0.000008;

/** SEJEONG 헤더 글자: 앵커 스프링(Constraint). 낮을수록 흔들림↑(세로 자유도 위해 전체 약화 + 가로만 별도 보강) */
const HEADER_SPRING_STIFFNESS = 0.00105;
const HEADER_SPRING_DAMPING = 0.07;
const HEADER_BODY_FRICTION_AIR = 0.09;
const HEADER_BODY_DENSITY = 0.00024;
/** 앵커 X 방향만 추가 복원(좌우는 상대적으로 더 고정) */
const HEADER_ANCHOR_PULL_X = 0.000055;
/** `applyTagForces`의 블롭과 같은 스케일의 부유·드리프트 */
const HEADER_FLOAT_SCALE = 0.000026;
const HEADER_FLOAT_SCALE_Y = 0.000038;
const HEADER_LETTER_ATTRACTION = 0.0000085;
const HEADER_ORBIT_RADIUS_X = 28;
const HEADER_ORBIT_RADIUS_Y = 52;
const HEADER_INIT_SPEED = 1.35;
const HEADER_INIT_SPEED_Y = 2.05;
const HEADER_DOWNWARD_SOFT_CAP = 0.00009;
const HEADER_BAND_Y_RATIO = 0.34;

/**
 * fillExtents에서 smoothstep(lo,hi,influence) 구간 읽기.
 * 신규: `defaultFillMaskLow`/`High` 또는 구 `defaultMask: [lo,hi]`.
 */
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

/** 1보다 크면 같은 lo에서 hi를 당겨 채워진 영역이 커 보임(더 일찍 불투명). */
function applyMaskExpand(lo, hi, expand) {
    const span = Math.max(hi - lo, 1e-6);
    const e = Math.max(0.12, expand ?? 1);
    return [lo, lo + span / e];
}

const sceneRoot = document.querySelector("#scene-root");
const boundaryLayer = document.querySelector("#boundary-layer");
const dotLayer = document.querySelector("#dot-layer");
const labelLayer = document.querySelector("#label-layer");

const viewport = {
    width: window.innerWidth,
    height: window.innerHeight
};

const engine = Engine.create({
    gravity: {
        x: 0,
        y: 0
    }
});

const state = {
    walls: [],
    blobs: [],
    headerLetters: [],
    boundaryPaths: new Map(),
    boundaryMemory: new Map(),
    activeFilter: null,
    tagThumbnails: {},
    pointer: {
        downAt: 0,
        startX: 0,
        startY: 0,
        isDown: false,
        targetBlob: null,
        targetHeaderHit: null
    }
};

const renderer = new THREE.WebGLRenderer({antialias: true, alpha: true});

renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(viewport.width, viewport.height);
renderer.domElement.setAttribute("aria-label", "2D metaball renderer");
sceneRoot.prepend(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

const metaballUniforms = {
    uResolution: {
        value: new THREE.Vector2(viewport.width, viewport.height)
    },
    uBlobCount: {
        value: 0
    },
    uBlobPositions: {
        value: Array.from(
            {
                length: MAX_BLOBS
            },
            () => new THREE.Vector2(-9999, -9999)
        )
    },
    uBlobRadii: {
        value: new Float32Array(MAX_BLOBS)
    },
    uBlobTagCounts: {
        value: new Float32Array(MAX_BLOBS)
    },
    uBlobTagIndices: {
        value: new Float32Array(MAX_BLOBS * MAX_TAGS_PER_BLOB)
    },
    uTagStyleIds: {
        value: new Float32Array(TAG_STYLE_IDS)
    },
    uTagDefaultFill: {
        value: Array.from(
            {
                length: MAX_TAG_GROUPS
            },
            () => new THREE.Vector3(0.91, 0.89, 0.84)
        )
    },
    uTagDefaultFillMid: {
        value: Array.from(
            {
                length: MAX_TAG_GROUPS
            },
            () => new THREE.Vector3(0.43, 0.35, 0.3)
        )
    },
    uTagDefaultFillOuter: {
        value: Array.from(
            {
                length: MAX_TAG_GROUPS
            },
            () => new THREE.Vector3(0.08, 0.07, 0.06)
        )
    },
    uTagTintDefaultFill: {
        value: Array.from(
            {
                length: MAX_TAG_GROUPS
            },
            () => new THREE.Vector3(0.78, 0.84, 0.91)
        )
    },
    uTagTintDefaultFillMid: {
        value: Array.from(
            {
                length: MAX_TAG_GROUPS
            },
            () => new THREE.Vector3(0.42, 0.55, 0.68)
        )
    },
    uTagTintDefaultFillOuter: {
        value: Array.from(
            {
                length: MAX_TAG_GROUPS
            },
            () => new THREE.Vector3(0.1, 0.15, 0.19)
        )
    },
    uTagCheckerLight: {
        value: Array.from(
            {
                length: MAX_TAG_GROUPS
            },
            () => new THREE.Vector3(0.93, 0.93, 0.93)
        )
    },
    uTagCheckerDark: {
        value: Array.from(
            {
                length: MAX_TAG_GROUPS
            },
            () => new THREE.Vector3(0.08, 0.08, 0.08)
        )
    },
    uTagCrossInk: {
        value: Array.from(
            {
                length: MAX_TAG_GROUPS
            },
            () => new THREE.Vector3(0.17, 0.17, 0.17)
        )
    },
    uTagHalftoneInk: {
        value: Array.from(
            {
                length: MAX_TAG_GROUPS
            },
            () => new THREE.Vector3(0.1, 0.25, 0.76)
        )
    },
    uTagHalftonePaper: {
        value: Array.from(
            {
                length: MAX_TAG_GROUPS
            },
            () => new THREE.Vector3(0.96, 0.95, 0.93)
        )
    },
    uTagFillDefaultLo: {
        value: new Float32Array(MAX_TAG_GROUPS)
    },
    uTagFillDefaultHi: {
        value: new Float32Array(MAX_TAG_GROUPS)
    },
    uTagFillTintFillLo: {
        value: new Float32Array(MAX_TAG_GROUPS)
    },
    uTagFillTintFillHi: {
        value: new Float32Array(MAX_TAG_GROUPS)
    },
    uTagFillCheckerPixelThresh: {
        value: new Float32Array(MAX_TAG_GROUPS)
    },
    uTagFillCheckerLightTransparent: {
        value: new Float32Array(MAX_TAG_GROUPS)
    },
    uTagFillCrossPixelThresh: {
        value: new Float32Array(MAX_TAG_GROUPS)
    },
    uTagFillHalftoneLo: {
        value: new Float32Array(MAX_TAG_GROUPS)
    },
    uTagFillHalftoneHi: {
        value: new Float32Array(MAX_TAG_GROUPS)
    },
    uTagHalftoneSpacing: {
        value: new Float32Array(MAX_TAG_GROUPS)
    },
    uTagHalftoneDotMin: {
        value: new Float32Array(MAX_TAG_GROUPS)
    },
    uTagHalftoneDotMax: {
        value: new Float32Array(MAX_TAG_GROUPS)
    },
    uBlobColor: {
        value: new THREE.Color("#ffffff")
    },
    uBackgroundColor: {
        value: new THREE.Color("#f2f2f2")
    },
    uFilmGrainStrength: {
        value: 2
    },
    uGradientMapA: {
        value: new THREE.Vector3(1, 1, 1)
    },
    uGradientMapB: {
        value: new THREE.Vector3(0.79, 0.75, 0.69)
    },
    uGradientMapMix: {
        value: 0.42
    },
    uFillEdgeDitherMix: {
        value: 0.78
    },
    uFillEdgeDitherBand: {
        value: 0.42
    },
    uFillDitherNoiseAmount: {
        value: 0.32
    }
};

function syncTagShaderVisualUniforms() {
    TAG_KEYS.forEach((key, i) => {
        const {colors, fillExtents} = getMergedShaderVisual(key);
        const setRgb = (arr, hex) => {
            const col = new THREE.Color(hex);
            arr[i].set(col.r, col.g, col.b);
        };

        setRgb(metaballUniforms.uTagDefaultFill.value, colors.defaultFill);
        setRgb(metaballUniforms.uTagDefaultFillMid.value, colors.defaultFillMid ?? colors.defaultFill);
        setRgb(metaballUniforms.uTagDefaultFillOuter.value, colors.defaultFillOuter ?? colors.defaultFill);
        setRgb(metaballUniforms.uTagTintDefaultFill.value, colors.tintDefaultFill);
        setRgb(metaballUniforms.uTagTintDefaultFillMid.value, colors.tintDefaultFillMid ?? colors.tintDefaultFill);
        setRgb(metaballUniforms.uTagTintDefaultFillOuter.value, colors.tintDefaultFillOuter ?? colors.tintDefaultFill);
        setRgb(metaballUniforms.uTagCheckerLight.value, colors.checkerLight);
        setRgb(metaballUniforms.uTagCheckerDark.value, colors.checkerDark);
        setRgb(metaballUniforms.uTagCrossInk.value, colors.crossInk);
        setRgb(metaballUniforms.uTagHalftoneInk.value, colors.halftoneInk);
        setRgb(metaballUniforms.uTagHalftonePaper.value, colors.halftonePaper);

        const [defLo, defHi0] = readInfluenceMaskPair(fillExtents, "defaultMask", "defaultFillMaskLow", "defaultFillMaskHigh", 0.5, 5.5,);
        const [defLo2, defHi2] = applyMaskExpand(defLo, defHi0, fillExtents.defaultFillExpand);
        metaballUniforms.uTagFillDefaultLo.value[i] = defLo2;
        metaballUniforms.uTagFillDefaultHi.value[i] = defHi2;

        const [tLo, tHi0] = readInfluenceMaskPair(fillExtents, "tintFillMask", "tintFillMaskLow", "tintFillMaskHigh", 0.92, 5.2,);
        const [tLo2, tHi2] = applyMaskExpand(tLo, tHi0, fillExtents.tintFillExpand);
        metaballUniforms.uTagFillTintFillLo.value[i] = tLo2;
        metaballUniforms.uTagFillTintFillHi.value[i] = tHi2;

        metaballUniforms.uTagFillCheckerPixelThresh.value[i] = fillExtents.checkerPixelThreshold;
        metaballUniforms.uTagFillCheckerLightTransparent.value[i] = fillExtents.checkerLightTransparent !== false
            ? 1
            : 0;
        metaballUniforms.uTagFillCrossPixelThresh.value[i] = fillExtents.crossPixelThreshold;

        const [hLo, hHi0] = readInfluenceMaskPair(fillExtents, "halftoneMask", "halftoneMaskLow", "halftoneMaskHigh", 0.78, 1.18,);
        const [hLo2, hHi2] = applyMaskExpand(hLo, hHi0, fillExtents.halftoneExpand);
        metaballUniforms.uTagFillHalftoneLo.value[i] = hLo2;
        metaballUniforms.uTagFillHalftoneHi.value[i] = hHi2;
        metaballUniforms.uTagHalftoneSpacing.value[i] = fillExtents.halftoneSpacing;
        metaballUniforms.uTagHalftoneDotMin.value[i] = fillExtents.halftoneDotRadiusMin;
        metaballUniforms.uTagHalftoneDotMax.value[i] = fillExtents.halftoneDotRadiusMax;
    });
}

function syncScenePostUniforms() {
    const p = scenePostEffects;
    metaballUniforms.uFilmGrainStrength.value = p.filmGrainStrength ?? 0;
    metaballUniforms.uGradientMapMix.value = p.gradientMapMix ?? 0;
    metaballUniforms.uFillEdgeDitherMix.value = p.fillEdgeDitherMix ?? 0;
    metaballUniforms.uFillEdgeDitherBand.value = Math.max(0.001, p.fillEdgeDitherBand ?? 0.35);
    metaballUniforms.uFillDitherNoiseAmount.value = p.fillDitherNoiseAmount ?? 0;
    const colorA = new THREE.Color(p.gradientMapColorA ?? "#ffffff");
    const colorB = new THREE.Color(p.gradientMapColorB ?? "#ffffff");
    metaballUniforms.uGradientMapA.value.set(colorA.r, colorA.g, colorA.b);
    metaballUniforms.uGradientMapB.value.set(colorB.r, colorB.g, colorB.b);
}

syncTagShaderVisualUniforms();
syncScenePostUniforms();

const metaballMaterial = new THREE.ShaderMaterial({transparent: true, uniforms: metaballUniforms, vertexShader: `
        varying vec2 vUv;

        void main() {
            vUv = uv;
            gl_Position = vec4(position.xy, 0.0, 1.0);
        }
    `, fragmentShader: `
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
            vec2 point = vec2(gl_FragCoord.x, gl_FragCoord.y);
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

            if (checkerPaintMask > 0.001) {
                finalRgb = mix(finalRgb, checkerRgb, clamp(checkerPaintMask, 0.0, 1.0));
            }

            if (crossMask > 0.001) {
                finalRgb = mix(finalRgb, crossColor.rgb, clamp(crossMask, 0.0, 1.0));
            }

            if (halftoneMask > 0.001) {
                finalRgb = mix(finalRgb, halftoneColor.rgb, clamp(halftoneMask, 0.0, 1.0));
            }

            vec3 gradMul = mix(uGradientMapA, uGradientMapB, screenUv.y);
            finalRgb = mix(finalRgb, finalRgb * gradMul, clamp(uGradientMapMix, 0.0, 1.0));

            float shapeMask = max(maxBaseMask, max(checkerSilhouetteMask, max(crossMask, halftoneMask)));
            float alpha = compositeMask * shapeMask;

            float grain = hash12(gl_FragCoord.xy * 0.71 + vec2(11.0, 29.0));
            finalRgb += (grain - 0.5) * 2.0 * uFilmGrainStrength * clamp(shapeMask, 0.0, 1.0);
            finalRgb = clamp(finalRgb, 0.0, 1.0);

            vec3 color = mix(uBackgroundColor, finalRgb, clamp(alpha, 0.0, 1.0));
            gl_FragColor = vec4(color, 1.0);
        }
    `});

const metaballPlane = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), metaballMaterial);
scene.add(metaballPlane);

initBoundaries();
initWorld();
initBlobs();
initLabels();
initMouse();
initSiteChrome();
scheduleInitHeaderPhysics();

let lastFrame = performance.now();
requestAnimationFrame(animate);

function initWorld() {
    rebuildWalls();

    Events.on(engine, "beforeUpdate", (event) => {
        applyTagForces(event.timestamp);
        applyViewportCenterAttraction();
        applyInterGroupRepulsion();
        applyHeaderLetterDrift(event.timestamp);
        applyHeaderLetterAnchorPullX();
        applyHeaderLetterSoftBandPull();
    });

    window.addEventListener("resize", handleResize);
    window.addEventListener("load", () => {
        if (state.headerLetters.length === 0) {
            scheduleInitHeaderPhysics();
        }
    });
}

function initBlobs() {
    const columns = 3;
    const spacingX = viewport.width / (columns + 1);
    const rows = Math.ceil(projects.length / columns);
    const spacingY = viewport.height / (rows + 1);

    projects.forEach((project, index) => {
        const col = index % columns;
        const row = Math.floor(index / columns);
        const x = spacingX * (col + 1) + randomBetween(-60, 60);
        const y = spacingY * (row + 1) + randomBetween(-45, 45);

        const body = Bodies.circle(x, y, BLOB_RADIUS, {
            frictionAir: 0.016,
            restitution: 0.94,
            friction: 0.0001,
            density: 0.0012,
            render: {
                visible: false
            }
        });

        body.plugin.project = project;
        Composite.add(engine.world, body);

        state.blobs.push({
            project,
            body,
            dotEl: null,
            labelEl: null,
            displayRadius: BLOB_RADIUS,
            targetRadius: BLOB_RADIUS,
            isMasked: false
        });
    });
}

function initLabels() {
    state.blobs.forEach((blob) => {
        const dot = document.createElement("div");
        const label = document.createElement("div");
        const title = document.createElement("strong");
        const subtitle = document.createElement("span");

        dot.className = "blob-dot";
        label.className = "blob-label";
        title.textContent = blob.project.title;
        subtitle.textContent = blob.project.subtitle || "";

        dotLayer.append(dot);
        label.append(title, ...(blob.project.subtitle ? [subtitle] : []));
        labelLayer.append(label);
        blob.dotEl = dot;
        blob.labelEl = label;
    });
}

function initBoundaries() {
    boundaryLayer.setAttribute("viewBox", `0 0 ${
        viewport.width
    } ${
        viewport.height
    }`);
    boundaryLayer.setAttribute("preserveAspectRatio", "none");

    getAllTags().forEach((tag) => {
        const group = document.createElementNS("http://www.w3.org/2000/svg", "g");

        group.setAttribute("data-tag", tag);
        boundaryLayer.append(group);
        state.boundaryPaths.set(tag, group);
        state.boundaryMemory.set(tag, {lastGoodContours: []});
    });
}

function initMouse() {
    const mouse = Mouse.create(renderer.domElement);
    const mouseConstraint = MouseConstraint.create(engine, {
        mouse,
        constraint: {
            stiffness: 0.22,
            damping: 0.09,
            angularStiffness: 0,
            render: {
                visible: false
            }
        }
    });

    Composite.add(engine.world, mouseConstraint);

    // Matter.js의 스크롤 차단 이벤트 핸들러 전부 제거 후 passive로 재등록
    renderer.domElement.removeEventListener("mousewheel", mouse.mousewheel);
    renderer.domElement.removeEventListener("DOMMouseScroll", mouse.mousewheel);

    // touchmove: passive:false + preventDefault()가 트랙패드 스크롤까지 차단 → passive로 재등록
    renderer.domElement.removeEventListener("touchmove", mouse.touchmove);
    renderer.domElement.addEventListener("touchmove", mouse.touchmove, { passive: true });

    // canvas 위에서의 wheel 이벤트를 window 스크롤로 수동 전달
    renderer.domElement.addEventListener("wheel", (e) => {
        e.preventDefault();
        window.scrollBy({ top: e.deltaY, left: e.deltaX });
    }, { passive: false });

    renderer.domElement.addEventListener("pointermove", (event) => {
        updateLabelHoverState(toScenePoint(event));
    });

    renderer.domElement.addEventListener("pointerdown", (event) => {
        const point = toScenePoint(event);
        const hit = getBlobAtPoint(point);
        const headerHit = getHeaderLetterAtPoint(point);

        state.pointer.isDown = true;
        state.pointer.downAt = performance.now();
        state.pointer.startX = event.clientX;
        state.pointer.startY = event.clientY;
        state.pointer.targetBlob = hit;
        state.pointer.targetHeaderHit = headerHit;
    });

    renderer.domElement.addEventListener("pointerup", (event) => {
        if (! state.pointer.isDown) {
            return;
        }

        const elapsed = performance.now() - state.pointer.downAt;
        const distance = Math.hypot(event.clientX - state.pointer.startX, event.clientY - state.pointer.startY,);

        const point = toScenePoint(event);
        const releaseHeader = getHeaderLetterAtPoint(point);
        const releaseHit = getBlobAtPoint(point);

        if (elapsed <= CLICK_TIME_THRESHOLD && distance <= CLICK_MOVE_THRESHOLD && releaseHeader && state.pointer.targetHeaderHit && releaseHeader.id === state.pointer.targetHeaderHit.id) {
            window.location.hash = "#about";
            resetPointerState();
            return;
        }

        if (elapsed <= CLICK_TIME_THRESHOLD && distance <= CLICK_MOVE_THRESHOLD && releaseHit && state.pointer.targetBlob && releaseHit.project.id === state.pointer.targetBlob.project.id) {
            window.location.href = releaseHit.project.url;
        }

        resetPointerState();
    });

    renderer.domElement.addEventListener("pointerleave", () => {
        updateLabelHoverState(null);
        resetPointerState();
    });
    renderer.domElement.addEventListener("pointercancel", () => {
        updateLabelHoverState(null);
        resetPointerState();
    });
}

function animate(now) {
    const delta = Math.min(now - lastFrame, 32);
    lastFrame = now;

    Engine.update(engine, delta || PHYSICS_TIMESTEP);
    lerpBlobRadii();
    syncMetaballs();
    syncLabels();
    syncHeaderLetters();
    syncBoundaries();
    renderer.render(scene, camera);

    requestAnimationFrame(animate);
}

function syncMetaballs() {
    metaballUniforms.uBlobCount.value = Math.min(state.blobs.length, MAX_BLOBS);
    metaballUniforms.uTagStyleIds.value.set(TAG_STYLE_IDS);

    for (let i = 0; i < MAX_BLOBS; i += 1) {
        const blob = state.blobs[i];
        metaballUniforms.uBlobTagCounts.value[i] = 0;

        if (! blob) {
            metaballUniforms.uBlobPositions.value[i].set(-9999, -9999);
            metaballUniforms.uBlobRadii.value[i] = 0;
            for (let tagIndex = 0; tagIndex < MAX_TAGS_PER_BLOB; tagIndex += 1) {
                metaballUniforms.uBlobTagIndices.value[i * MAX_TAGS_PER_BLOB + tagIndex] = -1;
            }
            continue;
        }

        metaballUniforms.uBlobPositions.value[i].set(blob.body.position.x, viewport.height - blob.body.position.y,);
        metaballUniforms.uBlobRadii.value[i] = blob.displayRadius;

        const tagIndices = blob.project.tags
            .slice(0, MAX_TAGS_PER_BLOB)
            .map((tag) => TAG_INDEX_MAP[tag] ?? -1);

        metaballUniforms.uBlobTagCounts.value[i] = tagIndices.length;

        for (let tagIndex = 0; tagIndex < MAX_TAGS_PER_BLOB; tagIndex += 1) {
            metaballUniforms.uBlobTagIndices.value[i * MAX_TAGS_PER_BLOB + tagIndex] = tagIndices[tagIndex] ?? -1;
        }
    }
}

const LABEL_CORNER_GAP = 8;

function syncLabels() {
    state.blobs.forEach((blob) => {
        const visible = blob.displayRadius > 1.5;
        const opacity = visible ? String(Math.min(1, (blob.displayRadius - 1.5) / (BLOB_RADIUS * 0.18))) : "0";

        blob.dotEl.style.opacity = opacity;
        blob.dotEl.style.left = `${blob.body.position.x}px`;
        blob.dotEl.style.top = `${blob.body.position.y}px`;

        const r = blob.body.circleRadius;
        blob.labelEl.style.left = `${blob.body.position.x + r + LABEL_CORNER_GAP}px`;
        blob.labelEl.style.top = `${blob.body.position.y + r + LABEL_CORNER_GAP}px`;
        blob.labelEl.style.opacity = blob.labelEl.classList.contains("blob-label--hover") && visible
            ? "1"
            : blob.labelEl.classList.contains("blob-label--hover") ? opacity : "";
    });
}

function updateLabelHoverState(point) {
    const hit = point
        ? getBlobAtPoint(point)
        : null;

    labelLayer.classList.toggle("label-layer--hover", Boolean(hit));

    state.blobs.forEach((blob) => {
        const on = Boolean(hit && hit.project.id === blob.project.id);

        blob.labelEl.classList.toggle("blob-label--hover", on);
    });
}

function destroyHeaderPhysics() {
    if (!state.headerLetters.length) {
        return;
    }

    state.headerLetters.forEach(({body, constraint}) => {
        Composite.remove(engine.world, constraint);
        Composite.remove(engine.world, body);
    });
    state.headerLetters.length = 0;
}

function scheduleInitHeaderPhysics() {
    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            initHeaderPhysics();
        });
    });
}

/**
 * 헤더 SEJEONG: 초기 정렬 좌표에 월드 고정점(pointA) + Constraint로 바디를 연결.
 * 마우스로 끌어도 제약은 유지되며, 놓으면 스프링으로 앵커 근처로 복귀.
 */
function initHeaderPhysics() {
    destroyHeaderPhysics();

    const layer = document.querySelector("#header-letter-layer");
    const row = layer?.querySelector(".header-letter-row");

    if (!layer || !row) {
        return;
    }

    const wraps = [...row.querySelectorAll(".header-letter-wrap")];

    if (!wraps.length) {
        return;
    }

    wraps.forEach((wrap) => {
        wrap.style.position = "";
        wrap.style.left = "";
        wrap.style.top = "";
        wrap.style.transform = "";
    });
    void row.offsetHeight;

    const canvasRect = renderer.domElement.getBoundingClientRect();

    const placements = wraps.map((wrap) => {
        const r = wrap.getBoundingClientRect();

        return {
            wrap,
            cx: r.left + r.width * 0.5 - canvasRect.left,
            cy: r.top + r.height * 0.5 - canvasRect.top,
            w: Math.max(12, r.width * 0.9),
            h: Math.max(12, r.height * 0.9)
        };
    }).filter((p) => p.w > 0 && p.h > 0);

    placements.forEach(({wrap, cx, cy, w, h}) => {
        wrap.style.position = "absolute";
        wrap.style.left = `${cx}px`;
        wrap.style.top = `${cy}px`;
        wrap.style.transform = "translate(-50%, -50%)";

        const body = Bodies.rectangle(cx, cy, w, h, {
            frictionAir: HEADER_BODY_FRICTION_AIR,
            friction: 0.14,
            restitution: 0.42,
            density: HEADER_BODY_DENSITY,
            chamfer: {
                radius: 5
            },
            render: {
                visible: false
            },
            plugin: {
                headerLetter: true
            }
        });

        const constraint = Constraint.create({
            pointA: {
                x: cx,
                y: cy
            },
            bodyB: body,
            pointB: {
                x: 0,
                y: 0
            },
            stiffness: HEADER_SPRING_STIFFNESS,
            damping: HEADER_SPRING_DAMPING,
            length: 0
        });

        Composite.add(engine.world, body);
        Composite.add(engine.world, constraint);
        Body.setVelocity(body, {
            x: randomBetween(-HEADER_INIT_SPEED, HEADER_INIT_SPEED),
            y: randomBetween(-HEADER_INIT_SPEED_Y, HEADER_INIT_SPEED_Y)
        });
        Body.setAngularVelocity(body, randomBetween(-0.055, 0.055));
        state.headerLetters.push({body, constraint, wrap});
    });
}

function syncHeaderLetters() {
    state.headerLetters.forEach(({body, wrap}) => {
        wrap.style.left = `${body.position.x}px`;
        wrap.style.top = `${body.position.y}px`;
        wrap.style.transform = `translate(-50%, -50%) rotate(${body.angle}rad)`;
    });
}

function applyHeaderLetterDrift(time) {
    const members = state.headerLetters;

    if (!members.length) {
        return;
    }

    const centroid = members.reduce(
        (acc, {body}) => {
            acc.x += body.position.x;
            acc.y += body.position.y;
            return acc;
        },
        {
            x: 0,
            y: 0
        }
    );

    centroid.x /= members.length;
    centroid.y /= members.length;

    const orbitTarget = {
        x: centroid.x + Math.cos(time * 0.00042 + 0.9) * HEADER_ORBIT_RADIUS_X,
        y: centroid.y + Math.sin(time * 0.00037 + 1.15) * HEADER_ORBIT_RADIUS_Y
    };

    members.forEach((item, memberIndex) => {
        const blob = item.body;
        const towardCenter = Vector.sub(centroid, blob.position);
        const towardOrbitTarget = Vector.sub(orbitTarget, blob.position);
        const distance = Vector.magnitude(towardCenter);
        const orbitDistance = Vector.magnitude(towardOrbitTarget);

        if (distance > 1) {
            const normalized = Vector.normalise(towardCenter);
            const centroidScale = clamp(distance / 170, 0.22, 1.55);
            const fCent = Vector.mult(normalized, HEADER_LETTER_ATTRACTION * blob.mass * centroidScale);

            fCent.x *= 1.12;
            fCent.y *= 0.58;
            Body.applyForce(blob, blob.position, fCent);
        }

        if (orbitDistance > 1) {
            const orbitDirection = Vector.normalise(towardOrbitTarget);
            const orbitScale = clamp(orbitDistance / 140, 0.18, 1.25);
            const fOrb = Vector.mult(orbitDirection, HEADER_LETTER_ATTRACTION * blob.mass * orbitScale);

            fOrb.x *= 1.08;
            fOrb.y *= 0.55;
            Body.applyForce(blob, blob.position, fOrb);
        }

        const driftAngle = time * 0.00032 + memberIndex * 0.73;
        const drift = {
            x: Math.cos(driftAngle) * HEADER_FLOAT_SCALE * blob.mass,
            y: Math.sin(driftAngle * 1.13) * HEADER_FLOAT_SCALE_Y * blob.mass
        };

        Body.applyForce(blob, blob.position, drift);

        if (distance > 1) {
            const tangent = {
                x: -towardCenter.y / distance,
                y: towardCenter.x / distance
            };
            const swirl = Math.sin(time * 0.0007 + memberIndex * 0.61);

            Body.applyForce(blob, blob.position, Vector.mult(tangent, HEADER_FLOAT_SCALE * blob.mass * 0.95 * swirl));
        }

        Body.setAngularVelocity(blob, blob.angularVelocity * 0.988);
    });
}

/** 좌우만 앵커에 더 강하게 붙도록 보조(세로는 Constraint·스프링에 더 맡김) */
function applyHeaderLetterAnchorPullX() {
    if (!state.headerLetters.length) {
        return;
    }

    state.headerLetters.forEach(({body, constraint}) => {
        const ax = constraint.pointA.x;
        const dx = ax - body.position.x;
        const mass = body.mass;

        if (Math.abs(dx) < 0.35) {
            return;
        }

        Body.applyForce(body, body.position, {
            x: dx * HEADER_ANCHOR_PULL_X * mass,
            y: 0
        });
    });
}

/** 상단 헤더 밴드 아래로 과도하게 내려가면 앵커 방향 추가 복원력(스프링만으로는 느릴 때 보조) */
function applyHeaderLetterSoftBandPull() {
    if (!state.headerLetters.length) {
        return;
    }

    const yMax = viewport.height * HEADER_BAND_Y_RATIO;

    state.headerLetters.forEach(({body, constraint}) => {
        const ay = constraint.pointA.y;

        if (body.position.y <= Math.max(yMax, ay + 128)) {
            return;
        }

        const ax = constraint.pointA.x;
        const dx = ax - body.position.x;
        const dy = ay - body.position.y;
        const mass = body.mass;
        const pull = HEADER_DOWNWARD_SOFT_CAP * mass;

        Body.applyForce(body, body.position, {
            x: dx * pull * 0.4,
            y: dy * pull * 0.58
        });
    });
}

function syncBoundaries() {
    getAllTags().forEach((tag) => {
        const group = state.boundaryPaths.get(tag);
        const members = state.blobs.filter((blob) => blob.project.tags.includes(tag) && !blob.isMasked);
        const visual = getMergedShaderVisual(tag);
        const config = {
            ...tagConfigs[tag],
            lineStroke: visual.line.stroke
        };

        if (! group || members.length === 0) {
            return;
        }

        const clusters = getBoundaryClusters(members);
        const contours = clusters.flatMap((cluster) => buildMetaballContours(cluster, config));
        const stableContours = stabilizeBoundaryContours(tag, contours);

        renderBoundaryContours(group, stableContours, config);
    });
}

function applyTagForces(time) {
    getAllTags().forEach((tag, tagIndex) => {
        const members = state.blobs.filter((blob) => blob.project.tags.includes(tag) && !blob.isMasked);
        const config = tagConfigs[tag];

        if (members.length === 0) {
            return;
        }

        const centroid = members.reduce((acc, blob) => {
            acc.x += blob.body.position.x;
            acc.y += blob.body.position.y;
            return acc;
        }, {
            x: 0,
            y: 0
        },);

        centroid.x /= members.length;
        centroid.y /= members.length;

        const orbitTarget = {
            x: centroid.x + Math.cos(time * 0.00042 + tagIndex * 1.37) * 78,
            y: centroid.y + Math.sin(time * 0.00037 + tagIndex * 1.91) * 62
        };

        members.forEach((blob, memberIndex) => {
            const towardCenter = Vector.sub(centroid, blob.body.position);
            const towardOrbitTarget = Vector.sub(orbitTarget, blob.body.position);
            const distance = Vector.magnitude(towardCenter);
            const orbitDistance = Vector.magnitude(towardOrbitTarget);

            if (distance > 1) {
                const normalized = Vector.normalise(towardCenter);
                const centroidScale = clamp(distance / 170, 0.22, 1.55);
                Body.applyForce(blob.body, blob.body.position, Vector.mult(normalized, config.attraction * blob.body.mass * centroidScale),);
            }

            if (orbitDistance > 1) {
                const orbitDirection = Vector.normalise(towardOrbitTarget);
                const orbitScale = clamp(orbitDistance / 140, 0.18, 1.25);
                Body.applyForce(blob.body, blob.body.position, Vector.mult(orbitDirection, config.attraction * blob.body.mass * orbitScale),);
            }

            const driftAngle = (time * 0.00032) + tagIndex * 1.7 + memberIndex * 0.73;
            const drift = {
                x: Math.cos(driftAngle) * config.floatScale * blob.body.mass,
                y: Math.sin(driftAngle * 1.13) * config.floatScale * blob.body.mass
            };

            Body.applyForce(blob.body, blob.body.position, drift);

            if (distance > 1) {
                const tangent = {
                    x: - towardCenter.y / distance,
                    y: towardCenter.x / distance
                };
                const swirl = Math.sin(time * 0.0007 + memberIndex * 0.61 + tagIndex * 0.48);
                Body.applyForce(blob.body, blob.body.position, Vector.mult(tangent, config.floatScale * blob.body.mass * 0.95 * swirl),);
            }
        });

        // Overlapping tags can weaken centroid pull visually, so add a small same-group pairwise cohesion.
        for (let i = 0; i < members.length; i += 1) {
            for (let j = i + 1; j < members.length; j += 1) {
                const a = members[i].body;
                const b = members[j].body;
                const delta = Vector.sub(b.position, a.position);
                const distance = Vector.magnitude(delta);

                if (distance <= 0 || distance > 340) {
                    continue;
                }

                const strength = config.attraction * clamp(distance / 210, 0.16, 1.45);
                const direction = Vector.normalise(delta);
                const force = Vector.mult(direction, strength * Math.min(a.mass, b.mass));

                Body.applyForce(a, a.position, force);
                Body.applyForce(b, b.position, Vector.neg(force));
            }
        }
    });
}

function applyViewportCenterAttraction() {
    const cx = viewport.width * 0.5;
    const cy = viewport.height * 0.5;
    const pull = viewportPhysics.centerPull;

    state.blobs.forEach((blob) => {
        if (blob.isMasked) {
            return;
        }
        const dx = cx - blob.body.position.x;
        const dy = cy - blob.body.position.y;
        const dist = Math.hypot(dx, dy);

        if (dist < 2) {
            return;
        }

        const scale = clamp(dist / 420, 0.16, 1);
        const mass = blob.body.mass;
        Body.applyForce(blob.body, blob.body.position, {
            x: dx / dist * pull * mass * scale,
            y: dy / dist * pull * mass * scale
        });
    });
}

/**
 * 태그 겹침이 약할수록 1에 가깝다. 양쪽 모두 같은 태그만 쓰면 0(반발 없음).
 * 겹침 정도는 `공통 태그 수 / 각 프로젝트 태그 수` 중 더 작은 값(낮은 쪽)으로 본다.
 */
function tagOverlapRepulsionFactor(tagsA, tagsB) {
    if (tagsA.length === 0 || tagsB.length === 0) {
        return 1;
    }

    const setB = new Set(tagsB);
    let inter = 0;

    for (let k = 0; k < tagsA.length; k += 1) {
        if (setB.has(tagsA[k])) {
            inter += 1;
        }
    }

    const ratioA = inter / tagsA.length;
    const ratioB = inter / tagsB.length;
    const overlapDegree = Math.min(ratioA, ratioB);

    return 1 - overlapDegree;
}

function applyInterGroupRepulsion() {
    for (let i = 0; i < state.blobs.length; i += 1) {
        for (let j = i + 1; j < state.blobs.length; j += 1) {
            const a = state.blobs[i];
            const b = state.blobs[j];

            if (a.isMasked || b.isMasked) {
                continue;
            }

            const repulsionFactor = tagOverlapRepulsionFactor(a.project.tags, b.project.tags);

            if (repulsionFactor < 0.00001) {
                continue;
            }

            const delta = Vector.sub(b.body.position, a.body.position);
            const distance = Vector.magnitude(delta);

            if (distance <= 0 || distance > TAG_REPULSION_DISTANCE) {
                continue;
            }

            const direction = Vector.normalise(delta);
            const falloff = clamp((TAG_REPULSION_DISTANCE - distance) / TAG_REPULSION_DISTANCE, 0.2, 1.45);
            const strength = TAG_REPULSION_STRENGTH * Math.min(a.body.mass, b.body.mass) * falloff * falloff * repulsionFactor;
            const force = Vector.mult(direction, strength);

            Body.applyForce(a.body, a.body.position, Vector.neg(force));
            Body.applyForce(b.body, b.body.position, force);
        }
    }
}

function rebuildWalls() {
    if (state.walls.length) {
        Composite.remove(engine.world, state.walls);
    }

    const thickness = 180;
    const leftX = WORLD_WALL_INSET_X;
    const rightX = viewport.width - WORLD_WALL_INSET_X;
    const topY = WORLD_WALL_INSET_TOP;
    const bottomY = viewport.height - WORLD_WALL_INSET_BOTTOM;
    const wallOptions = {
        isStatic: true
    };
    state.walls = [
        Bodies.rectangle(viewport.width / 2, topY - thickness / 2, viewport.width + thickness * 2, thickness, wallOptions),
        Bodies.rectangle(viewport.width / 2, bottomY + thickness / 2, viewport.width + thickness * 2, thickness, wallOptions),
        Bodies.rectangle(leftX - thickness / 2, viewport.height / 2, thickness, viewport.height + thickness * 2, wallOptions),
        Bodies.rectangle(rightX + thickness / 2, viewport.height / 2, thickness, viewport.height + thickness * 2, wallOptions),
    ];

    Composite.add(engine.world, state.walls);
}

function handleResize() {
    viewport.width = window.innerWidth;
    viewport.height = window.innerHeight;

    destroyHeaderPhysics();

    renderer.setSize(viewport.width, viewport.height);
    metaballUniforms.uResolution.value.set(viewport.width, viewport.height);
    boundaryLayer.setAttribute("viewBox", `0 0 ${
        viewport.width
    } ${
        viewport.height
    }`);
    rebuildWalls();
    scheduleInitHeaderPhysics();
}

function getBlobAtPoint(point) {
    const bodies = state.blobs.map((blob) => blob.body);
    const [hitBody] = Query.point(bodies, point);

    if (!hitBody) {
        return null;
    }

    return state.blobs.find((blob) => blob.body.id === hitBody.id) ?? null;
}

function toScenePoint(event) {
    const rect = renderer.domElement.getBoundingClientRect();
    return {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top
    };
}

function resetPointerState() {
    state.pointer.isDown = false;
    state.pointer.targetBlob = null;
    state.pointer.targetHeaderHit = null;
}

function getHeaderLetterAtPoint(point) {
    if (!state.headerLetters.length) {
        return null;
    }

    const bodies = state.headerLetters.map((item) => item.body);
    const [hitBody] = Query.point(bodies, point);

    return hitBody ?? null;
}


function formatTagLabel(tag) {
    return tag.replace(/-/g, " ");
}


function initTagRail() {
    const SCROLL_ARROW_SVG = "./assets/svg/scroll arrow.svg";
    const root = document.getElementById("tag-rail-chips");

    if (!root) {
        return;
    }

    root.replaceChildren();

    const makeFilterChip = (tag, label) => {
        const btn = document.createElement("button");

        btn.type = "button";
        btn.className = "tag-rail__chip" + (tag === "all" ? " tag-rail__chip--active" : "");
        btn.textContent = label;
        btn.dataset.tag = tag;
        btn.addEventListener("click", () => setFilter(tag));
        return btn;
    };

    root.append(makeFilterChip("all", "all"));
    TAG_KEYS.forEach((tag) => root.append(makeFilterChip(tag, formatTagLabel(tag))));

    const scrollBtn = document.createElement("button");

    scrollBtn.type = "button";
    scrollBtn.className = "tag-rail__chip tag-rail__chip--scroll";
    scrollBtn.setAttribute("aria-label", "오른쪽으로 스크롤");

    const scrollImg = document.createElement("img");

    scrollImg.className = "tag-rail__scroll-img";
    scrollImg.src = SCROLL_ARROW_SVG;
    scrollImg.alt = "";
    scrollImg.decoding = "async";
    scrollBtn.append(scrollImg);
    root.append(scrollBtn);

    scrollBtn.addEventListener("click", () => {
        if (root.scrollWidth > root.clientWidth) {
            root.scrollBy({
                left: Math.min(200, root.scrollWidth - root.clientWidth - root.scrollLeft),
                behavior: "smooth"
            });
        }
    });

    updateTagChipActiveState(null);
}

function initSiteChrome() {
    initTagRail();
    generateTagThumbnails();
    initWorkGrid();
    initScrollBehavior();
}

function getAllTags() {
    return Object.keys(tagConfigs);
}

function getBoundaryClusters(members) {
    if (members.length<= 1) {
        return [members];
    }

    const visited = new Set();
    const clusters = [];

    for (let i = 0; i < members.length; i += 1) {
        if (visited.has(i)) {
            continue;
        }

        const queue = [i];
        const cluster = [];
        visited.add(i);

        while (queue.length) {
            const currentIndex = queue.shift();
            const current = members[currentIndex];

            cluster.push(current);

            for (let j = 0; j < members.length; j += 1) {
                if (visited.has(j)) {
                    continue;
                }

                const next = members[j];
                const linkDistance = getBoundaryLinkDistance(current, next);

                if (distanceBetween(current.body.position, next.body.position) <= linkDistance) {
                    visited.add(j);
                    queue.push(j);
                }
            }
        }

        clusters.push(cluster);
    }

    return clusters.sort((a, b) => b.length - a.length);
}

function stabilizeBoundaryContours(tag, contours) {
    const memory = ensureBoundaryMemory(tag);

    if (contours.length > 0) {
        memory.lastGoodContours = contours;
        return contours;
    }

    return memory.lastGoodContours ?? [];
}

function ensureBoundaryMemory(tag) {
    if (!state.boundaryMemory.has(tag)) {
        state.boundaryMemory.set(tag, {
            lastGoodContours: [], });
    }

    return state.boundaryMemory.get(tag);
}

function getBlobCentroid(blobs) {
    if (!blobs.length) {
        return null;
    }

    const centroid = blobs.reduce(
        (acc, blob) => {
            acc.x += blob.body.position.x;
            acc.y += blob.body.position.y;
            return acc;
        }, { x: 0, y: 0 }, );

    centroid.x /= blobs.length;
    centroid.y /= blobs.length;
    return centroid;
}

function buildMetaballContours(members, config) {
    if (members.length === 1) {
        return [buildCircleContour(members[0], config)];
    }

    const bounds = getMetaballBounds(members, config);
    const cols = Math.max(3, Math.ceil((bounds.maxX - bounds.minX) / CONTOUR_GRID_SIZE) + 1);
    const rows = Math.max(3, Math.ceil((bounds.maxY - bounds.minY) / CONTOUR_GRID_SIZE) + 1);
    const field = Array.from({ length: rows }, () => Array(cols).fill(0)) 
    

    for (let row = 0; row < rows; row += 1) {
        const y = bounds.minY + row * CONTOUR_GRID_SIZE;

        for (let col = 0; col < cols; col += 1) {
            const x = bounds.minX + col * CONTOUR_GRID_SIZE;
            field[row][col] = sampleMetaballField(members, x, y, config);
        }
    }

    const segments = [];

    for (let row = 0; row < rows - 1; row += 1) {
        const y0 = bounds.minY + row * CONTOUR_GRID_SIZE;
        const y1 = bounds.minY + (row + 1) * CONTOUR_GRID_SIZE;

        for (let col = 0; col < cols - 1; col += 1) {
            const x0 = bounds.minX + col * CONTOUR_GRID_SIZE;
            const x1 = bounds.minX + (col + 1) * CONTOUR_GRID_SIZE;

            const corners = {
                tl: {
                    x: x0,
                    y: y0,
                    value: field[row][col]
                },
                tr: {
                    x: x1,
                    y: y0,
                    value: field[row][col + 1]
                },
                br: {
                    x: x1,
                    y: y1,
                    value: field[row + 1][col + 1]
                },
                bl: {
                    x: x0,
                    y: y1,
                    value: field[row + 1][col]
                }
            };

            segments.push(...buildCellSegments(corners, CONTOUR_THRESHOLD));
        }
    }

    const loops = linkContourSegments(segments);

    if (loops.length === 0) {
        return members.map((member) => buildCircleContour(member, config));
    }

    return loops.sort((a, b) => Math.abs(polygonArea(b)) - Math.abs(polygonArea(a))).map((loop) => loop.filter((point, index, array) => index === 0 || distanceBetween(point, array[index - 1]) > 0.5)).filter((loop) => loop.length >= 4);
}

function buildCircleContour(member, config) {
    const pointCount = 28;
    const radius = member.body.circleRadius * Math.max((config.hullPadding ?? 1.6) * 0.92, 1.15);
    const contour = [];

    for (let i = 0; i < pointCount; i += 1) {
        const angle = (Math.PI * 2 * i) / pointCount;
        contour.push({
            x: member.body.position.x + Math.cos(angle) * radius,
            y: member.body.position.y + Math.sin(angle) * radius
        });
    }

    return contour;
}

function renderBoundaryContours(group, contours, config) {
    while (group.firstChild) {
        group.removeChild(group.firstChild);
    }

    if (config.styleRole === "fill" && config.styleType !== "default") {
        return;
    }

    contours.forEach((contour) => {
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
    });
}

function createBoundaryPath(config) {
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");

    path.setAttribute("fill", "none");
    path.setAttribute("stroke", config.lineStroke ?? "#111111");
    path.setAttribute("stroke-width", String(config.strokeWidth ?? 1.5));
    path.setAttribute("stroke-linecap", "round");
    path.setAttribute("stroke-linejoin", "round");
    path.setAttribute("opacity", String(config.opacity ?? 0.8));
    if (config.dash) {
        path.setAttribute("stroke-dasharray", config.dash);
    }

    return path;
}

function createArrowStampPath(contour, config) {
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    const points = getStableContourPoints(contour, Math.max(contour.length * 6, 48));
    const samples = sampleContourBySpacing(points, 24);
    const winding = Math.sign(polygonArea(points)) || 1;
    const tangentHalfWidth = 4.5;
    const inwardLength = 13;
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
        const inward = winding >= 0 ? {
            x: - tangent.y,
            y: tangent.x
        } : {
            x: tangent.y,
            y: - tangent.x
        };
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
    const points = getStableContourPoints(contour, Math.max(contour.length * 6, 48));
    const cellSize = PIXEL_CELL_SIZE;
    const snapped = points
        .map((point) => ({
            x: Math.round(point.x / cellSize) * cellSize,
            y: Math.round(point.y / cellSize) * cellSize
        }))
        .filter((point, index, array) => index === 0 || distanceBetween(point, array[index - 1]) > 0.1);

    path.setAttribute("d", buildLinearPath(snapped));
    path.setAttribute("fill", "none");
    path.setAttribute("stroke", config.lineStroke ?? "#111111");
    path.setAttribute("stroke-width", String((config.strokeWidth ?? 1.5) + 0.35));
    path.setAttribute("stroke-linecap", "square");
    path.setAttribute("stroke-linejoin", "miter");
    path.setAttribute("opacity", String(config.opacity ?? 0.8));
    return path;
}

function getSmoothContourPoints(points, resolution) {
    const curve = new THREE.CatmullRomCurve3(points.map((point) => new THREE.Vector3(point.x, point.y, 0)), true, "catmullrom", 0.08,);
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

function getPointCentroid(points) {
    return points.reduce((acc, point) => ({
        x: acc.x + point.x / points.length,
        y: acc.y + point.y / points.length
    }), {
        x: 0,
        y: 0
    });
}

function normalizePoint(point) {
    const length = Math.hypot(point.x, point.y) || 1;
    return {
        x: point.x / length,
        y: point.y / length
    };
}

function buildLinearPath(points) {
    if (points.length < 2) {
        return "";
    }

    return points.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`).join(" ") + " Z";
}

function getBoundaryLinkDistance(a, b) {
    return Math.max(BOUNDARY_CLUSTER_DISTANCE, (a.body.circleRadius + b.body.circleRadius) * 2.05,);
}

function getMetaballBounds(members, config) {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    const radiusScale = (config.hullPadding ?? 1.6) + 0.75;

    members.forEach((blob) => {
        const radius = blob.body.circleRadius * radiusScale + CONTOUR_PADDING;
        minX = Math.min(minX, blob.body.position.x - radius);
        minY = Math.min(minY, blob.body.position.y - radius);
        maxX = Math.max(maxX, blob.body.position.x + radius);
        maxY = Math.max(maxY, blob.body.position.y + radius);
    });

    return {
        minX: clamp(minX, 0, viewport.width),
        minY: clamp(minY, 0, viewport.height),
        maxX: clamp(maxX, 0, viewport.width),
        maxY: clamp(maxY, 0, viewport.height)
    };
}

function sampleMetaballField(members, x, y, config) {
    const radiusScale = (config.hullPadding ?? 1.6) * 0.94;

    return members.reduce((sum, blob) => {
        const dx = x - blob.body.position.x;
        const dy = y - blob.body.position.y;
        const radius = blob.body.circleRadius * radiusScale;
        return sum + (radius * radius) / (dx * dx + dy * dy + 1);
    }, 0);
}

function buildCellSegments(corners, threshold) {
    const caseIndex = (corners.tl.value >= threshold ? 8 : 0) | (corners.tr.value >= threshold ? 4 : 0) | (corners.br.value >= threshold ? 2 : 0) | (corners.bl.value >= threshold ? 1 : 0);

    const lookup = {
        0: [],
        1: [
            [3, 2]
        ],
        2: [
            [2, 1]
        ],
        3: [
            [3, 1]
        ],
        4: [
            [0, 1]
        ],
        5: [
            [
                0, 3
            ],
            [
                1, 2
            ]
        ],
        6: [
            [0, 2]
        ],
        7: [
            [0, 3]
        ],
        8: [
            [3, 0]
        ],
        9: [
            [0, 2]
        ],
        10: [
            [
                3, 2
            ],
            [
                0, 1
            ]
        ],
        11: [
            [0, 1]
        ],
        12: [
            [3, 1]
        ],
        13: [
            [1, 2]
        ],
        14: [
            [2, 3]
        ],
        15: []
    };

    return(lookup[caseIndex] ?? []).map(([edgeA, edgeB]) => ({
        a: getEdgePoint(corners, edgeA, threshold),
        b: getEdgePoint(corners, edgeB, threshold)
    }));
}

function getEdgePoint(corners, edge, threshold) {
    switch (edge) {
        case 0:
            return interpolatePoint(corners.tl, corners.tr, threshold);
        case 1:
            return interpolatePoint(corners.tr, corners.br, threshold);
        case 2:
            return interpolatePoint(corners.br, corners.bl, threshold);
        case 3:
            return interpolatePoint(corners.bl, corners.tl, threshold);
        default:
            return {x: corners.tl.x, y: corners.tl.y};
    }
}

function interpolatePoint(a, b, threshold) {
    const delta = b.value - a.value;

    if (Math.abs(delta) < 0.000001) {
        return {
            x: (a.x + b.x) * 0.5,
            y: (a.y + b.y) * 0.5
        };
    }

    const t = clamp((threshold - a.value) / delta, 0, 1);

    return {
        x: a.x + (b.x - a.x) * t,
        y: a.y + (b.y - a.y) * t
    };
}

function linkContourSegments(segments) {
    if (segments.length === 0) {
        return [];
    }

    const endpointMap = new Map();
    const pointKey = (point) => `${
        Math.round(point.x * 100)
    }:${
        Math.round(point.y * 100)
    }`;

    segments.forEach((segment, index) => {
        const keyA = pointKey(segment.a);
        const keyB = pointKey(segment.b);

        if (! endpointMap.has(keyA)) {
            endpointMap.set(keyA, []);
        }
        if (! endpointMap.has(keyB)) {
            endpointMap.set(keyB, []);
        }

        endpointMap.get(keyA).push({index, end: "a"});
        endpointMap.get(keyB).push({index, end: "b"});
    });

    const visited = new Set();
    const loops = [];

    segments.forEach((segment, index) => {
        if (visited.has(index)) {
            return;
        }

        visited.add(index);
        const path = [segment.a, segment.b];

        extendContourPath(path, endpointMap, segments, visited, false, pointKey);
        extendContourPath(path, endpointMap, segments, visited, true, pointKey);

        if (path.length >= 4) {
            if (distanceBetween(path[0], path[path.length - 1]) < CONTOUR_GRID_SIZE * 1.2) {
                path.pop();
            }
            loops.push(path);
        }
    });

    return loops;
}

function extendContourPath(path, endpointMap, segments, visited, atStart, pointKey) {
    let canExtend = true;

    while (canExtend) {
        const anchor = atStart ? path[0] : path[path.length - 1];
        const key = pointKey(anchor);
        const matches = endpointMap.get(key) ?? [];
        const nextMatch = matches.find(({index}) => ! visited.has(index));

        if (! nextMatch) {
            canExtend = false;
            continue;
        }

        visited.add(nextMatch.index);
        const segment = segments[nextMatch.index];
        const nextPoint = nextMatch.end === "a" ? segment.b : segment.a;

        if (atStart) {
            path.unshift(nextPoint);
        } else {
            path.push(nextPoint);
        }
    }
}

function buildSmoothPath(points) {
    if (points.length < 3) {
        return "";
    }

    const curve = new THREE.CatmullRomCurve3(points.map((point) => new THREE.Vector3(point.x, point.y, 0)), true, "catmullrom", 0.08,);

    const smoothPoints = curve.getPoints(Math.max(points.length * 8, 32));

    return smoothPoints.map(
        (point, index) => `${
            index === 0 ? "M" : "L"
        } ${
            point.x.toFixed(2)
        } ${
            point.y.toFixed(2)
        }`
    ).join(" ") + " Z";
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

function distanceBetween(a, b) {
    return Math.hypot(a.x - b.x, a.y - b.y);
}

function lerpPoint(a, b, alpha) {
    return {
        x: a.x + (b.x - a.x) * alpha,
        y: a.y + (b.y - a.y) * alpha
    };
}

function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
}

function randomBetween(min, max) {
    return Math.random() * (max - min) + min;
}

/* ═══════════════════════════════════════════════════════════════
   FILTER SYSTEM
═══════════════════════════════════════════════════════════════ */

/**
 * 매 프레임 displayRadius를 targetRadius 쪽으로 부드럽게 보간.
 * 마스크된 블롭에는 미세 분산력(중앙 척력)을 추가.
 */
function lerpBlobRadii() {
    const cx = viewport.width * 0.5;
    const cy = viewport.height * 0.5;

    state.blobs.forEach((blob) => {
        const diff = blob.targetRadius - blob.displayRadius;

        if (Math.abs(diff) < 0.08) {
            blob.displayRadius = blob.targetRadius;
        } else {
            blob.displayRadius += diff * FILTER_LERP_SPEED;
        }

        if (blob.isMasked && blob.displayRadius > 0.5) {
            const dx = blob.body.position.x - cx;
            const dy = blob.body.position.y - cy;
            const dist = Math.hypot(dx, dy) || 1;
            const mass = blob.body.mass;

            Body.applyForce(blob.body, blob.body.position, {
                x: (dx / dist) * FILTER_SCATTER_FORCE * mass,
                y: (dy / dist) * FILTER_SCATTER_FORCE * mass
            });
        }
    });
}

/**
 * 특정 태그로 필터를 설정하거나 "all"로 초기화한다.
 * @param {string} tag  "all" 또는 TAG_KEYS 에 있는 키
 */
function setFilter(tag) {
    state.activeFilter = tag === "all" ? null : tag;

    state.blobs.forEach((blob) => {
        const matches = !state.activeFilter || blob.project.tags.includes(state.activeFilter);

        if (matches) {
            if (blob.isMasked) {
                const px = blob.body.position.x;
                const py = blob.body.position.y;
                const snapX = clamp(px, BLOB_RADIUS * 2, viewport.width - BLOB_RADIUS * 2);
                const snapY = clamp(py, BLOB_RADIUS * 2, viewport.height - BLOB_RADIUS * 2);

                if (px !== snapX || py !== snapY) {
                    Body.setPosition(blob.body, {x: snapX, y: snapY});
                    Body.setVelocity(blob.body, {x: 0, y: 0});
                }
            }

            blob.targetRadius = BLOB_RADIUS;
            blob.isMasked = false;
            Body.set(blob.body, "collisionFilter", {category: 1, mask: 0xFFFFFFFF});
        } else {
            blob.targetRadius = 0;
            blob.isMasked = true;
            Body.set(blob.body, "collisionFilter", {category: 1, mask: 0});
        }
    });

    updateTagChipActiveState(state.activeFilter);
    updateWorkGrid(state.activeFilter);
}

/**
 * 하단 태그 칩의 활성 상태와 배경 썸네일을 업데이트한다.
 * @param {string|null} filter
 */
function updateTagChipActiveState(filter) {
    const root = document.getElementById("tag-rail-chips");

    if (!root) {
        return;
    }

    root.querySelectorAll(".tag-rail__chip[data-tag]").forEach((chip) => {
        const chipTag = chip.dataset.tag;
        const isActive = chipTag === (filter ?? "all");

        chip.classList.toggle("tag-rail__chip--active", isActive);

        if (isActive && filter !== null && state.tagThumbnails[filter]) {
            chip.style.setProperty("--thumb-url", `url(${state.tagThumbnails[filter]})`);
        } else {
            chip.style.removeProperty("--thumb-url");
        }
    });
}

/* ═══════════════════════════════════════════════════════════════
   TAG THUMBNAIL GENERATION (Offscreen Canvas → base64)
═══════════════════════════════════════════════════════════════ */

/** 앱 초기화 시 각 태그의 원형 패턴 썸네일을 base64 PNG로 생성해 state.tagThumbnails에 저장. */
function generateTagThumbnails() {
    const size = 80;

    TAG_KEYS.forEach((tag) => {
        try {
            state.tagThumbnails[tag] = drawTagThumbnail(tag, size);
        } catch (e) {
            /* eslint-disable-next-line no-console */
            console.warn("[thumbnail]", tag, e);
        }
    });
}

/**
 * 하나의 태그에 대해 offscreen canvas에 원형 패턴을 그리고 base64 dataURL을 반환.
 * @param {string} tagKey
 * @param {number} size   캔버스 한 변 크기(px)
 * @returns {string} base64 PNG dataURL
 */
function drawTagThumbnail(tagKey, size) {
    const canvas = document.createElement("canvas");

    canvas.width = size;
    canvas.height = size;

    const ctx = canvas.getContext("2d");
    const v = getMergedShaderVisual(tagKey);
    const cfg = tagConfigs[tagKey];
    const cx = size / 2;
    const cy = size / 2;
    const r = size / 2 - 0.5;

    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.clip();

    switch (cfg.styleType) {
        case "default":
            drawThumbGradient(ctx, size, v.colors.defaultFill, v.colors.defaultFillOuter);
            break;
        case "tinted-default-fill":
            drawThumbGradient(ctx, size, v.colors.tintDefaultFill, v.colors.tintDefaultFillOuter);
            break;
        case "halftone":
            drawThumbHalftone(ctx, size, v.colors.halftonePaper, v.colors.halftoneInk);
            break;
        case "pixel-line":
            drawThumbPixelLines(ctx, size, v.line.stroke);
            break;
        case "arrow-line":
            drawThumbArrowLines(ctx, size, v.line.stroke);
            break;
        case "default-dash":
            drawThumbDashLines(ctx, size, v.line.stroke, cfg.dash, cfg.strokeWidth);
            break;
        case "pixel-cross":
            drawThumbPixelCross(ctx, size, v.colors.crossInk);
            break;
        case "checkerboard":
            drawThumbCheckerboard(ctx, size, v.colors.checkerLight, v.colors.checkerDark);
            break;
        default:
            ctx.fillStyle = "#cccccc";
            ctx.fillRect(0, 0, size, size);
    }

    ctx.restore();

    return canvas.toDataURL("image/png");
}

function drawThumbGradient(ctx, size, inner, outer) {
    const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);

    grad.addColorStop(0, inner || "#ffffff");
    grad.addColorStop(1, outer || "#cccccc");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);
}

function drawThumbHalftone(ctx, size, paper, ink) {
    ctx.fillStyle = paper || "#ffffff";
    ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = ink || "#000000";
    const spacing = size / 9;
    const dotR = spacing * 0.28;

    for (let row = -1; row < 11; row++) {
        const offset = row % 2 === 0 ? 0 : spacing / 2;

        for (let col = -1; col < 11; col++) {
            ctx.beginPath();
            ctx.arc(col * spacing + offset, row * spacing, dotR, 0, Math.PI * 2);
            ctx.fill();
        }
    }
}

function drawThumbCheckerboard(ctx, size, light, dark) {
    const cell = size / 8;

    for (let row = 0; row < 9; row++) {
        for (let col = 0; col < 9; col++) {
            ctx.fillStyle = (row + col) % 2 === 0 ? (light || "#ffffff") : (dark || "#000000");
            ctx.fillRect(col * cell, row * cell, cell, cell);
        }
    }
}

function drawThumbPixelCross(ctx, size, ink) {
    ctx.fillStyle = "#f2f2f2";
    ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = ink || "#ff0000";
    const cell = size / 7;
    const armLen = cell * 0.42;
    const thick = Math.max(1.5, cell * 0.18);

    for (let row = 0; row < 8; row++) {
        for (let col = 0; col < 8; col++) {
            const px = (col + 0.5) * cell;
            const py = (row + 0.5) * cell;

            ctx.fillRect(px - thick / 2, py - armLen, thick, armLen * 2);
            ctx.fillRect(px - armLen, py - thick / 2, armLen * 2, thick);
        }
    }
}

function drawThumbPixelLines(ctx, size, lineColor) {
    ctx.fillStyle = "#f2f2f2";
    ctx.fillRect(0, 0, size, size);
    ctx.strokeStyle = lineColor || "#000000";
    ctx.lineWidth = 2;
    const step = size / 8;

    for (let x = step / 2; x < size + 1; x += step) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, size);
        ctx.stroke();
    }
}

function drawThumbDashLines(ctx, size, lineColor, dash, strokeWidth) {
    ctx.fillStyle = "#f2f2f2";
    ctx.fillRect(0, 0, size, size);
    ctx.strokeStyle = lineColor || "#000000";
    ctx.lineWidth = Math.min(strokeWidth || 3, 6);
    const dashArr = dash === "1 15"
        ? [2, 11]
        : dash === "3 6"
            ? [4, 7]
            : [];

    ctx.setLineDash(dashArr);
    const step = size / 6;

    for (let y = step / 2; y < size; y += step) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(size, y);
        ctx.stroke();
    }

    ctx.setLineDash([]);
}

function drawThumbArrowLines(ctx, size, lineColor) {
    ctx.fillStyle = "#f2f2f2";
    ctx.fillRect(0, 0, size, size);
    ctx.strokeStyle = lineColor || "#000000";
    ctx.lineWidth = 1.5;
    const step = size / 5;
    const ah = 5;

    for (let y = step / 2; y < size; y += step) {
        ctx.setLineDash([4, 6]);
        ctx.beginPath();
        ctx.moveTo(2, y);
        ctx.lineTo(size - 14, y);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.moveTo(size - 14, y - ah);
        ctx.lineTo(size - 4, y);
        ctx.lineTo(size - 14, y + ah);
        ctx.stroke();
    }

    ctx.setLineDash([]);
}

/* ════════════════════════════════════════
   WORK GRID
════════════════════════════════════════ */

function updateWorkGrid(filter) {
    const grid = document.getElementById("work-grid");
    if (!grid) { return; }

    grid.querySelectorAll(".work-item").forEach((item) => {
        const project = projects.find((p) => p.id === item.dataset.id);
        if (!project) { return; }

        const matches = !filter || project.tags.includes(filter);

        if (matches) {
            item.classList.remove("work-item--hidden");
        } else {
            item.classList.add("work-item--hidden");
        }
    });
}

function initWorkGrid() {
    const grid = document.getElementById("work-grid");
    if (!grid) { return; }

    grid.replaceChildren();

    projects.forEach((project) => {
        const item = document.createElement("article");
        item.className = "work-item";
        item.dataset.id = project.id;
        item.setAttribute("role", "listitem");
        item.style.cursor = "pointer";

        const thumb = document.createElement("div");
        thumb.className = "work-item__thumb";
        thumb.setAttribute("aria-hidden", "true");

        const meta = document.createElement("div");
        meta.className = "work-item__meta";

        const titleEl = document.createElement("span");
        titleEl.className = "work-item__title";
        titleEl.textContent = project.title || "";

        const yearEl = document.createElement("span");
        yearEl.className = "work-item__year";
        yearEl.textContent = project.year || "";

        meta.append(titleEl, yearEl);

        const subtitleEl = document.createElement("p");
        subtitleEl.className = "work-item__subtitle";
        subtitleEl.textContent = project.subtitle || "";

        item.append(thumb, meta, subtitleEl);

        item.addEventListener("click", () => {
            if (project.url) { window.location.href = project.url; }
        });

        grid.append(item);
    });
}

/* ════════════════════════════════════════
   SCROLL BEHAVIOR: WORK nav active state
════════════════════════════════════════ */

function initScrollBehavior() {
    const workSection = document.getElementById("work");
    if (!workSection) { return; }

    const workNavLinks = document.querySelectorAll(".page-header__link[data-nav='work']");

    function updateActiveNav() {
        const scrollY = window.scrollY;
        const heroH = window.innerHeight;
        const isWorkActive = scrollY > heroH * 0.5;

        workNavLinks.forEach((link) => {
            link.classList.toggle("page-header__link--active", isWorkActive);
        });
    }

    window.addEventListener("scroll", updateActiveNav, { passive: true });
    updateActiveNav();
}
