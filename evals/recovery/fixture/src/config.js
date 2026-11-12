const DEV_SECRET = process.env.NODE_ENV === "production" ? null : "dev-secret";

function authSecret() {
  return process.env.AUTH_SECRET || DEV_SECRET;
}

module.exports = { authSecret };
