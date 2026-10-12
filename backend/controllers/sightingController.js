const Sighting = require('../models/Sighting');
const { AppError } = require('../utils/AppError');
const { saveReportImage, deleteReportImage, safeImagePath, contentTypeForKey } = require('../services/uploadService');
const { createCommunityAlerts } = require('../services/notificationService');
const {
  isValidObjectId,
  userCommunityId,
  loadReportOr404,
  requireReportAccess,
  reportCommunityId
} = require('../utils/reportAccess');
const { parseApproximateDate, parseTime } = require('./reportController');
const { securityLog } = require('../utils/securityLog');
const { regexContains } = require('../utils/trustedQuery');

function mapSighting(doc, options = {}) {
  const item = doc.itemId && doc.itemId.itemName
    ? {
      id: doc.itemId._id.toString(),
      itemName: doc.itemId.itemName,
      reportType: doc.itemId.reportType,
      status: doc.itemId.status
    }
    : doc.itemId
      ? { id: doc.itemId.toString() }
      : null;
  const reporter = doc.reporterId && doc.reporterId.name
    ? { id: doc.reporterId._id.toString(), name: doc.reporterId.name }
    : null;
  const community = doc.communityId && doc.communityId.name
    ? { id: doc.communityId._id.toString(), name: doc.communityId.name }
    : null;
  const id = doc._id.toString();
  const hasImage = Boolean(doc.imageKey) || Boolean(options.hasImage);
  return {
    id,
    item,
    reporter,
    community,
    location: doc.location,
    approximateDate: doc.approximateDate,
    approximateTime: doc.approximateTime || null,
    observation: doc.observation,
    status: doc.status,
    hasImage,
    imageUrl: hasImage ? `/api/sightings/${id}/image` : null,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt
  };
}

async function loadSightingOr404(id) {
  if (!isValidObjectId(id)) {
    throw new AppError('Sighting not found.', 404);
  }
  const sighting = await Sighting.findById(id)
    .select('+imageKey')
    .populate('itemId', 'itemName reportType status communityId')
    .populate('reporterId', 'name role')
    .populate('communityId', 'name');
  if (!sighting) {
    throw new AppError('Sighting not found.', 404);
  }
  return sighting;
}

function canViewSighting(user, sighting) {
  if (!user || !sighting) return false;
  if (user.role === 'admin') return true;
  const community = userCommunityId(user);
  const sightingCommunity = sighting.communityId && sighting.communityId._id
    ? sighting.communityId._id.toString()
    : sighting.communityId.toString();
  return community && community === sightingCommunity;
}

function isSightingOwner(user, sighting) {
  const reporterId = sighting.reporterId && sighting.reporterId._id
    ? sighting.reporterId._id.toString()
    : sighting.reporterId.toString();
  return reporterId === user._id.toString();
}

async function requireSightingView(req, sighting) {
  if (canViewSighting(req.user, sighting)) {
    if (req.user.role !== 'admin' && sighting.status === 'invalid' && !isSightingOwner(req.user, sighting)) {
      throw new AppError('Sighting not found.', 404);
    }
    return;
  }
  securityLog('unauthorized_access', {
    userId: req.user._id,
    role: req.user.role,
    path: req.originalUrl,
    reason: 'sighting_idor'
  });
  throw new AppError('Sighting not found.', 404);
}

