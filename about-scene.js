/**
 * about-scene.js
 * About 페이지 SEJEONG 글자 물리 인터랙션.
 * Three.js 없이 Matter.js + DOM 조작으로만 구현.
 */

const {
    Bodies, Body, Composite, Constraint,
    Engine, Mouse, MouseConstraint, Vector
} = Matter;

/* ── 물리 상수 (main.js 와 동일) ── */
const HEADER_SPRING_STIFFNESS   = 0.00105;
const HEADER_SPRING_DAMPING     = 0.07;
const HEADER_BODY_FRICTION_AIR  = 0.09;
const HEADER_BODY_DENSITY       = 0.00024;
const HEADER_ANCHOR_PULL_X      = 0.000055;
const HEADER_FLOAT_SCALE        = 0.000026;
const HEADER_FLOAT_SCALE_Y      = 0.000038;
const HEADER_LETTER_ATTRACTION  = 0.0000085;
const HEADER_ORBIT_RADIUS_X     = 28;
const HEADER_ORBIT_RADIUS_Y     = 52;
const HEADER_INIT_SPEED         = 1.35;
const HEADER_INIT_SPEED_Y       = 2.05;
const HEADER_DOWNWARD_SOFT_CAP  = 0.00009;
const HEADER_BAND_Y_RATIO       = 0.34;
const PHYSICS_TIMESTEP          = 1000 / 60;

function randomBetween(a, b) { return a + Math.random() * (b - a); }
function clamp(v, lo, hi)    { return Math.max(lo, Math.min(hi, v)); }

/* ── 뷰포트 ── */
const vw = window.innerWidth;
const vh = window.innerHeight;

/* ── Matter.js 엔진 ── */
const engine = Engine.create({ gravity: { x: 0, y: 0 } });

/* ── 인터랙션 오버레이 (상단 286px만 커버, 하단 콘텐츠 링크 보호) ── */
const overlay = document.createElement("div");
overlay.style.cssText = [
    "position:fixed",
    "top:0",
    "left:0",
    `width:${vw}px`,
    "height:300px",
    "z-index:19",
    "background:transparent",
    "pointer-events:auto",
    "cursor:url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12'%3E%3Ccircle cx='6' cy='6' r='6' fill='%23e8261c'/%3E%3C/svg%3E\") 6 6, crosshair"
].join(";");
document.body.appendChild(overlay);

/* 오버레이 위 스크롤 → 페이지 전달 */
overlay.addEventListener("wheel", (e) => {
    e.preventDefault();
    window.scrollBy({ top: e.deltaY, left: e.deltaX });
}, { passive: false });

/* ── Matter.js 마우스 ── */
const mouse = Mouse.create(overlay);
const mouseConstraint = MouseConstraint.create(engine, {
    mouse,
    constraint: {
        stiffness: 0.22,
        damping: 0.09,
        angularStiffness: 0,
        render: { visible: false }
    }
});
Composite.add(engine.world, mouseConstraint);

overlay.removeEventListener("mousewheel", mouse.mousewheel);
overlay.removeEventListener("DOMMouseScroll", mouse.mousewheel);
overlay.removeEventListener("touchmove", mouse.touchmove);
overlay.addEventListener("touchmove", mouse.touchmove, { passive: true });

/* ── 글자 상태 ── */
const letters = [];

/* ── 글자 물리 초기화 ── */
function initLetters() {
    const layer = document.getElementById("about-letter-layer");
    const row   = layer?.querySelector(".header-letter-row");
    if (!row) { return; }

    const wraps = [...row.querySelectorAll(".header-letter-wrap")];
    if (!wraps.length) { return; }

    /* CSS 인라인 스타일 초기화 후 레이아웃 확정 */
    wraps.forEach((w) => {
        w.style.position  = "";
        w.style.left      = "";
        w.style.top       = "";
        w.style.transform = "";
    });
    void row.offsetHeight;

    /* 초기 화면 좌표 읽기 */
    const placements = wraps.map((wrap) => {
        const r = wrap.getBoundingClientRect();
        return {
            wrap,
            cx: r.left + r.width  * 0.5,
            cy: r.top  + r.height * 0.5,
            w:  Math.max(12, r.width  * 0.9),
            h:  Math.max(12, r.height * 0.9)
        };
    }).filter((p) => p.w > 0 && p.h > 0);

    placements.forEach(({ wrap, cx, cy, w, h }) => {
        /* DOM 위치를 fixed 좌표로 고정 */
        wrap.style.position  = "fixed";
        wrap.style.left      = `${cx}px`;
        wrap.style.top       = `${cy}px`;
        wrap.style.transform = "translate(-50%, -50%)";

        const body = Bodies.rectangle(cx, cy, w, h, {
            frictionAir: HEADER_BODY_FRICTION_AIR,
            friction:    0.14,
            restitution: 0.42,
            density:     HEADER_BODY_DENSITY,
            chamfer:     { radius: 5 },
            render:      { visible: false }
        });

        const constraint = Constraint.create({
            pointA: { x: cx, y: cy },
            bodyB:  body,
            pointB: { x: 0, y: 0 },
            stiffness: HEADER_SPRING_STIFFNESS,
            damping:   HEADER_SPRING_DAMPING,
            length:    0
        });

        Composite.add(engine.world, body);
        Composite.add(engine.world, constraint);

        Body.setVelocity(body, {
            x: randomBetween(-HEADER_INIT_SPEED,   HEADER_INIT_SPEED),
            y: randomBetween(-HEADER_INIT_SPEED_Y, HEADER_INIT_SPEED_Y)
        });
        Body.setAngularVelocity(body, randomBetween(-0.055, 0.055));

        letters.push({ body, constraint, wrap });
    });
}

