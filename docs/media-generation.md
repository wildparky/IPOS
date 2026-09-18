# 미디어 생성과 Canvas

## 이미지

Codex 위임으로 reasoning 및 built-in 이미지 생성·편집을 요청합니다.
실제 기능 노출은 Codex 실행 환경에 의존합니다. 특정 GPT Image 버전이 선택된다고 UI 이름만 보고 판단하지 마세요.
이미지 편집은 원본 노드를 보존하는 흐름을 사용합니다.

## TopView 영상

선택한 taskType으로 최신 generation config와 실제 tool schema를 확인한 뒤 제출합니다.

| UI 모드 | taskType / 주요 필드 |
|---|---|
| Text to Video | text_to_video / prompt |
| Image to Video | image_to_video / firstFrameFileId |
| First · Last | image_to_video / firstFrameFileId, 선택적 endFrameFileId |
| Omni Reference | omni_reference / inputImages, prompt |

지원 모델·길이·해상도·비율은 모델별 config를 기준으로 검증합니다.
모든 Seedance 모델이 모든 모드를 지원한다고 가정하면 안 됩니다.
이미지에서 비율을 결정하는 모드는 aspectRatio를 생략합니다.

TopView 참조 파일은 원본 바이트로 업로드합니다.
private upload URL은 메모리에서만 사용하고, 업로드 확인 후 fileId를 제출합니다.
Omni 프롬프트는 첨부 순서에 대응하는 `<<<Image1>>>`, `<<<Image2>>>` 형식으로 작성하세요.
Canvas의 `@노드ID`가 이 토큰으로 자동 변환된다고 가정하지 마세요.

작업은 한 번만 제출하고 task ID로 상태를 조회합니다.
ETA/progress는 provider가 제공한 경우에만 표시하며 경과시간은 예상 완료시간이 아닙니다.
응답의 상세 메시지 일부는 현재 일반 오류 코드로 축약될 수 있습니다.
오류가 났다고 과금이 없었다고 단정하거나 자동 재제출하지 마세요.

## 업로드 / 재사용

탐색기 다중 이미지 드롭은 photo 노드를 최대 4열로 배치합니다.
화면의 노드 크기는 원본 비율을 따르며 원본 파일을 재인코딩하지 않습니다.
새 업로드는 최초 저장까지 data URL을 사용하고 이후 파일 참조로 치환됩니다.
노드 삭제는 파일 즉시 삭제가 아닙니다.

상세 프로토콜: [TopView bridge](../TOPVIEW-BRIDGE.md).
