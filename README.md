# 보험 대본 생성기 — 지사 공유용 배포 가이드

이 폴더를 그대로 배포하면, 지사원들이 링크 하나로 접속해서 쓸 수 있는 보험 대본 생성 웹앱이 됩니다.
배포는 무료(Vercel 무료 플랜)이고, 실제로 드는 비용은 대본을 생성할 때마다 나가는 API 사용량뿐입니다.

---

## 준비물

1. **Anthropic API 키** (claude.ai Pro 구독과는 별개입니다. Pro는 채팅용, 이건 웹앱이 자동으로 AI를 호출할 때 쓰는 열쇠예요.)
2. **Vercel 계정** (무료, GitHub 계정으로 1분이면 가입됩니다)
3. (선택) **GitHub 계정** — 없어도 Vercel CLI로 바로 배포 가능합니다

---

## 1단계 — API 키 발급받기

1. https://console.anthropic.com 접속 후 가입/로그인
2. 왼쪽 메뉴에서 **API Keys** 클릭 → **Create Key**
3. 생성된 키(`sk-ant-...`로 시작하는 문자열)를 복사해서 잘 보관해두세요. **다시 보여주지 않으니 꼭 저장해두세요.**
4. **Billing** 메뉴에서 결제 수단을 등록하고, 소액(예: $10~20)을 충전해두세요. 이건 종량제라, 충전한 만큼만 쓰고 없어지면 다시 충전하면 됩니다.
   - 참고: 롱폼 대본 하나(2만자 분량) 생성할 때마다 대략 **200~400원 (20~35센트)** 수준으로 소진됩니다. 지사원 여러 명이 하루에 여러 번 써도 한 달에 몇만 원 수준일 거예요.

## 2단계 — Vercel 계정 만들기

1. https://vercel.com 접속 → **Sign Up** → GitHub 계정으로 가입하는 게 가장 간편합니다.

## 3단계 — 배포하기 (두 가지 방법 중 편한 것 선택)

### 방법 A. GitHub 경유 배포 (추천, 이후 수정도 편함)

1. GitHub에서 새 저장소(Repository)를 하나 만듭니다 (Private으로 만드는 걸 추천드려요).
2. 이 폴더(`insurance-script-generator` 안의 모든 파일: `api/`, `public/`, `package.json`, `vercel.json`)를 그 저장소에 업로드합니다.
   - GitHub 웹사이트에서 "Add file → Upload files"로 드래그해서 올려도 됩니다.
3. https://vercel.com/new 접속 → 방금 만든 저장소를 선택 → **Import**
4. **Deploy** 누르기 전에 **Environment Variables** 항목을 펼쳐서 아래 두 개를 등록하세요:
   - `ANTHROPIC_API_KEY` = 1단계에서 받은 API 키
   - `TEAM_ACCESS_CODE` = 지사원들에게만 알려줄 접속 코드 (예: `mywoo2026` 같은 걸 직접 정하세요)
5. **Deploy** 클릭 → 1~2분 뒤 배포 완료, `https://프로젝트이름.vercel.app` 같은 주소가 생깁니다.

### 방법 B. Vercel CLI로 바로 배포 (터미널 사용 가능하면 더 빠름)

터미널(명령 프롬프트)에서 이 폴더로 이동한 뒤:

```bash
npm install -g vercel
vercel login
vercel
```

질문에 기본값으로 답하면 배포됩니다. 그다음 환경변수를 등록하세요:

```bash
vercel env add ANTHROPIC_API_KEY
vercel env add TEAM_ACCESS_CODE
vercel --prod
```

배포가 끝나면 터미널에 최종 URL이 표시됩니다.

## 4단계 — 지사원들과 공유하기

1. 배포된 URL(`https://프로젝트이름.vercel.app`)을 지사원들에게 공유하세요.
2. 처음 접속하면 "팀 접속 코드"를 입력하는 화면이 나옵니다. 3단계에서 정한 `TEAM_ACCESS_CODE` 값을 알려주세요.
3. 이후로는 URL만 알면 누구나 접속해서 주제만 입력하고 대본을 만들 수 있습니다.

---

## 나중에 내용을 수정하고 싶다면

- 대본 스타일, 화법, 분량 규칙 등은 `public/index.html` 안의 `SYSTEM_PROMPT` 부분을 수정하시면 됩니다.
- 방법 A(GitHub)로 배포하셨다면, 저장소 파일을 수정하고 다시 업로드(커밋)하면 Vercel이 자동으로 재배포합니다.
- 방법 B(CLI)로 배포하셨다면, 파일 수정 후 다시 `vercel --prod` 실행하면 됩니다.

## 참고사항

- `TEAM_ACCESS_CODE`는 URL을 모르는 사람의 무단 사용을 막는 최소한의 장치입니다. 회사 차원의 진짜 보안이 필요하면 별도 로그인 시스템 구축을 검토하세요.
- API 사용량과 비용은 https://console.anthropic.com 의 Usage 메뉴에서 실시간으로 확인할 수 있습니다. 월 지출 한도(Spending limit)를 설정해두시면 예상치 못한 과금을 막을 수 있어요.
- 대본은 초안입니다. 실제 업로드 전 보험협회 광고 심의와 상품 정보(회사명, 보험료, 보장금액)의 사실관계는 반드시 직접 확인해야 합니다.
