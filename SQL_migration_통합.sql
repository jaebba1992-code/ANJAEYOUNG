-- ============================================================
-- 보험 콘텐츠 제작실 — 통합 SQL 마이그레이션
-- 이미 실행한 것도 있어도 안전해요 (IF NOT EXISTS 라서 중복 실행 오류 안 남)
-- Supabase → SQL Editor에서 전체 복사해서 한 번에 실행하세요
-- ============================================================

-- 1. 회원가입/로그인/승인 시스템
CREATE TABLE IF NOT EXISTS app_users (
  id BIGSERIAL PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  name TEXT NOT NULL,
  phone TEXT,
  role TEXT DEFAULT 'member',
  status TEXT DEFAULT 'pending',
  session_token TEXT,
  last_seen_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  approved_at TIMESTAMPTZ
);

-- 2. 관리자가 수정 가능한 설정값 저장소 (보험 Chat 안내 문구 등)
CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

-- 3. 공지사항 (첫 접속 팝업, 관리자가 관리 탭에서 편집)
CREATE TABLE IF NOT EXISTS announcements (
  id BIGINT PRIMARY KEY,
  content TEXT,
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 4. N대수술비 (약관+수술분류표 짝 매칭 자료)
CREATE TABLE IF NOT EXISTS surgery_packages (
  id BIGSERIAL PRIMARY KEY,
  file_key TEXT,
  insurer TEXT,
  package_name TEXT,
  terms_text TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS surgery_package_items (
  id BIGSERIAL PRIMARY KEY,
  package_id BIGINT REFERENCES surgery_packages(id) ON DELETE CASCADE,
  surgery_name TEXT NOT NULL,
  diagnosis_code TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 5. 종수술 분류(1~8종) — 이전 세션에서 이미 만들었을 수 있음
CREATE TABLE IF NOT EXISTS surgery_classifications (
  id BIGSERIAL PRIMARY KEY,
  surgery_name TEXT NOT NULL,
  system TEXT,
  class_no TEXT NOT NULL,
  category TEXT,
  source TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 6. 출처자료 라이브러리 (황팀장 블로그 등 대량 임포트한 자료) — 이전 세션에서 이미 만들었을 수 있음
CREATE TABLE IF NOT EXISTS source_library (
  id BIGINT PRIMARY KEY,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 7. 추천상품 (소식지에서 뽑은 것) — 이전 세션에서 이미 만들었을 수 있음
CREATE TABLE IF NOT EXISTS recommended_products (
  id BIGINT PRIMARY KEY,
  insurer TEXT,
  product_name TEXT,
  category TEXT,
  reason TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 8. 방문 기록에 기기 ID 컬럼 (이름 도용 방지, 이전 세션) — 이미 있으면 무시됨
ALTER TABLE IF EXISTS page_visits ADD COLUMN IF NOT EXISTS device_id TEXT;
ALTER TABLE IF EXISTS blocked_visitors ADD COLUMN IF NOT EXISTS device_id TEXT;

-- ============================================================
-- 여기까지 실행 후, 첫 관리자 계정을 아래 순서로 만들어야 해요:
-- 1) 앱에서 이메일/비밀번호로 회원가입 신청 (1명, 본인)
-- 2) Supabase → Table Editor → app_users 테이블에서 본인 이메일 행 찾기
-- 3) status를 'approved' 로, role을 'admin' 으로 직접 수정
-- 4) 앱에서 다시 로그인 → 이제 관리 탭 접근 가능, 이후 가입자는 화면에서 승인 가능
-- ============================================================

-- 9. 로그인 세션을 계정당 1개가 아니라 여러 개 저장한다 (기기/팀원별로 동시 로그인 가능하게).
--    기존엔 app_users.session_token 하나만 썼는데, 그러면 다른 기기/팀원이 같은 계정으로
--    로그인하는 순간 이전 세션이 덮어써져서 "세션 만료됨"으로 튕겨나가는 문제가 있었음.
CREATE TABLE IF NOT EXISTS app_user_sessions (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT REFERENCES app_users(id) ON DELETE CASCADE,
  session_token TEXT UNIQUE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  last_seen_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_app_user_sessions_token ON app_user_sessions(session_token);
CREATE INDEX IF NOT EXISTS idx_app_user_sessions_user ON app_user_sessions(user_id);

-- 10. API 사용량/비용 로그 — AI 호출 한 번마다 누가(visitor_name), 어떤 모델을, 토큰 몇 개
--     썼는지 기록해서, 사람별로 실제 달러(API 비용)를 합산해 볼 수 있게 한다.
CREATE TABLE IF NOT EXISTS api_usage_log (
  id BIGSERIAL PRIMARY KEY,
  visitor_name TEXT,
  model TEXT,
  input_tokens INTEGER,
  output_tokens INTEGER,
  cost_usd NUMERIC(12,6),
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_api_usage_log_visitor ON api_usage_log(visitor_name);
CREATE INDEX IF NOT EXISTS idx_api_usage_log_created ON api_usage_log(created_at);
