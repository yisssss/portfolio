import {renderMixedLines} from "./typography.js";

const LEFT_PARAGRAPHS = ["박세정은 그래픽 디자인과 코딩 사이 어딘가에서 작업하는 디자이너입니다. 브랜드 아이덴티티, 웹 인터페이스, 전시 그래픽 등 다양한 형식을 오가며, 각각의 프로젝트가 고유한 시각 언어를 가질 수 있도록 접근합니다. 단순하고 명확한 구조 안에서 예기치 않은 질감과 움직임을 찾는 것을 즐깁니다.", "현재 서울을 기반으로 활동하며 프리랜서 협업 및 레지던시 기회를 찾고 있습니다. 그래픽, 웹, 영상, 설치 등 매체를 가리지 않고 함께 만들어갈 수 있는 작업이라면 언제든지 연락 주세요."];

const RIGHT_PARAGRAPHS = ["Park Sejeong is a graphic designer and creative coder based in Seoul. Her practice moves across identity systems, interactive media, and exhibition design — treating each project as a site where visual language and lived experience intersect. She studied communication design at Hongik University and has collaborated with cultural institutions, independent studios, and technology companies.","Currently open to freelance projects and collaborations — particularly those involving visual identity, interactive web, and generative or editorial work. If you have something interesting in mind, feel free to reach out."];

const leftEl = document.getElementById("about-col-left");
const rightEl = document.getElementById("about-col-right");

if (leftEl) {
    renderMixedLines(LEFT_PARAGRAPHS, leftEl);
}
if (rightEl) {
    renderMixedLines(RIGHT_PARAGRAPHS, rightEl);
}
