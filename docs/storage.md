# 프로젝트·미디어 저장

실제 기준 구현: [저장소 상세](../PROJECT-STORAGE.md).

```text
~/.franklin/
├─ projects/
│  ├─ <id>.json
│  ├─ projects.sqlite (+ 실행 중 WAL/SHM 파일)
│  ├─ <id>/media/uploads/<sha256>.<ext>
│  ├─ <id>/media/generated/<sha256>.<ext>
│  └─ .backups/
└─ web-jobs/
   ├─ 생성 결과 파일
   ├─ bridge-inputs/
   └─ topview-work/<jobId>/task.json
```

현재 기준 데이터는 SQLite의 프로젝트·노드·연결 테이블에 저장합니다.
기존 `<id>.json`은 최초 이전 원본으로 보존하며, 이후 변경을 반영하는 파일이 아닙니다.
미디어는 원본 바이트의 해시로 중복을 줄이고 저장 후 검증합니다.
생성 결과는 프로젝트 저장 시 복사되며 기존 공용 파일은 삭제하지 않습니다.

## API

- GET /api/projects?summary=1: 이름, 커버 URL, 개수, revision 등 요약
- GET /api/projects/<id>: 선택한 전체 graph
- GET /api/projects: 기존 전체 목록 호환 API
- POST /api/projects/save: project와 baseRevision
- POST /api/projects/delete: id와 baseRevision
- POST /api/projects/patch: id와 patch(변경할 노드·연결의 before/after)
- GET /api/project-media/...: 파일 제공, Range 지원
- POST /api/media/audit: 읽기 전용 사용량·후보 검사

목록은 DB에 저장한 요약만 읽으며 전체 노드·연결을 역직렬화하지 않습니다.
커버 URL은 실제 미디어 URL이며 축소 thumbnail을 별도로 생성하지 않습니다.

## 충돌과 복구

구 클라이언트의 전체 저장은 오래된 revision이면 차단합니다. 충돌 후 초안을 내보낸 다음 새로고침하세요.
노드·연결별 patch API는 변경 대상의 이전 값이 일치할 때만 적용하고, 무관한 변경은 보존합니다.
현재 Canvas와 Media Agent는 같은 노드·연결별 부분 저장 경로를 사용합니다.
300ms 동안의 로컬 변경을 모아 저장하고, 열린 캔버스는 3초마다 원격 변경을 조회합니다.
서로 다른 노드·연결 수정은 병합하지만 같은 노드가 양쪽에서 변경되면 저장을 중단하고 복구본을 보호합니다.
노드 안의 서로 다른 속성까지 자동 병합하는 방식은 아닙니다.
선택 상태와 드래그 중 표시 등은 공유하지 않고, 원격 변경 반영 시 화면 전체 Undo 이력은 초기화합니다.
저장 중 생긴 후속 수정은 응답 위에 병합하며, 이 과정에서 생성 도구를 재실행하지 않습니다.
신규 노드 ID는 브라우저 간 충돌을 피하도록 UUID를 사용합니다.
Projects의 브라우저 데이터 복구는 기존 localStorage 데이터를 새 ID의 복구 프로젝트로 가져옵니다.
기존 브라우저 저장소는 자동 삭제하지 않습니다.
Agent 대화·설정·컬렉션 등은 여전히 브라우저 origin별로 다를 수 있습니다.

프로젝트·노드 삭제 시 참조 파일은 보존합니다. audit의 후보는 삭제 승인 목록이 아닙니다.
다른 브라우저의 미저장 컬렉션/초안까지 검사할 수 없고, 실제 정리 API도 없습니다.
백업은 누적되므로 디스크 사용량에 주의하세요.
실시간 공동 커서·사용자별 권한·생성 작업 잠금은 아직 없습니다. 동일 노드에서 여러 사용자가
각각 생성 버튼을 누르는 것을 막는 기능과는 다릅니다. 생성 비용이 있는 작업은 담당자를 정해 실행하세요.

이전 도구는 backend 정지 및 백업 후 실행해야 합니다. 실행 중인 다른 클라이언트도 새로고침해야 합니다.
다른 기기로 이전할 때는 서버를 정지한 뒤 projects 폴더 전체(DB와 남아 있는 WAL/SHM 포함),
media, cross-project 참조, 필요한 web-jobs를 함께 보관하세요. 실행 중 DB 본체만 복사하면 안 됩니다.