async function createSighting(req, res, next) {
  try {
    const communityId = userCommunityId(req.user);
    if (!communityId) {
      throw new AppError('A community must be assigned before you can submit a sighting.', 400);
    }

    const itemId = String(req.body.itemId || '').trim();
    const report = await loadReportOr404(itemId);
    await requireReportAccess(req, report);
    if (reportCommunityId(report) !== communityId) {
      throw new AppError('Sighting not found.', 404);
    }

    const location = String(req.body.location || '').trim();
    if (location.length < 2 || location.length > 120) {
      throw new AppError('Please enter a location between 2 and 120 characters.', 400);
    }
    const observation = String(req.body.observation || '').trim();
    if (observation.length < 10 || observation.length > 1000) {
      throw new AppError('Please describe what you saw in 10 to 1000 characters.', 400);
    }
    const approximateDate = parseApproximateDate(req.body.approximateDate);
    if (!approximateDate) {
      throw new AppError('Please enter a valid date that is not in the future.', 400);
    }
    const approximateTime = parseTime(req.body.approximateTime);
    if (approximateTime === undefined) {
      throw new AppError('Please enter a valid time (HH:MM).', 400);
    }

    let imageKey = null;
    if (req.file) {
      imageKey = await saveReportImage(req.file);
    }

    try {
      const sighting = await Sighting.create({
        itemId: report._id,
        reporterId: req.user._id,
        communityId,
        location,
        observation,
        approximateDate,
        approximateTime,
        imageKey,
        status: 'active'
      });
      try {
        await createCommunityAlerts({
          communityId,
          itemId: report._id,
          reporterId: req.user._id,
          type: 'SIGHTING',
          itemName: report.itemName,
          location,
          sightingId: sighting._id
        });
      } catch (alertErr) {
        console.error('Unable to create sighting alerts.', alertErr && alertErr.name);
      }
      const populated = await loadSightingOr404(sighting._id);
      res.status(201).json({
        message: 'Sighting submitted.',
        sighting: mapSighting(populated, { hasImage: Boolean(imageKey) })
      });
    } catch (err) {
      if (imageKey) await deleteReportImage(imageKey);
      throw err;
    }
  } catch (err) {
    next(err);
  }
}

async function listSightings(req, res, next) {
  try {
    const mine = String(req.query.mine || '') === 'true';
    const itemId = String(req.query.itemId || '').trim();
    const filter = {};

    if (req.user.role !== 'admin') {
      const communityId = userCommunityId(req.user);
      if (!communityId) {
        throw new AppError('Community information is unavailable.', 400);
      }
      filter.communityId = communityId;
      filter.status = 'active';
    }

    if (mine) {
      filter.reporterId = req.user._id;
      delete filter.status;
    }

    if (itemId) {
      if (!isValidObjectId(itemId)) {
        throw new AppError('Report not found.', 404);
      }
      filter.itemId = itemId;
    }

    const sightings = await Sighting.find(filter)
      .select('+imageKey')
      .populate('itemId', 'itemName reportType status communityId')
      .populate('reporterId', 'name role')
      .populate('communityId', 'name')
      .sort({ createdAt: -1 })
      .limit(200);

    res.json({
      sightings: sightings.map((item) => mapSighting(item, { hasImage: Boolean(item.imageKey) }))
    });
  } catch (err) {
    next(err);
  }
}

async function getSighting(req, res, next) {
  try {
    const sighting = await loadSightingOr404(req.params.id);
    await requireSightingView(req, sighting);
    res.json({ sighting: mapSighting(sighting, { hasImage: Boolean(sighting.imageKey) }) });
  } catch (err) {
    next(err);
  }
}

