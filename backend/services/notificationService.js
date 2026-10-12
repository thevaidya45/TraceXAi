const User = require('../models/User');
const Notification = require('../models/Notification');
const { inList, notEqual } = require('../utils/trustedQuery');

function alertCopy(type, itemName, location) {
  if (type === 'NEW_FOUND_ITEM') {
    return {
      title: 'New found item',
      message: `${itemName} found near ${location}`
    };
  }
  if (type === 'SIGHTING') {
    return {
      title: 'New sighting',
      message: `A sighting was reported for ${itemName} near ${location}`
    };
  }
  return {
    title: 'New lost item',
    message: `${itemName} reported near ${location}`
  };
}

async function createCommunityAlerts({
  communityId,
  itemId,
  reporterId,
  type,
  itemName,
  location,
  sightingId
}) {
  const members = await User.find({
    communityId,
    status: 'active',
    role: inList(['student', 'employee']),
    _id: notEqual(reporterId)
  }).select('_id');

  if (!members.length) {
    return 0;
  }

  const copy = alertCopy(type, itemName, location);
  const docs = members.map((member) => ({
    recipientId: member._id,
    communityId,
    itemId,
    sightingId: sightingId || null,
    type,
    title: copy.title,
    message: copy.message,
    read: false
  }));

  await Notification.insertMany(docs);
  return docs.length;
}

module.exports = { createCommunityAlerts };
