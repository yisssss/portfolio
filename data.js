/**
 * 셰이더 시각값
 * - `shaderTagVisual`: 태그마다 `colors` / `fillExtents` / `line` 전부 명시 (`tagConfigs` 키와 동일).
 * - `scenePostEffects`: 화면 전체 후처리(그레인·그라데이션맵·필 에지 디더).
 * - `viewportPhysics.centerPull`: 화면 중앙으로 약한 인력.
 *
 * fillExtents (메타볼 totalInfluence 기준 smoothstep):
 *   - default: `defaultFill`·`defaultFillMid`·`defaultFillOuter`(중심→말단 3색) + `defaultFillMaskLow` / `High` + `defaultFillExpand`
 *   - tinted-default-fill: `tintDefaultFill`·`tintDefaultFillMid`·`tintDefaultFillOuter`(3색 방사) + `tintFillMaskLow` / `High` + `tintFillExpand`
 *   - halftone: `halftoneMaskLow` / `High` + `halftoneExpand`
 *   - pixel-cross: `crossInk`, `crossPixelThreshold`
 *   - checkerboard: `checkerLightTransparent` 등
 */

function shaderColorsBase() {
    return {
        defaultFill: "#ffffff",
        defaultFillMid: "#ffffff",
        defaultFillOuter: "#ffffff",
        tintDefaultFill: "#ffffff",
        tintDefaultFillMid: "#ffffff",
        tintDefaultFillOuter: "#ffffff",
        checkerLight: "#ffffff",
        checkerDark: "#ffffff",
        halftoneInk: "#ffffff",
        halftonePaper: "#ffffff",
        crossInk: "#ffffff"
    };
}

function shaderFillExtentsBase() {
    return {
        defaultFillMaskLow: 0.1,
        defaultFillMaskHigh: 1.0,
        defaultFillExpand: 1.6,
        tintFillMaskLow: 0.92,
        tintFillMaskHigh: 5.2,
        tintFillExpand: 1,
        checkerPixelThreshold: 0.4,
        checkerLightTransparent: true,
        crossPixelThreshold: 0.92,
        halftoneMaskLow: 0.78,
        halftoneMaskHigh: 1.18,
        halftoneExpand: 1,
        halftoneSpacing: 9.5,
        halftoneDotRadiusMin: 0.04,
        halftoneDotRadiusMax: 0.63
    };
}

/** 메타볼 합성 이후 한 번 적용되는 전역 후처리 */
export const scenePostEffects = {
    filmGrainStrength: 0.024,
    gradientMapColorA: "#ffffff",
    gradientMapColorB: "#ffffff",
    gradientMapMix: 0.42,
    fillEdgeDitherMix: 0.78,
    fillEdgeDitherBand: 0.42,
    fillDitherNoiseAmount: 0.32
};

/** Matter.js 월드 좌표 기준, 값이 클수록 중앙으로 더 잘 끌린다. */
export const viewportPhysics = {
    centerPull: 0.0000095
};

