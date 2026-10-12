const CctvAnalysis = require('../models/CctvAnalysis');
const CctvFootage = require('../models/CctvFootage');
const EvidenceFrame = require('../models/EvidenceFrame');
const Item = require('../models/Item');
const { AppError } = require('../utils/AppError');
const { isValidObjectId, loadInvestigationOr404 } = require('../utils/investigationAccess');
const { securityLog } = require('../utils/securityLog');
const { inList } = require('../utils/trustedQuery');
const evidenceService = require('../services/evidenceFrameService');
const reviewService = require('../services/investigationReviewService');
const { safeEvidencePath } = require('../services/uploadService');

/**
 * Load the Module 4 CCTV reference for this investigation. The footage must
 * belong to the investigation in the URL; ids are never trusted on their own.
 */
async function loadFootageOr404(investigation, footageId) {
  if (!isValidObjectId(footageId)) {
    throw new AppError('CCTV recording not found.', 404);
  }
  const footage = await CctvFootage.findOne({
    _id: footageId,
    investigationId: investigation._id
  }).select('+fileKey');
  if (!footage) {
    throw new AppError('CCTV recording not found.', 404);
  }
  return footage;
}

async function loadReportedItem(investigation) {
  const itemId = investigation.itemId && investigation.itemId._id
    ? investigation.itemId._id
    : investigation.itemId;
  if (!itemId) {
    return null;
  }
  const item = await Item.findById(itemId)
    .select('itemName category description status reportType location approximateDate approximateTime +imageKey');
  if (!item) {
    return null;
  }
  const id = item._id.toString();
  return {
    id,
    itemName: item.itemName,
    category: item.category,
    description: item.description,
    reportType: item.reportType,
    status: item.status,
    location: item.location,
    approximateDate: item.approximateDate,
    approximateTime: item.approximateTime || null,
    hasImage: Boolean(item.imageKey),
    imageUrl: item.imageKey ? `/api/reports/${id}/image` : null
  };
}

/**
 * Start evidence extraction for recordings that have a completed analysis but
 * no stills yet. This is a one-time seek over timestamps Module 5 already
 * produced; detection and tracking are never re-run here.
 */
async function kickPendingExtractions({ investigation, footageRows, analysisByFootage, userId }) {
  for (const footage of footageRows) {
    const analysis = analysisByFootage.get(footage._id.toString());
    if (!analysis || analysis.processingStatus !== 'COMPLETED') {
      continue;
    }
    const pending = analysis.evidenceStatus === 'AVAILABLE'
      || (analysis.evidenceStatus === 'EXTRACTING'
        && !evidenceService.isExtracting(footage._id)
        && evidenceService.isExtractionStale(analysis));
    if (!pending) {
      continue;
    }
    const withKey = await CctvFootage.findById(footage._id).select('+fileKey');
    if (!withKey) {
      continue;
    }
    await evidenceService.ensureEvidence({
      investigation,
      footage: withKey,
      analysis,
      userId,
      explicit: false
    });
  }
}

async function getInvestigationReview(req, res, next) {
  try {
    const investigation = await loadInvestigationOr404(req.params.id);
    const item = await loadReportedItem(investigation);

    const footageRows = await CctvFootage.find({ investigationId: investigation._id }).sort({
      createdAt: 1
    });
    const analyses = await CctvAnalysis.find({ investigationId: investigation._id });
    const analysisByFootage = new Map(analyses.map((row) => [row.footageId.toString(), row]));

    await kickPendingExtractions({
      investigation,
      footageRows,
      analysisByFootage,
      userId: req.user._id
    });

    const footageIds = footageRows.map((row) => row._id);
    const frames = footageIds.length
      ? await EvidenceFrame.find({ footageId: inList(footageIds) }).sort({
        sortOrder: 1,
        timestampSeconds: 1
      })
      : [];
    const framesByFootage = new Map();
    frames.forEach((frame) => {
      const key = frame.footageId.toString();
      if (!framesByFootage.has(key)) {
        framesByFootage.set(key, []);
      }
      framesByFootage.get(key).push(frame);
    });

    const recordings = footageRows.map((footage) => {
      const key = footage._id.toString();
      return reviewService.buildRecordingReview({
        investigation,
        footage,
        analysis: analysisByFootage.get(key) || null,
        frames: framesByFootage.get(key) || []
      });
    });

    res.json({
      investigation: {
        id: investigation._id.toString(),
        caseId: investigation.caseId,
        status: investigation.status,
        notes: investigation.notes || '',
        closed: investigation.status === 'CLOSED',
        startedAt: investigation.startedAt,
        completedAt: investigation.completedAt,
        createdAt: investigation.createdAt,
        updatedAt: investigation.updatedAt,
        community: investigation.communityId && investigation.communityId.name
          ? {
            id: investigation.communityId._id.toString(),
            name: investigation.communityId.name
          }
          : null,
        createdBy: investigation.createdBy && investigation.createdBy.name
          ? { id: investigation.createdBy._id.toString(), name: investigation.createdBy.name }
          : null
      },
      item,
      summary: {
        recordingCount: recordings.length,
        analysedCount: recordings.filter((row) => row.processingStatus === 'COMPLETED').length,
        processingCount: recordings.filter((row) => row.processingStatus === 'PROCESSING').length,
        failedCount: recordings.filter((row) => row.processingStatus === 'FAILED').length,
        evidenceFrameCount: frames.length
      },
      recordings
    });
  } catch (err) {
    next(err);
  }
}

async function extractEvidenceFrames(req, res, next) {
  try {
    const investigation = await loadInvestigationOr404(req.params.id);
    const footage = await loadFootageOr404(investigation, req.params.footageId);
    const analysis = await CctvAnalysis.findOne({ footageId: footage._id });

    await evidenceService.ensureEvidence({
      investigation,
      footage,
      analysis,
      userId: req.user._id,
      explicit: true
    });

    securityLog('evidence_extraction_started', {
      userId: req.user._id,
      role: 'admin',
      reason: investigation.caseId
    });

    res.status(202).json({
      message: 'Evidence frame extraction started for this recording.',
      footageId: footage._id.toString(),
      evidenceStatus: 'EXTRACTING'
    });
  } catch (err) {
    next(err);
  }
}

async function getEvidenceImage(req, res, next) {
  try {
    const investigation = await loadInvestigationOr404(req.params.id);
    if (!isValidObjectId(req.params.frameId)) {
      throw new AppError('Evidence frame not found.', 404);
    }

    // The frame must belong to the investigation in the URL, and the stored key
    // is server-generated; no client value ever reaches the filesystem.
    const frame = await EvidenceFrame.findOne({
      _id: req.params.frameId,
      investigationId: investigation._id
    }).select('+imageKey');
    if (!frame) {
      throw new AppError('Evidence frame not found.', 404);
    }

    const filePath = safeEvidencePath(frame.imageKey);
    if (!filePath) {
      throw new AppError('Evidence frame not found.', 404);
    }

    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.sendFile(filePath, (err) => {
      if (err) {
        if (err.code === 'ENOENT') {
          next(new AppError('Evidence frame not found.', 404));
          return;
        }
        next(err);
      }
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  getInvestigationReview,
  extractEvidenceFrames,
  getEvidenceImage
};
