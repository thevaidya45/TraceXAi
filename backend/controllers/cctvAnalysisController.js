const Item = require('../models/Item');
const CctvFootage = require('../models/CctvFootage');
const CctvAnalysis = require('../models/CctvAnalysis');
const { AppError } = require('../utils/AppError');
const { isValidObjectId, loadInvestigationOr404 } = require('../utils/investigationAccess');
const analysisService = require('../services/cctvAnalysisService');

function assertOpen(investigation) {
  if (investigation.status === 'CLOSED') {
    throw new AppError('This investigation is closed and cannot be changed.', 409);
  }
}

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

async function loadItemOr404(investigation) {
  const itemId = investigation.itemId && investigation.itemId._id
    ? investigation.itemId._id
    : investigation.itemId;
  const item = await Item.findById(itemId).select('itemName category description');
  if (!item) {
    throw new AppError('The reported item for this investigation is unavailable.', 404);
  }
  return item;
}

async function beginAnalysis(req, res, allowRetry) {
  const investigation = await loadInvestigationOr404(req.params.id);
  assertOpen(investigation);
  const footage = await loadFootageOr404(investigation, req.params.footageId);
  const item = await loadItemOr404(investigation);

  const analysis = await analysisService.startAnalysis({
    investigation,
    footage,
    item,
    userId: req.user._id,
    allowRetry
  });

  res.status(202).json({
    message: allowRetry
      ? 'AI analysis restarted for this recording.'
      : 'AI analysis started for this recording.',
    analysis: analysisService.mapAnalysis(analysis, footage)
  });
}

async function startCctvAnalysis(req, res, next) {
  try {
    await beginAnalysis(req, res, false);
  } catch (err) {
    next(err);
  }
}

async function retryCctvAnalysis(req, res, next) {
  try {
    await beginAnalysis(req, res, true);
  } catch (err) {
    next(err);
  }
}

async function getCctvAnalysis(req, res, next) {
  try {
    const investigation = await loadInvestigationOr404(req.params.id);
    const footage = await loadFootageOr404(investigation, req.params.footageId);
    const analysis = await CctvAnalysis.findOne({ footageId: footage._id });
    res.json({
      investigationStatus: investigation.status,
      analysis: analysisService.mapAnalysis(analysis, footage)
    });
  } catch (err) {
    next(err);
  }
}

async function listCctvAnalyses(req, res, next) {
  try {
    const investigation = await loadInvestigationOr404(req.params.id);
    const footageRows = await CctvFootage.find({ investigationId: investigation._id }).sort({
      createdAt: 1
    });
    const analyses = await CctvAnalysis.find({ investigationId: investigation._id });
    const byFootage = new Map(analyses.map((row) => [row.footageId.toString(), row]));

    res.json({
      investigationStatus: investigation.status,
      analyses: footageRows.map((footage) =>
        analysisService.mapAnalysis(byFootage.get(footage._id.toString()) || null, footage)
      )
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  startCctvAnalysis,
  retryCctvAnalysis,
  getCctvAnalysis,
  listCctvAnalyses
};
