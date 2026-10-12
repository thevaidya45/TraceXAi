const mongoose = require('mongoose');
const Item = require('../models/Item');
const { MAX_COMMUNITY_EMAIL_SENDS } = require('../models/Item');
const { AppError } = require('./AppError');
const { securityLog } = require('./securityLog');

function isValidObjectId(id) {
  return mongoose.Types.ObjectId.isValid(id) && String(new mongoose.Types.ObjectId(id)) === String(id);
}

function userCommunityId(user) {
  if (!user || !user.communityId) {
    return null;
  }
  if (user.communityId._id) {
    return user.communityId._id.toString();
  }
  return user.communityId.toString();
}

async function loadReportOr404(id) {
  if (!isValidObjectId(id)) {
    throw new AppError('Report not found.', 404);
  }
  const report = await Item.findById(id)
    .select('+imageKey')
    .populate('communityId', 'name')
    .populate('reporterId', 'name email role status')
    .populate('communityEmailNotification.sentBy', 'name');
  if (!report) {
    throw new AppError('Report not found.', 404);
  }
  return report;
}

function reportCommunityId(report) {
  if (!report || !report.communityId) {
    return null;
  }
  if (report.communityId._id) {
    return report.communityId._id.toString();
  }
  return report.communityId.toString();
}

function isReportOwner(user, report) {
  if (!user || !report || !report.reporterId) {
    return false;
  }
  const reporterId = report.reporterId._id
    ? report.reporterId._id.toString()
    : report.reporterId.toString();
  return reporterId === user._id.toString();
}

function canViewReport(user, report) {
  if (!user || !report) {
    return false;
  }
  if (user.role === 'admin') {
    return true;
  }
  if (isReportOwner(user, report)) {
    return true;
  }
  const userCommunity = userCommunityId(user);
  const itemCommunity = reportCommunityId(report);
  return Boolean(userCommunity && itemCommunity && userCommunity === itemCommunity);
}

function canAccessReport(user, report) {
  return canViewReport(user, report);
}

async function requireReportAccess(req, report) {
  if (canViewReport(req.user, report)) {
    return;
  }
  securityLog('unauthorized_access', {
    userId: req.user._id,
    role: req.user.role,
    path: req.originalUrl,
    reason: 'report_idor'
  });
  throw new AppError('Report not found.', 404);
}

async function requireReportOwner(req, report) {
  await requireReportAccess(req, report);
  if (req.user.role === 'admin') {
    throw new AppError('Use the admin Lost & Found tools for this action.', 403);
  }
  if (!isReportOwner(req.user, report)) {
    securityLog('unauthorized_access', {
      userId: req.user._id,
      role: req.user.role,
      path: req.originalUrl,
      reason: 'report_owner'
    });
    throw new AppError('Report not found.', 404);
  }
}

function mapReport(report, options = {}) {
  const community = report.communityId && report.communityId.name
    ? { id: report.communityId._id.toString(), name: report.communityId.name }
    : report.communityId
      ? { id: report.communityId.toString(), name: null }
      : null;

  const reporter = report.reporterId && report.reporterId.name
    ? {
      id: report.reporterId._id.toString(),
      name: report.reporterId.name,
      email: options.includeReporterEmail ? report.reporterId.email : undefined,
      role: report.reporterId.role
    }
    : report.reporterId
      ? { id: report.reporterId.toString() }
      : null;

  if (reporter && reporter.email === undefined) {
    delete reporter.email;
  }

  const id = report._id.toString();
  const hasImage = Boolean(report.imageKey) || Boolean(options.hasImage);
  const emailMeta = report.communityEmailNotification || {};
  const sentBy = emailMeta.sentBy && emailMeta.sentBy.name
    ? emailMeta.sentBy.name
    : emailMeta.sentByName || null;

  const mapped = {
    id,
    reportType: report.reportType,
    itemName: report.itemName,
    category: report.category,
    description: report.description,
    location: report.location,
    approximateDate: report.approximateDate,
    approximateTime: report.approximateTime || null,
    status: report.status,
    community,
    reporter,
    hasImage,
    imageUrl: hasImage ? `/api/reports/${id}/image` : null,
    isOwner: options.viewerId ? isReportOwner({ _id: options.viewerId }, report) : undefined,
    createdAt: report.createdAt,
    updatedAt: report.updatedAt
  };

  if (options.includeEmailStatus) {
    const sendCount = Number(emailMeta.sendCount) || (emailMeta.sent ? 1 : 0);
    const remainingAttempts = Math.max(0, MAX_COMMUNITY_EMAIL_SENDS - sendCount);
    mapped.communityEmailNotification = {
      sent: Boolean(emailMeta.sent),
      sentAt: emailMeta.sentAt || null,
      sentBy: sentBy,
      recipientCount: Number(emailMeta.recipientCount) || 0,
      sendCount,
      remainingAttempts,
      canSend: remainingAttempts > 0,
      sentCommunityNames: Array.isArray(emailMeta.sentCommunityNames)
        ? emailMeta.sentCommunityNames.filter(Boolean)
        : []
    };
  }

  if (mapped.isOwner === undefined) {
    delete mapped.isOwner;
  }

  return mapped;
}

module.exports = {
  isValidObjectId,
  userCommunityId,
  reportCommunityId,
  loadReportOr404,
  canAccessReport,
  canViewReport,
  isReportOwner,
  requireReportAccess,
  requireReportOwner,
  mapReport
};
