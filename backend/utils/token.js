const jwt = require('jsonwebtoken');

function getJwtSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('Authentication configuration is missing.');
  }
  return secret;
}

function communityIdFromUser(user) {
  if (!user || !user.communityId) {
    return null;
  }
  if (user.communityId._id) {
    return user.communityId._id.toString();
  }
  return user.communityId.toString();
}

function signAuthToken(user) {
  return jwt.sign(
    {
      userId: user._id.toString(),
      role: user.role,
      communityId: communityIdFromUser(user)
    },
    getJwtSecret(),
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
  );
}

function verifyAuthToken(token) {
  return jwt.verify(token, getJwtSecret());
}

function cookieOptions() {
  const maxAgeMs = 7 * 24 * 60 * 60 * 1000;
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: maxAgeMs
  };
}

function setAuthCookie(res, token) {
  res.cookie('token', token, cookieOptions());
}

function clearAuthCookie(res) {
  res.clearCookie('token', { ...cookieOptions(), maxAge: 0 });
}

module.exports = {
  signAuthToken,
  verifyAuthToken,
  setAuthCookie,
  clearAuthCookie
};