/* ── DOM 동기화 ── */
function syncLetters() {
    letters.forEach(({ body, wrap }) => {
        wrap.style.left      = `${body.position.x}px`;
        wrap.style.top       = `${body.position.y}px`;
        wrap.style.transform = `translate(-50%, -50%) rotate(${body.angle}rad)`;
    });
}

/* ── 드리프트 힘 (main.js applyHeaderLetterDrift 동일) ── */
function applyDrift(time) {
    if (!letters.length) { return; }

    const centroid = letters.reduce(
        (acc, { body }) => { acc.x += body.position.x; acc.y += body.position.y; return acc; },
        { x: 0, y: 0 }
    );
    centroid.x /= letters.length;
    centroid.y /= letters.length;

    const orbitTarget = {
        x: centroid.x + Math.cos(time * 0.00042 + 0.9)  * HEADER_ORBIT_RADIUS_X,
        y: centroid.y + Math.sin(time * 0.00037 + 1.15) * HEADER_ORBIT_RADIUS_Y
    };

    letters.forEach(({ body }, i) => {
        const toCenter = Vector.sub(centroid, body.position);
        const dist     = Vector.magnitude(toCenter);

        if (dist > 1) {
            const n = Vector.normalise(toCenter);
            const s = clamp(dist / 170, 0.22, 1.55);
            const f = Vector.mult(n, HEADER_LETTER_ATTRACTION * body.mass * s);
            f.x *= 1.12; f.y *= 0.58;
            Body.applyForce(body, body.position, f);
        }

        const toOrbit = Vector.sub(orbitTarget, body.position);
        const od      = Vector.magnitude(toOrbit);
        if (od > 1) {
            const n = Vector.normalise(toOrbit);
            const s = clamp(od / 140, 0.18, 1.25);
            const f = Vector.mult(n, HEADER_LETTER_ATTRACTION * body.mass * s);
            f.x *= 1.08; f.y *= 0.55;
            Body.applyForce(body, body.position, f);
        }

        const da = time * 0.00032 + i * 0.73;
        Body.applyForce(body, body.position, {
            x: Math.cos(da)        * HEADER_FLOAT_SCALE   * body.mass,
            y: Math.sin(da * 1.13) * HEADER_FLOAT_SCALE_Y * body.mass
        });

        if (dist > 1) {
            const tangent = { x: -toCenter.y / dist, y: toCenter.x / dist };
            const swirl   = Math.sin(time * 0.0007 + i * 0.61);
            Body.applyForce(body, body.position,
                Vector.mult(tangent, HEADER_FLOAT_SCALE * body.mass * 0.95 * swirl));
        }

        Body.setAngularVelocity(body, body.angularVelocity * 0.988);
    });
}

/* ── X 앵커 보조 복원력 ── */
function applyAnchorPullX() {
    letters.forEach(({ body, constraint }) => {
        const dx = constraint.pointA.x - body.position.x;
        if (Math.abs(dx) < 0.35) { return; }
        Body.applyForce(body, body.position, {
            x: dx * HEADER_ANCHOR_PULL_X * body.mass,
            y: 0
        });
    });
}

/* ── 하단 밴드 복원력 ── */
function applySoftBandPull() {
    const yMax = vh * HEADER_BAND_Y_RATIO;

    letters.forEach(({ body, constraint }) => {
        const ay = constraint.pointA.y;
        if (body.position.y <= Math.max(yMax, ay + 128)) { return; }

        const dx   = constraint.pointA.x - body.position.x;
        const dy   = ay - body.position.y;
        const pull = HEADER_DOWNWARD_SOFT_CAP * body.mass;

        Body.applyForce(body, body.position, {
            x: dx * pull * 0.4,
            y: dy * pull * 0.58
        });
    });
}

/* ── 애니메이션 루프 ── */
let lastFrame = performance.now();

function animate(now = performance.now()) {
    requestAnimationFrame(animate);

    const dt = Math.min(now - lastFrame, 64);
    lastFrame = now;

    Engine.update(engine, dt);
    applyDrift(now);
    applyAnchorPullX();
    applySoftBandPull();
    syncLetters();
}

/* ── 초기화 (레이아웃 확정 후 2프레임 대기) ── */
requestAnimationFrame(() => {
    requestAnimationFrame(() => {
        initLetters();
        lastFrame = performance.now();
        requestAnimationFrame(animate);
    });
});
