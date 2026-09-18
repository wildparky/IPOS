# 구조와 역할

기존 브리지 구현: [fb6ff30](https://github.com/wildparky/IPOS/commit/fb6ff30).
저장소는 후속 SQLite 전환과 노드 단위 병합·3초 간격 변경 반영을 포함합니다.

```text
React / React Flow Canvas → Franklin Node backend
  ├─ Media Agent: 도구 호출 및 워크플로 orchestration
  ├─ Codex OAuth Bridge: reasoning / 이미지 생성·편집
  ├─ Codex app-server → TopView MCP: Seedance 영상 생성
  └─ Project storage: SQLite / 버전 검사 / 미디어 파일 제공
```

## 주요 코드

| 파일 | 역할 |
|---|---|
| src/views/CanvasView.tsx | 노드·연결, 생성 실행, Agent의 캔버스 도구 구현 |
| src/canvas/agentTools.ts | 프런트엔드 도구 분배 |
| agent-tools.mjs | Agent 대화와 백엔드 도구 |
| codex-agent-bridge.mjs | 공식 Codex 실행 경로 기반 위임 |
| codex-mcp-client.mjs | 공식 app-server MCP 호출 |
| topview-video-bridge.mjs | schema 확인, 참조 업로드, 1회 제출, polling, 결과 import |
| sqlite-project-storage.mjs | 프로젝트·노드·연결 DB, JSON 이전, revision 및 부분 변경 API |
| src/projects.ts / src/projectMerge.ts | 로컬 초안, 부분 저장, 3-way 병합, 원격 polling·충돌 보존 |
| project-storage.mjs / project-media.mjs | 구 JSON 저장소 호환 도구와 미디어 파일 분리 |
| media-audit.mjs | 삭제 없는 미디어 사용량 조회 |

기존 BlockRun 제공 기능은 유지됩니다. 새로운 경로와 기존 제공자의 인증·비용은 별개입니다.
설정의 표시 이름만으로 실제 이미지 백엔드 버전을 확정할 수 없습니다.

## 동시 접속

프로젝트는 서버 공용이며 사용자별 권한 분리가 없습니다.
서로 다른 노드·연결의 동시 변경은 병합하고, 같은 노드의 변경은 충돌로 중단합니다.
Canvas와 Media Agent 모두 같은 부분 저장 경로를 거칩니다.
프로젝트 목록은 5초, 열린 캔버스는 3초 polling으로 갱신합니다.
선택 상태는 공유하지 않으며 공동 커서·편집 잠금·CRDT·사용자별 권한은 없습니다.
동기화는 생성 작업을 다시 실행하지 않지만, 두 사용자의 의도적인 중복 생성 요청까지 차단하지는 않습니다.
