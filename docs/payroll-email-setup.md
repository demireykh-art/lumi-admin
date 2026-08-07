# 사전급여대장 노무사 이메일 자동 전송 — 설정 가이드

통합앱 급여탭의 **✉️ 노무사 이메일 전송** 버튼은 Cloud Function `sendPrePayrollEmail`을 통해
회사 **구글 워크스페이스 계정**으로 사전급여대장(xlsx)을 노무사에게 첨부 발송합니다.

발송이 되려면 아래 3가지 설정이 **최초 1회** 필요합니다.

## 1. Gmail API 사용 설정
- Google Cloud 콘솔(프로젝트 `lumiclinic-c1a95`) → **API 및 서비스 → 라이브러리** → **Gmail API** → **사용 설정**

## 2. 서비스계정 도메인 전체 위임 (핵심)
발송은 기존 Drive용 서비스계정(`DRIVE_SERVICE_KEY`)을 재사용합니다.
이 서비스계정이 워크스페이스 사용자를 대신해 메일을 보내도록 **도메인 전체 위임**을 추가합니다.

1. 서비스계정의 **클라이언트 ID(client_id)** 확인
   - Google Cloud 콘솔 → IAM 및 관리자 → 서비스 계정 → 해당 계정 → 고유 ID(숫자)
2. **Google Workspace 관리콘솔**(admin.google.com) → **보안 → 액세스/데이터 제어 → API 제어 → 도메인 전체 위임 관리**
3. **새로 추가**:
   - 클라이언트 ID: 위 서비스계정 client_id
   - OAuth 범위: `https://www.googleapis.com/auth/gmail.send`
   - 저장

## 3. 발신 계정(보내는 사람)
- 전송 시 입력하는 **발신 계정**은 위 워크스페이스 도메인의 **실제 사용자 이메일**이어야 합니다.
  (예: `admin@lumiclinic.co.kr`) — 서비스계정이 이 사용자를 대신해 발송합니다.
- 노무사 이메일·발신 계정은 첫 전송 시 입력하면 `settings/payroll` 에 저장되어 다음부터 자동 채워집니다.

## 4. 함수 배포
```bash
firebase deploy --only functions:sendPrePayrollEmail --project lumiclinic-c1a95
```
> `DRIVE_SERVICE_KEY` 시크릿은 기존 Drive 기능과 동일하게 사용합니다(추가 시크릿 불필요).

## 권한
- 이 기능은 **경영관리자(`settings/bizAdmins.emails`)** 계정만 호출할 수 있습니다(서버 검증).

## 문제 해결
- "Gmail 인증 실패": 2번 도메인 위임(scope `gmail.send`)·발신 계정이 워크스페이스 사용자인지 확인
- "발송 실패": Gmail API 사용 설정(1번), 발신 계정 철자 확인
