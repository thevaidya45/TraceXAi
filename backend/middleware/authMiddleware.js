const { verifyAuthToken } = require('../utils/token');
const { AppError } = require('../utils/AppError');
const User = require('../models/User');

async function authenticate(req, res, next) {
  try {
    const token = req.cookies && req.cookies.token;
    if (!token) {
      throw new AppError('Please sign in to continue.', 401);
    }

    let payload;
    try {
      payload = verifyAuthToken(token);
    } catch (err) {
      throw new AppError('Your session has expired. Please sign in again.', 401);
    }

    const user = await User.findById(payload.userId).populate('communityId', 'name');
    if (!user) {
      throw new AppError('Please sign in to continue.', 401);
    }

    if (user.status === 'inactive') {
      throw new AppError('Your account is currently inactive. Please contact the administrator.', 403);
    }

    req.user = user;
    req.auth = {
      userId: user._id.toString(),
      role: user.role,
      communityId: user.communityId ? user.communityId._id.toString() : null
    };
    next();
  } catch (err) {
    next(err);
  }
}

function optionalAuthenticate(req, res, next) {
  const token = req.cookies && req.cookies.token;
  if (!token) {
    return next();
  }
  return authenticate(req, res, next);
}

module.exports = { authenticate, optionalAuthenticate };
