const mongoose = require('mongoose');
const Item = require('../models/Item');
const User = require('../models/User');
const Community = require('../models/Community');
const {
  REPORT_TYPES,
  CATEGORIES,
  allowedStatusesForType
} = require('../models/Item');
const { AppError } = require('../utils/AppError');
const { securityLog } = require('../utils/securityLog');
const { isValidObjectId, loadReportOr404, mapReport } = require('../utils/reportAccess');
const { inList } = require('../utils/trustedQuery');
const { MAX_COMMUNITY_EMAIL_SENDS } = require('../models/Item');
const { assertNoInvestigation, findOpenInvestigation } = require('../utils/investigationAccess');
const { deleteReportImage, readReportImage } = require('../services/uploadService');
const emailService = require('../services/emailService');

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function listAdminReports(req, res, next) {
  try {
    const search = String(req.query.search || '').trim().slice(0, 80);
    const type = String(req.query.type || '').trim().toLowerCase();
    const status = String(req.query.status || '').trim().toLowerCase();
    const category = String(req.query.category || '').trim().toLowerCase();
    const communityId = String(req.query.communityId || '').trim();

    const filter = {};

    if (type && type !== 'all') {
      if (!REPORT_TYPES.includes(type)) {
        throw new AppError('Please select a valid report type.', 400);
      }
      filter.reportType = type;
    }

    if (status && status !== 'all') {
      if (!['active', 'recovered', 'claimed', 'closed', 'invalid'].includes(status)) {
        throw new AppError('Please select a valid status.', 400);
      }
      filter.status = status;
    }

    if (category && category !== 'all') {
      if (!CATEGORIES.includes(category)) {
        throw new AppError('Please select a valid category.', 400);
      }
      filter.category = category;
    }

    if (communityId) {
      if (!isValidObjectId(communityId)) {
        throw new AppError('Please select a valid community.', 400);
      }
      filter.communityId = new mongoose.Types.ObjectId(communityId);
    }

    if (search) {
      const pattern = new RegExp(escapeRegex(search), 'i');
      const matchingUsers = await User.find({
        $or: [{ name: pattern }, { email: pattern }]
      }).select('_id').limit(50);
      const or = [
        { itemName: pattern },
        { description: pattern },
        { location: pattern }
      ];
      if (matchingUsers.length) {
        or.push({ reporterId: inList(matchingUsers.map((user) => user._id)) });
      }
      filter.$or = or;
    }

    const reports = await Item.find(filter)
      .select('+imageKey')
      .populate('communityId', 'name')
      .populate('reporterId', 'name email role')
      .sort({ createdAt: -1 })
      .limit(200);

    res.json({
      reports: reports.map((item) => mapReport(item, {
        hasImage: Boolean(item.imageKey),
        includeReporterEmail: true
      }))
    });
  } catch (err) {
    next(err);
  }
}

async function getAdminReport(req, res, next) {
  try {
    const report = await loadReportOr404(req.params.id);
    const openInvestigation = await findOpenInvestigation(report._id);
    res.json({
      report: mapReport(report, {
        hasImage: Boolean(report.imageKey),
        includeReporterEmail: true,
        includeEmailStatus: true
      }),
      investigation: openInvestigation
        ? {
          id: openInvestigation._id.toString(),
          caseId: openInvestigation.caseId,
          status: openInvestigation.status
        }
        : null
    });
  } catch (err) {
    next(err);
  }
}

async function updateAdminReportStatus(req, res, next) {
  try {
    const report = await loadReportOr404(req.params.id);
    const status = String(req.body.status || '').trim().toLowerCase();
    const allowed = allowedStatusesForType(report.reportType);

    if (!allowed.includes(status)) {
      throw new AppError('That status is not allowed for this report.', 400);
    }

    report.status = status;
    await report.save();

    securityLog('report_status_admin', {
      userId: req.user._id,
      role: req.user.role,
      path: req.originalUrl,
      reason: status
    });

    const updated = await loadReportOr404(report._id);
    res.json({
      message: 'Report status updated.',
      report: mapReport(updated, {
        hasImage: Boolean(updated.imageKey),
        includeReporterEmail: true,
        includeEmailStatus: true
      })
    });
  } catch (err) {
    next(err);
  }
}

async function deleteAdminReport(req, res, next) {
  try {
    const report = await loadReportOr404(req.params.id);
    await assertNoInvestigation(report._id);
    if (report.imageKey) {
      await deleteReportImage(report.imageKey);
    }
    await Item.deleteOne({ _id: report._id });
    securityLog('report_deleted_admin', {
      userId: req.user._id,
      role: req.user.role,
      path: req.originalUrl,
      reason: 'delete'
    });
    res.json({ message: 'Report deleted.' });
  } catch (err) {
    next(err);
  }
}

