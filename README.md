# 보험 대본 생성기 - 배포 가이드

## 1단계. Anthropic API 키 발급
1. https://console.anthropic.com 접속 후 회원가입/로그인
2. 좌측 메뉴 "API Keys" 클릭
3. "Create Key" 버튼으로 키 생성 (예: sk-ant-api03-... 형태)
4. 이 키를 잠깐 메모장에 복사해두세요 (다시 볼 수 없으니 주의)
5. "Billing" 메뉴에서 결제 수단을 등록하고, 소액(예: $5)만 충전해도 충분해요. 선결제 필수 금액은 없고 쓴 만큼만 차감됩니다.

## 2단계. GitHub에 코드 올리기
1. https://github.com 회원가입/로그인
2. 우측 상단 "+" → "New repository" 클릭
3. 이름은 아무거나 (예: insurance-script-generator), Public/Private 아무거나 선택 후 "Create repository"
4. 만들어진 repository 화면에서 "uploading an existing file" 링크 클릭
5. 이 폴더 안의 모든 파일(api 폴더, public 폴더, package.json 전부)을 드래그해서 업로드
   - 폴더째로 드래그하면 구조가 그대로 유지됩니다
6. "Commit changes" 클릭

## 3단계. Vercel 배포
1. https://vercel.com 접속, "Continue with GitHub"로 로그인
2. "Add New..." → "Project" 클릭
3. 방금 만든 GitHub repository를 선택하고 "Import"
4. "Environment Variables" 섹션에서:
   - Name: ANTHROPIC_API_KEY
   - Value: 1단계에서 복사한 API 키
   - "Add" 클릭
5. "Deploy" 클릭, 1~2분 기다리기
6. 완료되면 https://프로젝트이름.vercel.app 형태의 주소가 생깁니다

## 4단계. 정상 작동 확인
1. 배포된 주소 뒤에 /api/health 를 붙여서 접속 (예: https://프로젝트이름.vercel.app/api/health)
2. "정상"이라고 뜨면 성공
3. "없음"이라고 뜨면 → 3단계 4번의 환경변수 등록을 다시 확인
4. "오류"라고 뜨면 → API 키가 올바른지, 결제 정보가 등록됐는지 console.anthropic.com에서 확인

## 5단계. 실제 사용
1. 배포된 주소(https://프로젝트이름.vercel.app)로 접속
2. 주제 입력하고 "대본 생성하기" 클릭
3. 롱폼 상세를 선택하면 출처자료 붙여넣는 칸이 나옵니다

## 문제가 생기면
- /api/health 화면을 캡처해서 Claude에게 보여주면 원인을 바로 확인할 수 있어요
- 이 방식은 API 키가 서버(Vercel)에만 저장되고 브라우저에는 노출되지 않아서 안전합니다