/** 태그별 셰이더·SVG 선색 (키는 `tagConfigs`와 같아야 한다) */
export const shaderTagVisual = {
    identity: {
        colors: {
            ...shaderColorsBase(),
            defaultFill: "#FF8383",
            defaultFillMid: "#f9c5bb",
            defaultFillOuter: "#f9c5bb"
        },
        fillExtents: {
            ...shaderFillExtentsBase()
        },
        line: {
            stroke: "#FFF6F6"
        }
    },
    video: {
        colors: {
            ...shaderColorsBase(),
            tintDefaultFill: "#8fd89d",
            tintDefaultFillMid: "#52ff6e",
            tintDefaultFillOuter: "#52ff6e"
        },
        fillExtents: {
            ...shaderFillExtentsBase(),
            tintFillMaskLow: 0.005,
            tintFillMaskHigh: 0.9,
            tintFillExpand: 2.5
        },
        line: {
            stroke: "#e0702a"
        }
    },
    illustration: {
        colors: {
            ...shaderColorsBase(),
            halftoneInk: "#f9c5bb",
            halftonePaper: "#ffffff"
        },
        fillExtents: {
            ...shaderFillExtentsBase(),
            halftoneMaskLow: 0.8,
            halftoneMaskHigh: 1.0,
            halftoneSpacing: 10
        },
        line: {
            stroke: "#F1E9E9"
        }
    },
    website: {
        colors: {
            ...shaderColorsBase()
        },
        fillExtents: {
            ...shaderFillExtentsBase()
        },
        line: {
            stroke: "#52ff6e"
        }
    },
    exhibition: {
        colors: {
            ...shaderColorsBase()
        },
        fillExtents: {
            ...shaderFillExtentsBase()
        },
        line: {
            stroke: "#38b7e8"
        }
    },
    "typography": {
        colors: {
            ...shaderColorsBase()
        },
        fillExtents: {
            ...shaderFillExtentsBase()
        },
        line: {
            stroke: "#00a54a"
        }
    },
    graphic: {
        colors: {
            ...shaderColorsBase()
        },
        fillExtents: {
            ...shaderFillExtentsBase()
        },
        line: {
            stroke: "#e8261c"
        }
    },
    editorial: {
        colors: {
            ...shaderColorsBase(),
            crossInk: "#FF3737"
        },
        fillExtents: {
            ...shaderFillExtentsBase(),
            crossPixelThreshold: 0.26
        },
        line: {
            stroke: "#FF3737"
        }
    },
    "creative-coding": {
        colors: {
            ...shaderColorsBase(),
            checkerLight: "#ffffff",
            checkerDark: "#38b7e8"
        },
        fillExtents: {
            ...shaderFillExtentsBase(),
            checkerPixelThreshold: 1
        },
        line: {
            stroke: "#ffffff"
        }
    }
};

/** @param {string} tagKey */
export function getMergedShaderVisual(tagKey) {
    const v = shaderTagVisual[tagKey];

    if (! v) {
        throw new Error(`[data] shaderTagVisual 에 없는 태그: ${ tagKey }`);
    }

    return v;
}

