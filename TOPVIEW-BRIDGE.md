# TopView MCP 브리지

Franklin의 영상 작업은 공식 `codex app-server --stdio` 호스트를 사용합니다.
호스트가 등록된 MCP 서버를 읽고 TopView OAuth를 관리합니다.
Franklin은 OAuth 자격증명을 직접 읽거나 API 키로 재사용하지 않으며,
영상 도구 탐색·제출·상태 조회를 언어 모델에 맡기지 않습니다.

## 설정

공식 Codex CLI를 설치해 PATH에서 실행 가능하게 합니다.
서버가 아직 등록되지 않았다면 다음과 같이 등록하고 로그인합니다.

```powershell
codex mcp add topview-mcp --url https://mcp.topview.ai/mcp
codex mcp login topview-mcp
node scripts/probe-topview-mcp.mjs
```

진단 스크립트는 도구 탐색과 생성 설정만 조회하며 유료 영상을 생성하지 않습니다.
설정 변경 후 Franklin 백엔드를 재시작하세요.
공식 실행 파일이나 npm CLI 진입점을 직접 지정하려면
`FRANKLIN_CODEX_CLI_PATH`를 사용합니다.
설치된 CLI의 app-server 프로토콜이 `mcpServerStatus/list`와
`mcpServer/tool/call`을 지원해야 합니다.

## 실행 흐름

1. 공식 호스트와 임시 MCP 작업을 초기화합니다. 모델 추론 요청은 실행하지 않습니다.
2. 실제 서버의 도구 스키마를 조회하고 필요한 영상 도구 3개를 확인합니다.
3. 선택한 작업 유형으로 `topview_get_generation_config`를 호출하여
   Seedance 모델, 입력 모드, 길이, 해상도, 비율을 검증합니다.
4. `ta_upload_credential`로 받은 비공개 URL에 PUT으로 참조 파일을 업로드한 뒤
   `ta_upload_check_file`로 확인합니다. 업로드 URL은 메모리에서만 사용하며
   로그나 작업 기록에 저장하지 않습니다.
5. 탐색으로 확인한 `topview_generate_video` 도구를 한 번만 호출합니다.
6. 작업 ID를 저장하고 `topview_query_task`로 상태를 조회한 뒤
   결과 영상 파일을 Franklin 생성 미디어 저장소로 가져옵니다.

`get_tool_schema`는 지연 탐색형 데이터 도구용이며 직접 노출되는 영상 도구에는 사용하지 않습니다.
제출에는 지원되는 파라미터만 포함합니다. 입력 이미지에서 비율을 결정하는 모델은
Image to Video 요청의 `aspectRatio`를 생략합니다.
현재 독립 실행형 도구 스키마에는 오디오 전환 필드가 없으므로
이 인터페이스를 통해 `generateAudio`를 강제할 수 없습니다.

ETA와 진행률은 TopView가 보고한 값만 전달합니다.
누락된 값은 null로 유지하며, 로컬 경과시간은 제공자의 예상 완료시간이 아닙니다.

## 복구와 자격증명

OAuth 저장은 사용자의 Codex 홈 또는 자격증명 저장소에서 Codex가 관리합니다.
Franklin은 해당 자격증명 파일을 파싱하지 않습니다.
작업 기록은 `~/.franklin/web-jobs/topview-work/<jobId>/task.json`에 저장하며,
모델·옵션·작업 ID와 완료 후 결과 URL을 포함합니다.
프롬프트, 업로드 URL, 인증 토큰은 포함하지 않습니다.
결과 URL은 비공개 미디어 링크로 취급하세요.

상태 조회나 가져오기가 실패하면 저장된 작업 ID와 결과로 복구하고 자동 재제출하지 않습니다.
제출 중 통신 오류가 나면 원격 처리 여부가 불확실할 수 있습니다.
브리지는 유료 제출을 자동 재시도하지 않습니다.

로컬 검증 명령: `npm test`, `npm run typecheck`, `npm run build`.
