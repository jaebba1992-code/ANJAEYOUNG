function checkAppPassword(req) {
  const expected = process.env.APP_PASSWORD;
  if (!expected) return true; // if not configured, don't lock anyone out accidentally
  const provided = req.headers['x-app-password'];
  return provided === expected;
}

// 강퇴/차단처럼 악용될 수 있는 기능은, 앱 비밀번호를 아는 사람 누구나가 아니라
// 별도의 관리자 비밀번호를 아는 사람만 쓸 수 있게 한다.
function checkAdminPassword(req) {
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected) return false; // 관리자 비밀번호가 설정 안 돼있으면, 안전하게 '항상 거부'로 막는다
  const provided = req.headers['x-admin-password'];
  return provided === expected;
}

module.exports = { checkAppPassword, checkAdminPassword };
