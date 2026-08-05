function checkAppPassword(req) {
  const expected = process.env.APP_PASSWORD;
  if (!expected) return true; // if not configured, don't lock anyone out accidentally
  const provided = req.headers['x-app-password'];
  return provided === expected;
}

module.exports = { checkAppPassword };
