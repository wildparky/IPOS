# 설치와 실행

이 저장소의 현재 구현 기준입니다. Codex 호스트의 기능 지원 여부는 설치된 CLI에 따라 다릅니다.
SQLite 저장소는 Node.js 24 이상을 기준으로 검증합니다(`node:sqlite` 사용).
현재 검증 런타임(Node 24.14.0)은 SQLite ExperimentalWarning을 출력합니다. 이를 숨기지 않습니다.
업데이트 전 서버를 정지하고 `~/.franklin/projects` 전체를 백업하세요.
첫 시작 시 기존 JSON이 DB로 이전되며 원본은 보존됩니다.

## 로컬 실행

```powershell
git clone https://github.com/wildparky/franklin-canvas.git
cd franklin-canvas
npm ci
```

별도 터미널 두 개에서 실행합니다.

```powershell
node server.mjs
```

```powershell
npm run dev -- --host 127.0.0.1 --port 5188 --strictPort
```

백엔드는 기본 3100, 위 프런트엔드는 5188입니다. Vite의 /api 요청은 백엔드로 프록시됩니다.
3100을 바꾸면 vite.config.ts의 프록시도 맞춰야 합니다.

## Codex / TopView

공식 Codex CLI를 설치한 뒤 해당 서버 OS 사용자로 지원되는 로그인 절차를 완료하세요.

```powershell
codex login
codex mcp add topview-mcp --url https://mcp.topview.ai/mcp
codex mcp login topview-mcp
node scripts/probe-topview-mcp.mjs
```

이미 등록된 MCP는 중복 추가하지 않습니다. probe는 조회 전용이며 유료 생성을 하지 않습니다.
필요하면 FRANKLIN_CODEX_CLI_PATH로 CLI 실행 파일 또는 공식 npm 진입점을 지정합니다.
TopView 경로에는 app-server의 mcpServerStatus/list 및 mcpServer/tool/call 지원이 필요합니다.

Codex OAuth를 OpenAI REST API 키로 변환하지 않습니다.
Codex 이미지 기능이 호스트에서 제공되지 않으면 별도 API 키 방식으로 자동 대체하지 않습니다.
OAuth 승인은 서비스별로 필요하며 웹사이트 로그인과 MCP 인증이 자동으로 같아지는 것은 아닙니다.

## 검증

```powershell
npm run typecheck
npm test
npm run build
```

생성 테스트는 provider 비용이 발생할 수 있습니다. 일반 단위 테스트와 probe는 실제 생성 검증을 대체하지 않습니다.
