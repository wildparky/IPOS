# 프로젝트·미디어 저장

실제 기준 구현: [저장소 상세](../PROJECT-STORAGE.md).

```text
~/.franklin/
├─ projects/
│  ├─ <id>.json
│  ├─ <id>/media/uploads/<sha256>.<ext>
│  ├─ <id>/media/generated/<sha256>.<ext>
│  └─ .backups/
└─ web-jobs/
   ├─ 생성 결과 파일
   ├─ bridge-inputs/
   └─ topview-work/<jobId>/task.json
```

JSON에는 노드·연결·설정·미디어 URL을 저장합니다.
기존 파일명과 호환되도록 JSON은 프로젝트 디렉터리 밖의 <id>.json을 유지합니다.
미디어는 원본 바이트의 해시로 중복을 줄이고 저장 후 검증합니다.
생성 결과는 프로젝트 저장 시 복사되며 기존 공용 파일은 삭제하지 않습니다.

## API

- GET /api/projects?summary=1: 이름, 커버 URL, 개수, revision 등 요약
- GET /api/projects/<id>: 선택한 전체 graph
- GET /api/projects: 기존 전체 목록 호환 API
- POST /api/projects/save: project와 baseRevision
- POST /api/projects/delete: id와 baseRevision
- GET /api/project-media/...: 파일 제공, Range 지원
- POST /api/media/audit: 읽기 전용 사용량·후보 검사

목록은 요약만 전달하지만 서버는 현재 JSON을 읽어 요약합니다. 별도 DB 색인은 없습니다.
커버 URL은 실제 미디어 URL이며 축소 thumbnail을 별도로 생성하지 않습니다.

## 충돌과 복구

같은 프로젝트의 오래된 revision 저장은 차단합니다. 충돌 후 초안을 내보낸 다음 새로고침하세요.
Projects의 브라우저 데이터 복구는 기존 localStorage 데이터를 새 ID의 복구 프로젝트로 가져옵니다.
기존 브라우저 저장소는 자동 삭제하지 않습니다.
Agent 대화·설정·컬렉션 등은 여전히 브라우저 origin별로 다를 수 있습니다.

프로젝트·노드 삭제 시 참조 파일은 보존합니다. audit의 후보는 삭제 승인 목록이 아닙니다.
다른 브라우저의 미저장 컬렉션/초안까지 검사할 수 없고, 실제 정리 API도 없습니다.
백업은 누적되므로 디스크 사용량에 주의하세요.

이전 도구는 backend 정지 및 백업 후 실행해야 합니다. 실행 중인 다른 클라이언트도 새로고침해야 합니다.
다른 기기로 이전할 때는 JSON만이 아니라 media, cross-project 참조, 필요한 web-jobs도 함께 보관하세요.
