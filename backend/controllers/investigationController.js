const mongoose = require('mongoose');
const fsp = require('fs/promises');
const Item = require('../models/Item');
const User = require('../models/User');
const Investigation = require('../models/Investigation');
const CctvFootage = require('../models/CctvFootage');
const CctvAnalysis = require('../models/CctvAnalysis');
const {
  INVESTIGATION_STATUSES,
  MODULE4_SETTABLE_STATUSES,
  FUTURE_STATUSES
} = require('../models/Investigation');
const { MAX_FOOTAGE_PER_CASE } = require('../models/CctvFootage');
const { TIME_REGEX } = require('../models/Item');
const { AppError } = require('../utils/AppError');
const { securityLog } = require('../utils/securityLog');
const { inList } = require('../utils/trustedQuery');
const { isValidObjectId: isReportId } = require('../utils/reportAccess');
const {
  isValidObjectId,
  itemCommunityId,
  isEligibleForInvestigation,
  findOpenInvestigation,
  loadInvestigationOr404,
  mapInvestigation
} = require('../utils/investigationAccess');
const {
  saveCctvVideo,
  deleteCctvVideo,
  safeCctvPath,
  contentTypeForCctvKey,
  streamCctvFile
} = require('../services/uploadService');
const {
  deleteAnalysisForFootage,
  isStale: isAnalysisStale
} = require('../services/cctvAnalysisService');

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function parseOptionalTime(value, label) {
  if (value == null || value === '') {
    return null;
  }
  let time = String(value).trim();
  if (/^([01]\d|2[0-3]):[0-5]\d:[0-5]\d$/.test(time)) {
    time = time.slice(0, 5);
  }
  if (!TIME_REGEX.test(time)) {
    throw new AppError(`Please enter a valid ${label}.`, 400);
  }
  return time;
}