async function updateSighting(req, res, next) {
  try {
    const sighting = await loadSightingOr404(req.params.id);
    await requireSightingView(req, sighting);
    if (req.user.role === 'admin') {
      throw new AppError('Admins can mark a sighting invalid from sighting management.', 403);
    }
    if (!isSightingOwner(req.user, sighting)) {
      throw new AppError('Sighting not found.', 404);
    }
    if (sighting.status !== 'active') {
      throw new AppError('This sighting can no longer be updated.', 400);
    }

    if (req.body.location !== undefined) {
      const location = String(req.body.location || '').trim();
      if (location.length < 2 || location.length > 120) {
        throw new AppError('Please enter a location between 2 and 120 characters.', 400);
      }
      sighting.location = location;
    }
    if (req.body.observation !== undefined) {
      const observation = String(req.body.observation || '').trim();
      if (observation.length < 10 || observation.length > 1000) {
        throw new AppError('Please describe what you saw in 10 to 1000 characters.', 400);
      }
      sighting.observation = observation;
    }
    if (req.body.approximateDate !== undefined) {
      const approximateDate = parseApproximateDate(req.body.approximateDate);
      if (!approximateDate) {
        throw new AppError('Please enter a valid date that is not in the future.', 400);
      }
      sighting.approximateDate = approximateDate;
    }
    if (req.body.approximateTime !== undefined) {
      const approximateTime = parseTime(req.body.approximateTime);
      if (approximateTime === undefined) {
        throw new AppError('Please enter a valid time (HH:MM).', 400);
      }
      sighting.approximateTime = approximateTime;
    }
    if (req.file) {
      const nextKey = await saveReportImage(req.file);
      const previous = sighting.imageKey;
      sighting.imageKey = nextKey;
      if (previous) await deleteReportImage(previous);
    }
    await sighting.save();
    const updated = await loadSightingOr404(sighting._id);
    res.json({
      message: 'Sighting updated.',
      sighting: mapSighting(updated, { hasImage: Boolean(updated.imageKey) })
    });
  } catch (err) {
    next(err);
  }
}

async function getSightingImage(req, res, next) {
  try {
    const sighting = await loadSightingOr404(req.params.id);
    await requireSightingView(req, sighting);
    if (!sighting.imageKey) {
      throw new AppError('No image is attached to this sighting.', 404);
    }
    const filePath = safeImagePath(sighting.imageKey);
    if (!filePath) {
      throw new AppError('No image is attached to this sighting.', 404);
    }
    res.setHeader('Content-Type', contentTypeForKey(sighting.imageKey));
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.sendFile(filePath, (err) => {
      if (err) next(err);
    });
  } catch (err) {
    next(err);
  }
}

async function listAdminSightings(req, res, next) {
  try {
    const search = String(req.query.search || '').trim().slice(0, 80);
    const status = String(req.query.status || '').trim().toLowerCase();
    const communityId = String(req.query.communityId || '').trim();
    const itemId = String(req.query.itemId || '').trim();
    const filter = {};

    if (status && status !== 'all') {
      if (!['active', 'invalid'].includes(status)) {
        throw new AppError('Please select a valid status.', 400);
      }
      filter.status = status;
    }
    if (communityId) {
      if (!isValidObjectId(communityId)) {
        throw new AppError('Please select a valid community.', 400);
      }
      filter.communityId = communityId;
    }
    if (itemId) {
      if (!isValidObjectId(itemId)) {
        throw new AppError('Report not found.', 404);
      }
      filter.itemId = itemId;
    }
    if (search) {
      const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      filter.$or = [
        { location: regexContains(escaped) },
        { observation: regexContains(escaped) }
      ];
    }

    const sightings = await Sighting.find(filter)
      .select('+imageKey')
      .populate('itemId', 'itemName reportType status communityId')
      .populate('reporterId', 'name role')
      .populate('communityId', 'name')
      .sort({ createdAt: -1 })
      .limit(200);

    res.json({
      sightings: sightings.map((item) => mapSighting(item, { hasImage: Boolean(item.imageKey) }))
    });
  } catch (err) {
    next(err);
  }
}

async function updateAdminSightingStatus(req, res, next) {
  try {
    const sighting = await loadSightingOr404(req.params.id);
    const status = String(req.body.status || '').trim().toLowerCase();
    if (!['active', 'invalid'].includes(status)) {
      throw new AppError('Please select a valid status.', 400);
    }
    sighting.status = status;
    await sighting.save();
    const updated = await loadSightingOr404(sighting._id);
    res.json({
      message: 'Sighting status updated.',
      sighting: mapSighting(updated, { hasImage: Boolean(updated.imageKey) })
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  createSighting,
  listSightings,
  getSighting,
  updateSighting,
  getSightingImage,
  listAdminSightings,
  updateAdminSightingStatus
};