async function resolveEmailCommunities(req, report) {
  const reportCommunityId = report.communityId && report.communityId._id
    ? report.communityId._id
    : report.communityId;
  const raw = req.body && req.body.communityIds;

  let requested = [];
  if (raw == null || raw === '') {
    requested = reportCommunityId ? [String(reportCommunityId)] : [];
  } else if (Array.isArray(raw)) {
    requested = raw.map((value) => String(value || '').trim()).filter(Boolean);
  } else {
    throw new AppError('Please select at least one community.', 400);
  }

  const uniqueIds = [];
  for (const id of requested) {
    if (!isValidObjectId(id)) {
      throw new AppError('Please select valid communities.', 400);
    }
    if (!uniqueIds.includes(id)) {
      uniqueIds.push(id);
    }
  }

  if (!uniqueIds.length) {
    throw new AppError('Please select at least one community.', 400);
  }
  if (uniqueIds.length > 25) {
    throw new AppError('Please select fewer communities.', 400);
  }

  const communities = await Community.find({ _id: inList(uniqueIds) }).select('name').sort({ name: 1 });
  if (communities.length !== uniqueIds.length) {
    throw new AppError('Please select valid communities.', 400);
  }
  return communities;
}

async function sendCommunityEmail(req, res, next) {
  try {
    const report = await loadReportOr404(req.params.id);
    const emailState = report.communityEmailNotification || {};
    const usedAttempts = Number(emailState.sendCount) || (emailState.sent ? 1 : 0);
    if (usedAttempts >= MAX_COMMUNITY_EMAIL_SENDS) {
      throw new AppError('This community email can only be sent twice.', 409);
    }

    const communities = await resolveEmailCommunities(req, report);
    const members = await User.find({
      communityId: inList(communities.map((item) => item._id)),
      status: 'active',
      role: inList(['student', 'employee'])
    }).select('email name');

    const uniqueMembers = [];
    const seenEmails = new Set();
    for (const member of members) {
      const email = String(member.email || '').trim().toLowerCase();
      if (!email || seenEmails.has(email)) {
        continue;
      }
      seenEmails.add(email);
      uniqueMembers.push(member);
    }

    if (!uniqueMembers.length) {
      throw new AppError('There are no eligible community members to email.', 400);
    }

    const mapped = mapReport(report, { includeEmailStatus: true });
    let imageAttachment = null;
    try {
      imageAttachment = await readReportImage(report.imageKey);
    } catch (err) {
      console.error('Unable to attach report image to community email.', err && err.name);
    }

    let sentCount = 0;
    let lastError = null;
    for (const member of uniqueMembers) {
      try {
        await emailService.sendCommunityItemAlert(member.email, mapped, imageAttachment);
        sentCount += 1;
      } catch (err) {
        lastError = err;
        console.error('Community alert email failed for a recipient.', err && err.name, err && err.message);
      }
    }

    if (sentCount === 0) {
      throw lastError || new AppError('The community email could not be sent. Please try again.', 503);
    }

    const communityNames = communities.map((item) => item.name);
    report.communityEmailNotification = {
      sent: true,
      sentAt: new Date(),
      sentBy: req.user._id,
      sentByName: req.user.name,
      recipientCount: sentCount,
      sendCount: usedAttempts + 1,
      sentCommunityNames: communityNames
    };
    report.markModified('communityEmailNotification');
    await report.save();

    securityLog('community_email_sent', {
      userId: req.user._id,
      role: req.user.role,
      path: req.originalUrl,
      reason: String(sentCount)
    });

    const updated = await loadReportOr404(report._id);
    const allDelivered = sentCount === uniqueMembers.length;
    const attempt = usedAttempts + 1;
    res.json({
      message: allDelivered
        ? (attempt >= MAX_COMMUNITY_EMAIL_SENDS
          ? 'Community email alert sent. No further sends are allowed for this report.'
          : 'Community email alert sent. You can send this alert one more time if needed.')
        : `Community email was delivered to ${sentCount} of ${uniqueMembers.length} members. Some addresses could not be delivered.`,
      report: mapReport(updated, {
        hasImage: Boolean(updated.imageKey),
        includeReporterEmail: true,
        includeEmailStatus: true
      })
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  listAdminReports,
  getAdminReport,
  updateAdminReportStatus,
  deleteAdminReport,
  sendCommunityEmail
};
