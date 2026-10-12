function redact(value) {
  if (value == null) {
    return undefined;
  }
  return String(value).slice(0, 80);
}

function securityLog(event, details = {}) {
  const payload = {
    event,
    at: new Date().toISOString()
  };

  if (details.email) {
    payload.email = redact(details.email);
  }
  if (details.role) {
    payload.role = details.role;
  }
  if (details.userId) {
    payload.userId = String(details.userId);
  }
  if (details.targetUserId) {
    payload.targetUserId = String(details.targetUserId);
  }
  if (details.path) {
    payload.path = details.path;
  }
  if (details.reason) {
    payload.reason = details.reason;
  }
  if (details.ip) {
    payload.ip = details.ip;
  }

  console.info('[security]', JSON.stringify(payload));
}

module.exports = { securityLog };
