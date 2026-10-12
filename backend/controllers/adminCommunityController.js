const Community = require('../models/Community');
const User = require('../models/User');
const Item = require('../models/Item');
const Investigation = require('../models/Investigation');
const mongoose = require('mongoose');
const { AppError } = require('../utils/AppError');
const { securityLog } = require('../utils/securityLog');
const { isValidName } = require('../utils/validation');

function mapCommunity(community) {
  return {
    id: community._id.toString(),
    name: community.name,
    createdAt: community.createdAt || null
  };
}

async function listAdminCommunities(req, res, next) {
  try {
    const communities = await Community.find().sort({ name: 1 });
    res.json({ communities: communities.map(mapCommunity) });
  } catch (err) {
    next(err);
  }
}

async function createCommunity(req, res, next) {
  try {
    const name = String(req.body.name || '').trim();
    if (!isValidName(name)) {
      throw new AppError('Please enter a valid community name.', 400);
    }

    const community = await Community.create({ name });
    securityLog('community_created', { userId: req.user._id, reason: name });

    res.status(201).json({
      message: 'Community created successfully.',
      community: mapCommunity(community)
    });
  } catch (err) {
    if (err && err.code === 11000) {
      return next(new AppError('A community with this name already exists.', 409));
    }
    next(err);
  }
}

async function updateCommunity(req, res, next) {
  try {
    const community = await Community.findById(req.params.id);
    if (!community) {
      throw new AppError('Community not found.', 404);
    }

    const name = String(req.body.name || '').trim();
    if (!isValidName(name)) {
      throw new AppError('Please enter a valid community name.', 400);
    }

    community.name = name;
    await community.save();
    securityLog('community_updated', { userId: req.user._id, reason: community._id.toString() });

    res.json({
      message: 'Community updated successfully.',
      community: mapCommunity(community)
    });
  } catch (err) {
    if (err && err.code === 11000) {
      return next(new AppError('A community with this name already exists.', 409));
    }
    next(err);
  }
}

async function deleteCommunity(req, res, next) {
  try {
    const id = req.params.id;
    if (!mongoose.Types.ObjectId.isValid(id) || String(new mongoose.Types.ObjectId(id)) !== String(id)) {
      throw new AppError('Community not found.', 404);
    }

    const community = await Community.findById(id);
    if (!community) {
      throw new AppError('Community not found.', 404);
    }

    const memberCount = await User.countDocuments({ communityId: community._id });
    const reportCount = await Item.countDocuments({ communityId: community._id });
    const investigationCount = await Investigation.countDocuments({ communityId: community._id });
    if (memberCount > 0 || reportCount > 0 || investigationCount > 0) {
      throw new AppError(
        'This community cannot be deleted while it still has members, reports, or investigations.',
        409
      );
    }

    await Community.deleteOne({ _id: community._id });
    securityLog('community_deleted', {
      userId: req.user._id,
      role: req.user.role,
      path: req.originalUrl,
      reason: community._id.toString()
    });

    res.json({ message: 'Community deleted.' });
  } catch (err) {
    next(err);
  }
}

module.exports = { listAdminCommunities, createCommunity, updateCommunity, deleteCommunity };
