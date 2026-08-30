# 재고닥 부트스트랩 키트 (P0)

이 폴더는 **재고닥 레포의 초기 내용물**입니다. `lumi-admin` 안에 들어 있지만
**루미와 아무 관계가 없습니다** — 새 레포로 옮겨 담기 위한 짐입니다.

> **루미 코드는 이 작업으로 한 줄도 바뀌지 않았습니다.**

---

## 원장님이 하실 일 — 30분

### 1. GitHub 레포 만들기

<https://github.com/new> 에서

- 이름: `jaegodoc`
- **Private**
- README·.gitignore·license **체크하지 마세요** (여기 다 들어 있습니다)

### 2. 이 폴더 내용을 새 레포에 넣기

```powershell
# 새 레포를 받을 자리 (루미 폴더 밖에)
cd C:\dev
git clone https://github.com/demireykh-art/jaegodoc.git
cd jaegodoc

# 이 폴더 "안의 것들"을 복사합니다. 폴더째가 아닙니다.
Copy-Item -Recurse -Force C:\경로\lumi-admin\jaegodoc-bootstrap\* .

git add -A
git commit -m "P0 — 멀티테넌시 뼈대"
git push
```

### 3. Firebase 프로젝트 만들기

<https://console.firebase.google.com> → 프로젝트 추가

| 항목 | 값 |
| --- | --- |
| 프로젝트 이름 | `jaegodoc-prod` |
| Google 애널리틱스 | **끕니다** (지금 필요 없음) |

만든 뒤 **콘솔에서 세 가지**를 켭니다.

1. **Authentication** → 시작하기 → **이메일/비밀번호** 사용 설정
2. **Firestore Database** → 데이터베이스 만들기
   → **프로덕션 모드** → 위치 **`asia-northeast3` (서울)**
   > ⚠️ **위치는 나중에 못 바꿉니다.** 서울이 맞는지 확인하고 누르세요.
3. **Storage** → 시작하기 → 같은 위치

그리고 **요금제를 Blaze(종량제)로 올립니다.**
> Cloud Functions 가 외부 네트워크(비전 API)를 호출하려면 Blaze 가 필요합니다.
> 무료 할당량은 그대로라, 파일럿 규모에서는 **실제 청구액이 사실상 0원**입니다.
> 그래도 불안하면 **예산 알림**을 월 1만원으로 걸어 두세요 (GCP 콘솔 → 결제 → 예산).

### 4. 웹 앱 등록 → 설정값 넣기

콘솔 → 프로젝트 설정 → 「내 앱」 → 웹 앱 추가 (`재고닥`).
나오는 `firebaseConfig` 를 복사해서 **`public/firebase-config.js`** 에 붙여넣습니다.
(`public/firebase-config.example.js` 를 복사해서 이름을 바꾸면 됩니다.)

> 이 값들은 비밀이 아닙니다. 공개돼도 됩니다 — 접근 통제는 Rules 가 합니다.
> 그래도 `.gitignore` 에 넣어 뒀습니다. 프로젝트마다 다르기 때문입니다.

### 5. 배포

```powershell
npm install -g firebase-tools     # 처음 한 번만
firebase login
firebase use --add                # jaegodoc-prod 선택, 별칭 default

npm install
cd functions
npm install
cd ..

firebase deploy
```

### 6. 첫 병원·첫 계정 만들기

배포된 주소로 들어가 **회원가입**합니다. 첫 사용자는 자동으로
**자기 병원의 owner** 가 됩니다 (`functions/index.js` 의 `bootstrapClinic`).

---

## 개발자가 쓰는 명령

```powershell
npm run emu          # 에뮬레이터 (Auth + Firestore + Functions)
npm test             # Rules 테스트 — 에뮬레이터가 떠 있어야 합니다
firebase deploy --only firestore:rules
firebase deploy --only functions
```

## 폴더 구조

```
firestore.rules            멀티테넌시 접근 통제 ★ 여기가 보안의 전부
firestore.indexes.json     복합 인덱스
firebase.json              배포 대상
public/
  index.html               로그인 + 앱 셸 (P1 에서 화면이 붙습니다)
  repo.js         ★        데이터 접근 계층 — 앱은 Firestore 를 직접 안 봅니다
  auth.js                  로그인·클레임·테넌시
  firebase-config.js       (직접 만듭니다. git 에 안 올라갑니다)
functions/
  index.js                 클레임 부여·병원 생성·초대
scripts/
  migrate-from-lumi.js     루미 → 재고닥 이관 (읽기 전용 report 모드)
docs/
  ARCHITECTURE.md   ★      왜 Firebase 인가, 락인을 어떻게 줄이나
  DATA-MODEL.md            컬렉션 스키마
tests/
  rules.test.js            Rules 테스트 — 남의 병원 데이터가 안 보이는지
```

## 다음 단계 (P1)

품목·위치·등급·UOM. `docs/DATA-MODEL.md` 의 `items` 를 화면으로 만듭니다.
**`packSize` 와 `trackMode` 를 P1 에서 확실히 세워야 합니다** — P2(명세서 OCR)가
그 위에 올라갑니다. `RESEARCH.md` §D-3 을 같이 보세요.
