const Community = require('../models/Community');
const { AppError } = require('../utils/AppError');

function mapCommunity(community) {
  return {
    id: community._id.toString(),
    name: community.name,
    createdAt: community.createdAt || null
  };
}

async function listCommunities(req, res, next) {
  try {
    const communities = await Community.find().sort({ name: 1 });
    res.json({ communities: communities.map(mapCommunity) });
  } catch (err) {
    next(err);
  }
}

async function getCommunity(req, res, next) {
  try {
    const community = await Community.findById(req.params.id);
    if (!community) {
      throw new AppError('Community not found.', 404);
    }
    res.json({ community: mapCommunity(community) });
  } catch (err) {
    next(err);
  }
}

module.exports = { listCommunities, getCommunity };
