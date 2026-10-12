const mongoose = require('mongoose');
const { AppError } = require('../utils/AppError');

function authorizeCommunity(req, res, next) {
  if (!req.user) {
    return next(new AppError('Please sign in to continue.', 401));
  }

  if (req.user.role === 'admin') {
    return next();
  }

  const requestedId = req.params.id || req.params.communityId;
  if (!requestedId || !mongoose.Types.ObjectId.isValid(requestedId)) {
    return next(new AppError('Community not found.', 404));
  }

  const userCommunityId = req.user.communityId && req.user.communityId._id
    ? req.user.communityId._id.toString()
    : req.user.communityId
      ? req.user.communityId.toString()
      : null;

  if (!userCommunityId || userCommunityId !== String(requestedId)) {
    return next(new AppError('You do not have access to this community.', 403));
  }

  next();
}

module.exports = { authorizeCommunity };