// ─────────────────────────────────────────────────────────────────────────────
// 프로젝트 데이터 스키마 (확장 버전)
//
//  id          string       — URL 파라미터 key (?id=...)
//  title       string       — 프로젝트 공식 이름
//  category    string       — 프로젝트 부제 / 카테고리 설명
//  subtitle    string       — 워크 그리드 카드에 표시되는 한줄 설명 (category와 동일 가능)
//  year        string
//  tags        string[]     — 필터링 + 서비스 표시 겸용
//  services    string[]     — (선택) 상세 페이지 SERVICES 컬럼 전용 라벨. 없으면 tags 사용.
//  teammates   string[]|null — null 또는 빈 배열 → 개인 작업 ("PROJECT")
//  content     { leftCol: string[], rightCol: string[] }  — 본문 단락 배열
//  imageBlocks { layout, hero, count, images }[] — 이미지 섹션 배열
//    layout : "full-bleed" | "padded" | "spacer"  (spacer 시 size: "sm"|"md"|"lg"|"xl" 로 높이 지정)
//    hero   : boolean        — true → 뷰포트 높이 꽉 차는 대형 이미지
//    count  : 1 | 2 | 3     — 한 줄 이미지 개수
//    images : (string|null)[] — 이미지 경로. null → 회색 플레이스홀더, "w:h" → 해당 비율 공백 (예: "1:1", "4:3")
//  websiteLink string|null   — 외부 링크 (없으면 null → VISIT 버튼 숨김)
//  url         string        — 워크 그리드 클릭 시 이동할 경로
// ─────────────────────────────────────────────────────────────────────────────
export const projects = [
    {
        id:          "32teeth",
        title:       "32 TEE TH",
        category:    "매끈함에 대항하는 F&B 브랜드",
        subtitle:    "매끈함에 대항하는 F&B 브랜드",
        year:        "2025",
        tags:        ["identity", "graphic", "website", "editorial","exhibition"],
        teammates:   null,
        content:     { leftCol: ["매끈한 현대 식문화를 비판하기 위해 가상의 그래픽 스튜디오 ‘Studio The Raw’에서 기획한 대항적 F&b 식문화 브랜드.", "매끈한 음식은 어떻게 우리의 감각을 살해하는가?\n호모 사피엔스의 이빨은 탄생 이래 약해지기만 했다. 우리는 단단한 것을 씹어 정복하는 대신 부드러움에 길들기를 택했다. 예리함을 잃은 송곳니는 장식에 불과하고, 경계심을 잃은 혀는 감각을 탐닉하기에 바쁘다. 이제 퇴화의 진화를 그만둘 시간이다.\n32 TEE TH는 매끈한 현대 식문화를 경계한다.\n32 TEE TH는 문명의 편리를 멀리하고, 경험의 원초성을 회복한다.\n32 TEE TH는 더 이상 인류가 가진 것을 상실하지 않기 위해 먹는다.", "매끈함에 반항하는 키워드 '거친', '불균질한'을 디자인 컨셉으로 삼아 통일되지 않은 재질을 바탕으로 새로운 질감의 주제 종이 패키지, 수제본 브랜드북, 리플렛 등의 인쇄물과 브랜드 스토리를 담은 웹사이트를 제작했다. 벽돌과 같은 씹기 어려운 육포를 '석육'이라는 명칭의 상품으로 삼아 실제 비주얼로 제시했다."], rightCol: ["A counter-cultural F&B brand structured by the fictional design studio 'Studio The Raw' as a critique against the modern smooth food culture", "How does the smooth food end up deadening our senses?\nSince birth, the teeth of Homo sapiens have only grown weaker. Instead of conquering and mastering primal food through chewing, we chose to be tamed by softness. Our canines, having lost their sharpness, are merely ornamental, and our tongues, having lost their vigilance, are busy indulging their senses. It is time to stop the evolution of degeneration.\n32 TEE TH guards against the smooth, modern food culture.\n32 TEE TH steps away from the convenience of civilization, recovering the primal nature of experience.\n32 TEE TH eats so that humanity no longer loses what it possesses.", "Embracing keywords such as 'Rough,' and 'Heterogeneous'—the polar opposites of seamlessness—I developed a series of printed materials including experimental packaging, a hand-bound brand book, leaflets, and a brand website, all centered around non-uniform textures. To materialize this concept, I introduced a product titled 'Stone Jerky,' featuring meat as tough and unyielding as a brick, and presented it through a distinct visual identity."] },
        imageBlocks: [
            { layout: "full-bleed", hero: true,  count: 1, images: ["./projects/32TEETH/1.jpg"] },
            { layout: "full-bleed", hero: false, count: 1, images: ["./projects/32TEETH/2.jpg"] },
            { layout: "spacer", size: "xl" },
            { layout: "padded", hero: false, count: 2, images: ["./projects/32TEETH/3.jpg","./projects/32TEETH/4.jpg"] },
            { layout: "padded", hero: false, count: 3, images: ["./projects/32TEETH/5.jpg","./projects/32TEETH/6.jpg", "./projects/32TEETH/7.jpg"] },
            { layout: "padded", hero: false, count: 2, images: ["./projects/32TEETH/8.png", "./projects/32TEETH/9.png"] },
            { layout: "spacer", size: "xl" },
            { layout: "full-bleed", hero: false, count: 2, images: ["./projects/32TEETH/11.jpg", "./projects/32TEETH/12.jpg"] },
        ],
        thumbnail16x9: "./projects/32TEETH/thumb.jpg",
        thumbnail9x16: "./projects/32TEETH/thumb2.jpg",
        websiteLink: "https://yisssss.github.io/32_TEE_TH/",
        url:         "./project.html?id=32teeth"
    },
    
    
    {
        id:          "yeolmu",
        title:       "YEOLMU",
        category:    "사각에서 벗어난 만화",
        subtitle:    "사각에서 벗어난 만화",
        year:        "2025",
        tags:        ["illustration", "website","exhibition"],
        teammates:   null,
        content:     { leftCol: ["H는 사라진 금요일 엄마를 찾아 방향을 틀거나 꺾고, 흩어지거나 진동하며 사각의 프레임 밖으로 달려 나간다."], rightCol: ["H turns or bends, scatters or vibrates, running out of the square frame in search of the Friday mother."] },
        imageBlocks: [
            { layout: "full-bleed", hero: true,  count: 1, images: ["./projects/yeolmu/1.jpg"] },
            { layout: "padded", hero: false, count: 1, images: ["./projects/yeolmu/5.jpg"] },
            { layout: "padded", hero: false, count: 2, images: ["./projects/yeolmu/3.JPG", "./projects/yeolmu/4.JPG"] },
            { layout: "full-bleed", hero: false, count: 1, images: ["./projects/yeolmu/2.jpg"] },
        ],
        thumbnail16x9: "./projects/yeolmu/thumb2.jpg",
        thumbnail9x16: "./projects/yeolmu/thumb.jpg",
        websiteLink: "https://yeolmu.site/",
        url:         "./project.html?id=yeolmu"
    },
    
    
    {
        id:          "graph-pw",
        title:       "GRAPH SUMMER PARTY",
        category:    "전시 웹사이트 제작",
        subtitle:    "전시 웹사이트 제작",
        year:        "2025",
        tags:        ["identity", "website", "typography", "exhibition"],
        teammates:   ["조은별 CHO Enbyeol", "김경민 KIM Kyeongmin"],
        content:     { leftCol: ["2025 SNU PATCHWORK 전시에 디자인 소모임 GRAPH 팀으로 참여했다. '여름 파티'라는 테마 아래, 관객을 환영하는 다양한 형태의 ‘초대장’을 비주얼 모티프로 설정하여 전시 전반의 아이덴티티를 구축했다. 전시 준비위원회로서 아이덴티티 기획부터 동선 설계, 참여자 9인의 작품 디스플레이까지 전시의 전 과정을 조율하며 다양한 색깔이 넘치는 작품에 한 팀이라는 통일성을 부여하기 위해 노력했다.", "기존의 종이 도록을 대신하여 각 작품의 상세 정보를 담은 인터랙티브 캡션 웹사이트를 직접 제작하고 퍼블리싱했다. 이는 전시의 디지털 아카이브로 이어졌다."], rightCol: ["I participated in the 2025 SNU PATCHWORK exhibition as a member of the design group 'GRAPH.' Under the theme of a Summer Party, I established the overall exhibition identity by utilizing various forms of 'invitations' as the core visual motif. As a member of the organizing committee, I coordinated the entire process—from visual branding and spatial flow planning to the final display of works by nine different artists—striving to provide a unified team identity to a diverse collection of individual styles.", "A key part of this project was the development and publishing of an interactive caption website that replaced traditional printed catalogs. I designed the website's structure and layout to mirror the physical exhibition's flow, which naturally extended into a permanent digital archive. By bridging the gap between physical and digital spaces, I offered visitors a seamless and tech-driven viewing experience."] },
        imageBlocks: [
            { layout: "full-bleed", hero: true,  count: 1, images: ["./projects/graph-pw/thumb2.jpg"] },
            { layout: "spacer", size: "xl" },
            { layout: "padded", hero: false, count: 3, images: ["1:1", "./projects/graph-pw/1.jpg", "1:1"] },
            { layout: "padded", hero: false, count: 2, images: ["./projects/graph-pw/2.jpg", "./projects/graph-pw/3.jpg"] },
            { layout: "padded", hero: false, count: 3, images: ["./projects/graph-pw/4.jpeg", "./projects/graph-pw/5.jpeg", "./projects/graph-pw/6.jpeg"] },
        ],
        thumbnail16x9: "./projects/graph-pw/thumb2.jpg",
        thumbnail9x16: "./projects/graph-pw/thumb.jpg",
        websiteLink: "https://yisssss.github.io/patchwork-graph/",
        url:         "./project.html?id=graph-pw"
    },
    
    
    {
        id:          "grandma",
        title:       "GRANDMOTHER",
        category:    "창작 만화 <할머니>",
        subtitle:    "창작 만화 <할머니>",
        year:        "2024",
        tags:        ["illustration"],
        teammates:   null,
        content:     { leftCol: ["깊은 정을 쌓은 가정부와 이별하는 이야기를 어린아이의 시선으로 그려낸 단편 만화."], rightCol: ["A short-form comic capturing a child’s perspective on parting with a beloved housekeeper after forming a deep emotional bond."] },
        imageBlocks: [
            { layout: "full-bleed", hero: true,  count: 1, images: ["./projects/grandma/1.png"] },
            { layout: "full-bleed", hero: false, count: 1, images: ["./projects/grandma/2.jpg"] },
        ],
        thumbnail16x9: "./projects/grandma/thumb2.png",
        thumbnail9x16: "./projects/grandma/thumb.png",
        websiteLink: null,
        url:         "./project.html?id=grandma"
    },
    
    {
        id:          "SNUDcatalog",
        title:       "25 SNUD CATALOG",
        category:    "디자인과 졸업전시 도록",
        subtitle:    "디자인과 졸업전시 도록",
        year:        "2025",
        tags:        ["editorial"],
        teammates:  ["윤희경 YOON Heekyung", "장수연 JANG Sooyeon", "조하연 CHO Hayeon"],
        content:     { leftCol: ["서울대학교 디자인과 졸업전시 준비위원회 도록팀원으로서 2024년, 2025년 2년 연속 참여하며 도록 기획과 편집, 최종 인쇄 및 배포에 이르기까지 전 과정을 경험했다. 2025년의 경우 전체 전시 컨셉 WRAP UP에 적합한 형태의 느슨한 고무줄 제본을 택했다."], rightCol: ["As a member of the SNUD (Seoul National University Design) Graduation Catalog Committee for two consecutive years (2024–2025), I managed the entire publication process, including conceptual planning, editorial design, final printing, and distribution. For the 2025 edition, I implemented a loose elastic band binding to align with the overall exhibition theme, WRAP UP."] },
        imageBlocks: [
            { layout: "full-bleed", hero: true,  count: 1, images: ["./projects/SNUDcatalog/1.png"] },
            { layout: "full-bleed", hero: false, count: 1, images: ["./projects/SNUDcatalog/2.png"] },
        ],
        thumbnail16x9: "./projects/SNUDcatalog/thumb2.png",
        thumbnail9x16: "./projects/SNUDcatalog/thumb.jpg",
        websiteLink: "https://2025.snudesignweek.com/",
        url:         "./project.html?id=SNUDcatalog"
    },
    
    {
        id:          "25kms",
        title:       "25KM/S",
        category:    "지하철 시 모음집",
        subtitle:    "지하철 시 모음집",
        year:        "2023",
        tags:        ["graphic", "editorial"],
        teammates:   null,
        content:     { leftCol: [], rightCol: [] },
        imageBlocks: [
            { layout: "full-bleed", hero: false,  count: 2, images: ["./projects/25kms/1.jpg", "./projects/25kms/2.jpg"] },
            { layout: "full-bleed", hero: false, count: 1, images: ["./projects/25kms/3.gif"] },
        ],
        thumbnail16x9: "./projects/25kms/썸네일2.jpg",
        thumbnail9x16: "./projects/25kms/thumb.jpg",
        websiteLink: null,
        url:         "./project.html?id=25kms"
    },
    
    {
        id:          "minhwaMV",
        title:       "MINHWA MV",
        category:    "민화 기반 퓨전 국악 뮤직비디오",
        subtitle:    "민화 기반 퓨전 국악 뮤직비디오",
        year:        "2023",
        tags:        ["graphic", "video", "creative-coding"],
        teammates:   null,
        content:     { leftCol: [], rightCol: [] },
        imageBlocks: [
            { layout: "full-bleed", hero: true,  count: 1, images: ["./projects/minhwaMV/9.png"] },
            { layout: "padded", hero: false, count: 3, images: ["./projects/minhwaMV/2.png", "./projects/minhwaMV/3.png", "./projects/minhwaMV/4.png"] },
            { layout: "padded", hero: false, count: 3, images: ["./projects/minhwaMV/5.png", "./projects/minhwaMV/6.png", "./projects/minhwaMV/7.png"] },
            { layout: "padded", hero: false, count: 3, images: ["./projects/minhwaMV/8.png", "./projects/minhwaMV/9.png", "./projects/minhwaMV/10.png"] },
        ],
        thumbnail16x9: "./projects/minhwaMV/thumb2.png",
        thumbnail9x16: "./projects/minhwaMV/thumb.png",
        websiteLink: "https://youtu.be/e90mSE8jOBA",
        url:         "./project.html?id=minhwaMV"
    },
    
    {
        id:          "sac",
        title:       "TYPE 'SAC'",
        category:    "글꼴보기집 '삭체'",
        subtitle:    "글꼴보기집 '삭체'",
        year:        "2023",
        tags:        ["graphic", "identity", "typography", "editorial", "exhibition"],
        teammates:   null,
        content:     { leftCol: ["칼을 빼들고 이야기해야만 하는 사람은 누구인가.\n투박하고도 날선 음성으로 말해야 하는 사람은 누구인가.", "글꼴 '삭체'는 외치는 자의 목소리를 날카로운 묵직함와 약간의 조악함을 통해 글꼴로 형상화하고자 했다. 글꼴의 모티프는 종이를 칼로 '사악' 그어낸 듯한 조형으로, 매 글자마다 한 장의 종이에 칼집을 낸 듯이 제작했다. 어린 아이가 자투리 종이를 잘라 붙인 듯도 하고, 마구잡이로 흠을 낸 듯도 한 이 글꼴은 강력하지만 동시에 완전히 정리되지 못한 목소리에서 영감을 얻었다."], rightCol: ["Who is it that must speak with a blade in hand?\nWho is it that must speak in a voice both crude and sharp?","The typeface 'Sak' (삭체) embodies the voice of one who screams, shaping it into a font characterized by a sharp weightiness and a touch of coarseness. The motif of the font is the visual form of a blade slicing through paper with a 'slash' (사악) sound; each character was crafted as if cutting a slit into a single sheet of paper. Reminiscent of a child cutting and pasting scraps of paper or creating haphazard gashes, this typeface was inspired by a voice that is powerful, yet not entirely refined."] },
        imageBlocks: [
            { layout: "full-bleed", hero: true,  count: 3, images: ["3:16", "./projects/sac/2.png", "3:16"] },
            { layout: "full-bleed", hero: false, count: 1, images: ["./projects/sac/1.png"] },
            { layout: "spacer", size: "xl" },
            { layout: "padded", hero: false, count: 2, images: ["./projects/sac/3.jpg", "./projects/sac/4.jpg"] },
            { layout: "padded", hero: false, count: 2, images: ["./projects/sac/5.jpg", "./projects/sac/6.jpg"] },
        ],
        thumbnail16x9: "./projects/sac/thumb2.png",
        thumbnail9x16: "./projects/sac/thumb.jpg",
        websiteLink: null,
        url:         "./project.html?id=sac"
    },
    
    {
        id:          "puresoon",
        title:       "PUReSOON",
        category:    "불결을 판매하는 브랜드",
        subtitle:    "불결을 판매하는 브랜드",
        year:        "2025",
        tags:        ["identity", "editorial", "typography"],
        teammates:   null,
        content:     { leftCol: ["PUReSOON은 오물을 통한 건강을 표방하는 쇼핑 플랫폼 퓨어순이지만, 내적으로는 불순 프로젝트로 작동한다.", "이 프로젝트의 목표는 티끌 없는 정원을 만들고자 하는 욕망이 얼마나 비자연적이고 모순적인지 드러내는 데 있다. 자연의 상을 추구하는 동시에 유익한 부분만을 선별적으로 추출하려는 병리적 욕망을 통제된 순수라는 컨셉으로 보여주려고 한다.", "포장에 능한 이 쇼핑몰은 외관상으로는 유익한 제품을 판매하는 것처럼 보인다. 하지만 한 걸음 물러나 바라보면 이곳은 과잉청결의 미학을 실현하는 공간이며, 도시인이 가진 위생 강박의 연장선 상에 있다.", "따라서, 퓨어순은 과잉청결에 익숙한 도시 거주자를 대상으로 자연 상태의 면역 복원이라는 가치를 지닌 제품을 제공한다. 퓨어순은 걱정 없는 더러움을 판매한다."], rightCol: ["While PUReSOON presents itself as a shopping platform advocating health through 'filth,' internally, it functions as the 'Impure Project.","The objective of this project is to expose the unnatural and contradictory nature of the desire to create a spotless garden. By presenting the concept of 'controlled purity,' it aims to reveal the pathological urge to pursue an image of nature while selectively extracting only its beneficial parts.","Expertly packaged, this shopping mall appears to sell wholesome products on the surface. However, stepping back reveals a space that realizes the aesthetics of hyper-cleanliness—an extension of the urbanite's obsession with hygiene.","Accordingly, PUReSOON provides products with the value of restoring one's natural immunity to city dwellers accustomed to hyper-cleanliness. PUReSOON sells 'carefree dirt.'"] },
        imageBlocks: [
            { layout: "full-bleed", hero: true,  count: 1, images: ["./projects/puresoon/1.jpg"] },
            { layout: "full-bleed", hero: false, count: 1, images: ["./projects/puresoon/2.mp4"] },
            { layout: "spacer", size: "xl" },
            { layout: "padded", hero: false, count: 1, images: ["./projects/puresoon/3.jpg"] },
            { layout: "padded", hero: false, count: 1, images: ["./projects/puresoon/4.jpg"] },
            { layout: "spacer", size: "xl" },

            { layout: "padded", hero: false, count: 1, images: ["./projects/puresoon/5.jpg"] },
            { layout: "padded", hero: false, count: 3, images: ["./projects/puresoon/6.jpg", "./projects/puresoon/7.jpg", "./projects/puresoon/8.jpg"] },
            { layout: "padded", hero: false, count: 2, images: ["./projects/puresoon/9.jpg", "./projects/puresoon/10.jpg"] },
        ],
        thumbnail16x9: "./projects/puresoon/thumb2.png",
        thumbnail9x16: "./projects/puresoon/thumb.png",
        websiteLink: null,
        url:         "./project.html?id=puresoon"
    },
    
    
    {
        id:          "img-objectifier",
        title:       "IMG OBJECTIFIER",
        category:   "객관적 이미지 분석 웹사이트",
        subtitle:    "객관적 이미지 분석 웹사이트",
        year:        "2025",
        tags:        ["website", "creative-coding"],
        teammates:   null,
        content:     { leftCol: ["“이미지를 객관적으로 바라보는 것이 가능할까?”라는 질문에서 시작된 본 웹사이트는 시각물의 구조와 초점을 AI의 시선으로 재해석하는 웹 기반 분석 도구입니다. 사진, 포스터, 영상 썸네일 등 사용자가 선택한 시각 요소에서 인간의 주의력이 집중되는 지점을 계산하여 Saliency Map으로 시각화합니다." , "OpenCV와 Deepgaze 라이브러리를 활용하여 객체 감지 및 시각적 중심선, 형태 추상화 등의 데이터를 추출하며, 이미지를 '보는 방식'을 탐구합니다. 창작자는 이 웹사이트를 통해 자신이 의도한 대로 이미지가 받아들여지는지 일차적으로 검토할 수 있습니다."], rightCol: ["Starting with the question, 'Is it possible to look at images more objectively?', this website is a web-based analysis tool that reinterprets the structure and focus of visuals through the lens of AI. It calculates where human attention is concentrated within user-selected elements—such as photos, posters, and video thumbnails—and visualizes these areas through Saliency Maps.", "By utilizing the OpenCV and Deepgaze libraries, the tool extracts data such as object detection, visual center lines, and shape abstraction to explore the fundamental ways we 'see' images. Through this website, creators can perform a primary review of whether their images are being perceived as intended."] },
        imageBlocks: [
            { layout: "full-bleed", hero: true,  count: 1, images: ["./projects/img-objectifier/1.png"] },
            { layout: "full-bleed", hero: false, count: 2, images: ["./projects/img-objectifier/2.png", "./projects/img-objectifier/3.png"] },
        ],
        thumbnail16x9: "./projects/img-objectifier/thumb2.png",
        thumbnail9x16: "./projects/img-objectifier/thumb.png",
        websiteLink: "https://image-objctifier.onrender.com/",
        url:         "./project.html?id=img-objectifier"
    }
    
];

