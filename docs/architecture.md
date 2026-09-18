# 구조와 역할

기준 구현: [fb6ff30](https://github.com/wildparky/franklin-canvas/commit/fb6ff30). 이 문서는 해당 구현을 설명하며 실시간 공동 편집은 포함하지 않습니다.

```text
React / React Flow Canvas → Franklin Node backend
  ├─ Media Agent: 도구 호출 및 워크플로 orchestration
  ├─ Codex OAuth Bridge: reasoning / 이미지 생성·편집
  ├─ Codex app-server → TopView MCP: Seedance 영상 생성
  └─ Project storage: 버전 검사 / 파일 저장 / 미디어 제공
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
| project-storage.mjs / project-media.mjs | revision 저장과 미디어 파일 분리 |
| media-audit.mjs | 삭제 없는 미디어 사용량 조회 |

기존 BlockRun 제공 기능은 유지됩니다. 새로운 경로와 기존 제공자의 인증·비용은 별개입니다.
설정의 표시 이름만으로 실제 이미지 백엔드 버전을 확정할 수 없습니다.

## 동시 접속

프로젝트는 서버 공용이며 사용자별 권한 분리가 없습니다.
같은 프로젝트를 여러 기기에서 수정하면 revision 충돌로 뒤의 저장을 차단합니다.
노드 병합·실시간 공동 편집·편집 잠금은 아직 구현되지 않았습니다.
목록 polling은 열린 캔버스를 실시간 갱신하지 않습니다.
