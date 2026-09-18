# LAN / Tailscale HTTPS와 보안

Franklin은 현재 다중 사용자용 인증·권한 분리가 없는 로컬 도구입니다.
Media Agent에는 파일·명령 실행 기능이 있으므로 인터넷에 직접 공개하지 마세요.

## LAN HTTP

```powershell
npm run dev -- --host 0.0.0.0 --port 5188 --strictPort
```

클라이언트에서는 http://서버의내부IP:5188 로 접근합니다.
0.0.0.0은 수신 설정이지 접속 주소가 아닙니다.
다른 네트워크에서는 VPN 같은 경로가 필요합니다. 방화벽을 무조건 해제하지 마세요.
백엔드는 127.0.0.1:3100에 두고 Vite 프록시를 이용합니다.

UUID는 src/uuid.ts의 native randomUUID / getRandomValues 기반 대체 구현을 사용합니다.
이는 HTTP 렌더링 호환성 보완이지 HTTP의 암호화를 제공하는 기능이 아닙니다.

## Tailscale Serve

이 서버에서 사용한 구성:

```powershell
tailscale serve status
tailscale serve --bg --https=443 http://127.0.0.1:5188
```

관리자의 Serve/HTTPS 활성화가 요구될 수 있습니다.
성공 시 CLI가 출력하는 https://기기이름.tailnet.ts.net/ 주소로 접속합니다.
5188 포트를 붙이지 않습니다. 노트북은 접근 권한이 있는 tailnet에 연결되어 있어야 합니다.
Funnel은 인터넷 공개 기능이므로 이 구성에서는 사용하지 않습니다.

vite.config.ts의 allowedHosts에는 실제 기기의 정확한 Tailscale DNS 이름을 지정하세요.
현재 저장소의 값은 개발 환경용이므로 다른 기기에서는 수정해야 합니다. 모든 호스트 허용으로 대체하지 마세요.
Tailscale Serve는 OS의 설정이며 Git clone으로 복원되지 않습니다.

```powershell
tailscale serve --https=443 off
```

위 명령은 해당 포트의 Serve 프록시를 끕니다. 기존 다른 서비스 설정이 있는지 먼저 확인하세요.
HTTPS만 사용할 경우 프런트엔드도 loopback 수신으로 제한할 수 있습니다.
현재 0.0.0.0으로 띄운 HTTP가 HTTPS 설정만으로 자동 차단되지는 않습니다.

## 데이터와 인증

HTTP localhost, 내부 IP, HTTPS DNS는 서로 다른 브라우저 origin입니다.
서버 프로젝트는 공유하지만 브라우저 전용 데이터는 새 origin으로 자동 복사되지 않습니다.
Codex/TopView OAuth는 서버 호스트가 관리하며 클라이언트에 자격증명을 전달하지 않습니다.
HTTPS는 암호화이며 Franklin 자체의 사용자 인증이나 권한 제어를 대신하지 않습니다.