export const tagConfigs = {
    graphic: {
        styleType: "default-dash",
        styleRole: "line",
        attraction: 0.0000028,
        floatScale: 0.000019,
        hullPadding: 3,
        dash: "",
        strokeWidth: 5.25,
        opacity: 1
    },
    editorial: {
        styleType: "pixel-cross",
        styleRole: "fill",
        attraction: 0.0000082,
        floatScale: 0.000024,
        hullPadding: 2.3,
        dash: "",
        strokeWidth: 2,
        opacity: 1
    },
    website: {
        styleType: "pixel-line",
        styleRole: "line",
        attraction: 0.0000156,
        floatScale: 0.00003,
        hullPadding: 2.3,
        dash: "",
        strokeWidth: 2.0,
        opacity: 1
    },
    identity: {
        styleType: "default",
        styleRole: "fill",
        attraction: 0.0000023,
        floatScale: 0.000023,
        hullPadding: 1.75,
        dash: "",
        strokeWidth: 2,
        opacity: 1
    },
    illustration: {
        styleType: "halftone",
        styleRole: "fill",
        attraction: 0.000008,
        floatScale: 0.00002,
        hullPadding: 1.55,
        dash: "",
        strokeWidth: 1.3,
        opacity: 1
    },
    exhibition: {
        styleType: "arrow-line",
        styleRole: "line",
        attraction: 0.0000255,
        floatScale: 0.000025,
        hullPadding: 1.2,
        dash: "3 6",
        strokeWidth: 1,
        opacity: 1
    },
    "creative-coding": {
        styleType: "checkerboard",
        styleRole: "fill",
        attraction: 0.000087,
        floatScale: 0.000026,
        hullPadding: 1.85,
        dash: "",
        strokeWidth: 2.2,
        opacity: 1
    },
    "typography": {
        styleType: "default-dash",
        styleRole: "line",
        attraction: 0.0000178,
        floatScale: 0.000018,
        hullPadding: 0.5,
        dash: "1 15",
        strokeWidth: 5,
        opacity: 1
    },
    video: {
        styleType: "tinted-default-fill",
        styleRole: "fill",
        attraction: 0.000001,
        floatScale: 0.000028,
        hullPadding: 2.95,
        dash: "",
        strokeWidth: 3.75,
        opacity: 1
    }
};

export const STYLE_ENUMS = {
    "default": 0,
    "tinted-default-fill": 1,
    checkerboard: 2,
    "pixel-cross": 3,
    halftone: 4,
    "arrow-line": 5,
    "pixel-line": 6,
    "default-dash": 7
};

export const TAG_KEYS = Object.keys(tagConfigs);

export const TAG_INDEX_MAP = TAG_KEYS.reduce((acc, tag, index) => {
    acc[tag] = index;
    return acc;
}, {});

export const TAG_STYLE_IDS = TAG_KEYS.map((tag) => STYLE_ENUMS[tagConfigs[tag].styleType] ?? STYLE_ENUMS.default);
