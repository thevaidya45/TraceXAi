const mongoose = require('mongoose');
const Investigation = require('../models/Investigation');
const { OPEN_STATUSES } = require('../models/Investigation');
const { AppError } = require('./AppError');
const { inList } = require('./trustedQuery');

function isValidObjectId(id) {
  return mongoose.Types.ObjectId.isValid(id) && String(new mongoose.Types.ObjectId(id)) === String(id);
}

function itemCommunityId(item) {
  if (!item || !item.communityId) {
    return null;
  }
  if (item.communityId._id) {
    return item.communityId._id;
  }
  return item.communityId;
}

function isEligibleForInvestigation(item) {
  return Boolean(item && item.status === 'active' && (item.reportType === 'lost' || item.reportType === 'found'));
}

async function findOpenInvestigation(itemId) {
  return Investigation.findOne({
    itemId,
    status: inList(OPEN_STATUSES)
  });
}

async function loadInvestigationOr404(id) {
  if (!isValidObjectId(id)) {
    throw new AppError('Investigation not found.', 404);
  }
  const investigation = await Investigation.findById(id)
    .populate('itemId', 'itemName reportType status location communityId')
    .populate('communityId', 'name')
    .populate('createdBy', 'name role');
  if (!investigation) {
    throw new AppError('Investigation not found.', 404);
  }
  return investigation;
}

function mapFootage(footage, investigationId) {
  return {
    id: footage._id.toString(),
    cameraLocation: footage.cameraLocation,
    recordedDate: footage.recordedDate,
    recordingStartTime: footage.recordingStartTime || null,
    recordingEndTime: footage.recordingEndTime || null,
    filename: footage.displayName,
    createdAt: footage.createdAt,
    previewUrl: `/api/admin/investigations/${investigationId}/cctv/${footage._id}/file`
  };
}

function mapInvestigation(investigation, footageRows = [], options = {}) {
  const includeCctv = options.includeCctv !== false;
  const item = investigation.itemId && investigation.itemId._id
    ? {
      id: investigation.itemId._id.toString(),
      itemName: investigation.itemId.itemName,
      reportType: investigation.itemId.reportType,
      status: investigation.itemId.status,
      location: investigation.itemId.location
    }
    : investigation.itemId
      ? { id: investigation.itemId.toString() }
      : null;

  const community = investigation.communityId && investigation.communityId._id
    ? {
      id: investigation.communityId._id.toString(),
      name: investigation.communityId.name
    }
    : investigation.communityId
      ? { id: investigation.communityId.toString() }
      : null;

  const createdBy = investigation.createdBy && investigation.createdBy._id
    ? {
      id: investigation.createdBy._id.toString(),
      name: investigation.createdBy.name
    }
    : null;

  const investigationId = investigation._id.toString();
  const mapped = {
    id: investigationId,
    caseId: investigation.caseId,
    item,
    community,
    createdBy,
    status: investigation.status,
    notes: investigation.notes || '',
    cctvCount: footageRows.length,
    startedAt: investigation.startedAt,
    completedAt: investigation.completedAt,
    createdAt: investigation.createdAt,
    updatedAt: investigation.updatedAt
  };
  if (includeCctv) {
    mapped.cctv = footageRows.map((row) => mapFootage(row, investigationId));
  }
  return mapped;
}

async function assertNoInvestigation(itemId) {
  const count = await Investigation.countDocuments({ itemId });
  if (count > 0) {
    throw new AppError('This report cannot be deleted while an investigation exists.', 409);
  }
}

module.exports = {
  isValidObjectId,
  itemCommunityId,
  isEligibleForInvestigation,
  findOpenInvestigation,
  loadInvestigationOr404,
  mapFootage,
  mapInvestigation,
  assertNoInvestigation
};