function parseIsoDate(value, label, { allowFuture = false } = {}) {
  const raw = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    throw new AppError(`Please enter a valid ${label}.`, 400);
  }
  const date = new Date(`${raw}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) {
    throw new AppError(`Please enter a valid ${label}.`, 400);
  }
  if (!allowFuture) {
    const today = new Date();
    const todayUtc = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
    if (date > todayUtc) {
      throw new AppError(`The ${label} cannot be in the future.`, 400);
    }
  }
  return date;
}

function parseNotes(value) {
  if (value == null) {
    return undefined;
  }
  const notes = String(value).trim();
  if (notes.length > 2000) {
    throw new AppError('Notes must be 2000 characters or fewer.', 400);
  }
  return notes;
}

async function nextCaseIdentity() {
  // Older investigation documents have no caseSeq. Sorting those first made
  // the next number NaN and the create request failed validation.
  const [row] = await Investigation.aggregate([
    { $group: { _id: null, maxSeq: { $max: '$caseSeq' } } }
  ]);
  const highest = row && Number.isFinite(row.maxSeq) ? row.maxSeq : 0;
  const caseSeq = highest + 1;
  return {
    caseSeq,
    caseId: `INV-${String(caseSeq).padStart(4, '0')}`
  };
}

async function loadFootageFor(investigationId) {
  return CctvFootage.find({ investigationId }).sort({ createdAt: 1 });
}

async function loadItemOr404(itemId) {
  if (!isValidObjectId(itemId) || !isReportId(itemId)) {
    throw new AppError('Report not found.', 404);
  }
  const item = await Item.findById(itemId).populate('communityId', 'name');
  if (!item) {
    throw new AppError('Report not found.', 404);
  }
  return item;
}

async function createInvestigation(req, res, next) {
  try {
    const itemId = String(req.body.itemId || '').trim();
    const item = await loadItemOr404(itemId);

    if (!isEligibleForInvestigation(item)) {
      throw new AppError('Only active lost or found reports can be investigated.', 400);
    }

    const existing = await findOpenInvestigation(item._id);
    if (existing) {
      const footage = await loadFootageFor(existing._id);
      const populated = await loadInvestigationOr404(existing._id);
      return res.status(409).json({
        message: 'An investigation already exists for this report.',
        investigation: mapInvestigation(populated, footage)
      });
    }

    const notes = parseNotes(req.body.notes);
    const identity = await nextCaseIdentity();
    const now = new Date();
    const communityId = itemCommunityId(item);

    let investigation;
    try {
      investigation = await Investigation.create({
        caseId: identity.caseId,
        caseSeq: identity.caseSeq,
        itemId: item._id,
        communityId,
        createdBy: req.user._id,
        status: 'CREATED',
        notes: notes || '',
        startedAt: now,
        completedAt: null
      });
    } catch (err) {
      if (err && err.code === 11000) {
        const again = await findOpenInvestigation(item._id);
        if (again) {
          const footage = await loadFootageFor(again._id);
          const populated = await loadInvestigationOr404(again._id);
          return res.status(409).json({
            message: 'An investigation already exists for this report.',
            investigation: mapInvestigation(populated, footage)
          });
        }
      }
      throw err;
    }

    securityLog('investigation_created', {
      userId: req.user._id,
      role: req.user.role,
      path: req.originalUrl,
      reason: investigation.caseId
    });

    const populated = await loadInvestigationOr404(investigation._id);
    res.status(201).json({
      message: 'Investigation created.',
      investigation: mapInvestigation(populated, [])
    });
  } catch (err) {
    next(err);
  }
}

async function listInvestigations(req, res, next) {
  try {
    const search = String(req.query.search || '').trim().slice(0, 80);
    const status = String(req.query.status || '').trim().toUpperCase();
    const communityId = String(req.query.communityId || '').trim();
    const from = String(req.query.from || '').trim();
    const to = String(req.query.to || '').trim();

    const filter = {};

    if (status && status !== 'ALL') {
      if (!INVESTIGATION_STATUSES.includes(status)) {
        throw new AppError('Please select a valid investigation status.', 400);
      }
      filter.status = status;
    }

    if (communityId) {
      if (!isValidObjectId(communityId)) {
        throw new AppError('Please select a valid community.', 400);
      }
      filter.communityId = new mongoose.Types.ObjectId(communityId);
    }

    if (from || to) {
      filter.createdAt = {};
      if (from) {
        filter.createdAt.$gte = parseIsoDate(from, 'start date', { allowFuture: true });
      }
      if (to) {
        const end = parseIsoDate(to, 'end date', { allowFuture: true });
        end.setUTCHours(23, 59, 59, 999);
        filter.createdAt.$lte = end;
      }
    }

    if (search) {
      const pattern = new RegExp(escapeRegex(search), 'i');
      const matchingItems = await Item.find({ itemName: pattern }).select('_id').limit(50);
      const matchingUsers = await User.find({ name: pattern }).select('_id').limit(50);
      const or = [{ caseId: pattern }];
      if (matchingItems.length) {
        or.push({ itemId: inList(matchingItems.map((row) => row._id)) });
      }
      if (matchingUsers.length) {
        or.push({ createdBy: inList(matchingUsers.map((row) => row._id)) });
      }
      filter.$or = or;
    }

    const rows = await Investigation.find(filter)
      .populate('itemId', 'itemName reportType status location')
      .populate('communityId', 'name')
      .populate('createdBy', 'name role')
      .sort({ createdAt: -1 })
      .limit(200);

    const ids = rows.map((row) => row._id);
    const footage = ids.length
      ? await CctvFootage.find({ investigationId: inList(ids) }).select('investigationId')
      : [];
    const counts = new Map();
    for (const clip of footage) {
      const key = clip.investigationId.toString();
      counts.set(key, (counts.get(key) || 0) + 1);
    }

    res.json({
      investigations: rows.map((row) => {
        const mapped = mapInvestigation(row, [], { includeCctv: false });
        mapped.cctvCount = counts.get(row._id.toString()) || 0;
        return mapped;
      })
    });
  } catch (err) {
    next(err);
  }
}

async function getInvestigation(req, res, next) {
  try {
    const investigation = await loadInvestigationOr404(req.params.id);
    const footage = await loadFootageFor(investigation._id);
    res.json({
      investigation: mapInvestigation(investigation, footage)
    });
  } catch (err) {
    next(err);
  }
}

function assertOpen(investigation) {
  if (investigation.status === 'CLOSED') {
    throw new AppError('This investigation is closed and cannot be changed.', 409);
  }
}

async function updateInvestigation(req, res, next) {
  try {
    const investigation = await loadInvestigationOr404(req.params.id);
    assertOpen(investigation);

    const notes = parseNotes(req.body.notes);
    if (notes !== undefined) {
      investigation.notes = notes;
    }

    if (req.body.status != null && req.body.status !== '') {
      const status = String(req.body.status).trim().toUpperCase();
      if (FUTURE_STATUSES.includes(status)) {
        throw new AppError('That status is reserved for a later module.', 400);
      }
      if (!MODULE4_SETTABLE_STATUSES.includes(status)) {
        throw new AppError('Please select a valid investigation status.', 400);
      }
      if (status === 'CLOSED') {
        investigation.status = 'CLOSED';
        investigation.completedAt = new Date();
      } else {
        const footageCount = await CctvFootage.countDocuments({ investigationId: investigation._id });
        if ((status === 'CCTV_SELECTED' || status === 'READY') && footageCount < 1) {
          throw new AppError('Add recorded CCTV footage before setting this status.', 400);
        }
        if (status === 'CREATED' && footageCount > 0) {
          throw new AppError('This case already has CCTV footage.', 400);
        }
        investigation.status = status;
      }
    }

    await investigation.save();
    const populated = await loadInvestigationOr404(investigation._id);
    const footage = await loadFootageFor(investigation._id);
    res.json({
      message: 'Investigation updated.',
      investigation: mapInvestigation(populated, footage)
    });
  } catch (err) {
    next(err);
  }
}

async function closeInvestigation(req, res, next) {
  try {
    const investigation = await loadInvestigationOr404(req.params.id);
    if (investigation.status === 'CLOSED') {
      const footage = await loadFootageFor(investigation._id);
      return res.json({
        message: 'Investigation is already closed.',
        investigation: mapInvestigation(investigation, footage)
      });
    }
    investigation.status = 'CLOSED';
    investigation.completedAt = new Date();
    await investigation.save();
    securityLog('investigation_closed', {
      userId: req.user._id,
      role: req.user.role,
      path: req.originalUrl,
      reason: investigation.caseId
    });
    const populated = await loadInvestigationOr404(investigation._id);
    const footage = await loadFootageFor(investigation._id);
    res.json({
      message: 'Investigation closed.',
      investigation: mapInvestigation(populated, footage)
    });
  } catch (err) {
    next(err);
  }
}

async function addCctvFootage(req, res, next) {
  let savedKey = null;
  try {
    const investigation = await loadInvestigationOr404(req.params.id);
    assertOpen(investigation);

    const count = await CctvFootage.countDocuments({ investigationId: investigation._id });
    if (count >= MAX_FOOTAGE_PER_CASE) {
      throw new AppError('This investigation already has the maximum number of CCTV files.', 400);
    }

    const cameraLocation = String(req.body.cameraLocation || '').trim();
    if (cameraLocation.length < 2 || cameraLocation.length > 120) {
      throw new AppError('Please enter a camera location.', 400);
    }

    const recordedDate = parseIsoDate(req.body.recordedDate, 'recorded date');
    const recordingStartTime = parseOptionalTime(req.body.recordingStartTime, 'start time');
    const recordingEndTime = parseOptionalTime(req.body.recordingEndTime, 'end time');
    if (recordingStartTime && recordingEndTime && recordingStartTime > recordingEndTime) {
      throw new AppError('The recording end time must be after the start time.', 400);
    }

    const stored = await saveCctvVideo(req.file);
    savedKey = stored.fileKey;

    const footage = await CctvFootage.create({
      investigationId: investigation._id,
      fileKey: stored.fileKey,
      displayName: stored.displayName,
      cameraLocation,
      recordedDate,
      recordingStartTime,
      recordingEndTime
    });

    if (investigation.status === 'CREATED') {
      investigation.status = 'CCTV_SELECTED';
      await investigation.save();
    }

    securityLog('cctv_added', {
      userId: req.user._id,
      role: req.user.role,
      path: req.originalUrl,
      reason: investigation.caseId
    });

    const populated = await loadInvestigationOr404(investigation._id);
    const rows = await loadFootageFor(investigation._id);
    res.status(201).json({
      message: 'CCTV footage added.',
      investigation: mapInvestigation(populated, rows),
      footage: rows.find((row) => row._id.toString() === footage._id.toString())
        ? mapInvestigation(populated, rows).cctv.find((clip) => clip.id === footage._id.toString())
        : null
    });
  } catch (err) {
    if (savedKey) {
      try {
        await deleteCctvVideo(savedKey);
      } catch (cleanupErr) {
        console.error('Unable to remove unused CCTV file.', cleanupErr && cleanupErr.name);
      }
    } else if (req.file && req.file.path) {
      try {
        await fsp.unlink(req.file.path);
      } catch (cleanupErr) {
        if (!cleanupErr || cleanupErr.code !== 'ENOENT') {
          console.error('Unable to remove unused CCTV upload.', cleanupErr && cleanupErr.name);
        }
      }
    }
    next(err);
  }
}

async function removeCctvFootage(req, res, next) {
  try {
    const investigation = await loadInvestigationOr404(req.params.id);
    assertOpen(investigation);
    if (!isValidObjectId(req.params.footageId)) {
      throw new AppError('CCTV recording not found.', 404);
    }

    const footage = await CctvFootage.findOne({
      _id: req.params.footageId,
      investigationId: investigation._id
    }).select('+fileKey');
    if (!footage) {
      throw new AppError('CCTV recording not found.', 404);
    }

    const analysis = await CctvAnalysis.findOne({ footageId: footage._id });
    if (analysis && analysis.processingStatus === 'PROCESSING' && !isAnalysisStale(analysis)) {
      throw new AppError('AI analysis is running for this recording. Please wait for it to finish.', 409);
    }

    await deleteCctvVideo(footage.fileKey);
    await CctvFootage.deleteOne({ _id: footage._id });
    await deleteAnalysisForFootage(footage._id);

    const remaining = await CctvFootage.countDocuments({ investigationId: investigation._id });
    if (remaining === 0 && investigation.status !== 'CREATED') {
      investigation.status = 'CREATED';
      await investigation.save();
    }

    const populated = await loadInvestigationOr404(investigation._id);
    const rows = await loadFootageFor(investigation._id);
    res.json({
      message: 'CCTV footage removed.',
      investigation: mapInvestigation(populated, rows)
    });
  } catch (err) {
    next(err);
  }
}

async function getCctvFile(req, res, next) {
  try {
    const investigation = await loadInvestigationOr404(req.params.id);
    if (!isValidObjectId(req.params.footageId)) {
      throw new AppError('CCTV recording not found.', 404);
    }

    const footage = await CctvFootage.findOne({
      _id: req.params.footageId,
      investigationId: investigation._id
    }).select('+fileKey');
    if (!footage) {
      throw new AppError('CCTV recording not found.', 404);
    }

    const dest = safeCctvPath(footage.fileKey);
    if (!dest) {
      throw new AppError('CCTV recording not found.', 404);
    }

    try {
      streamCctvFile(req, res, dest, contentTypeForCctvKey(footage.fileKey), footage.displayName);
    } catch (err) {
      if (err && err.code === 'ENOENT') {
        throw new AppError('CCTV recording not found.', 404);
      }
      throw err;
    }
  } catch (err) {
    next(err);
  }
}

module.exports = {
  createInvestigation,
  listInvestigations,
  getInvestigation,
  updateInvestigation,
  closeInvestigation,
  addCctvFootage,
  removeCctvFootage,
  getCctvFile
};
