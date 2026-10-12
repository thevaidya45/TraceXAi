const Item = require('../models/Item');
const {
  REPORT_TYPES,
  CATEGORIES,
  TIME_REGEX
} = require('../models/Item');
const { AppError } = require('../utils/AppError');
const { saveReportImage, deleteReportImage, safeImagePath, contentTypeForKey } = require('../services/uploadService');
const {
  userCommunityId,
  loadReportOr404,
  requireReportAccess,
  requireReportOwner,
  mapReport
} = require('../utils/reportAccess');
const { isValidName } = require('../utils/validation');
const { createCommunityAlerts } = require('../services/notificationService');
const { assertNoInvestigation } = require('../utils/investigationAccess');

function parseApproximateDate(value) {
  if (!value || typeof value !== 'string') {
    return null;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null;
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  const today = new Date();
  const todayUtc = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  if (date > todayUtc) {
    return null;
  }
  return date;
}

function parseTime(value) {
  if (value == null || value === '') {
    return null;
  }
  const trimmed = String(value).trim();
  if (!TIME_REGEX.test(trimmed)) {
    return undefined;
  }
  return trimmed;
}

function parseReportFields(body, { partial }) {
  const data = {};

  if (!partial || body.itemName !== undefined) {
    const itemName = String(body.itemName || '').trim();
    if (!isValidName(itemName)) {
      throw new AppError('Please enter an item name between 2 and 80 characters.', 400);
    }
    data.itemName = itemName;
  }

  if (!partial || body.category !== undefined) {
    const category = String(body.category || '').trim().toLowerCase();
    if (!CATEGORIES.includes(category)) {
      throw new AppError('Please select a valid category.', 400);
    }
    data.category = category;
  }

  if (!partial || body.description !== undefined) {
    const description = String(body.description || '').trim();
    if (description.length < 10 || description.length > 1000) {
      throw new AppError('Please describe the item in 10 to 1000 characters.', 400);
    }
    data.description = description;
  }

  if (!partial || body.location !== undefined) {
    const location = String(body.location || '').trim();
    if (location.length < 2 || location.length > 120) {
      throw new AppError('Please enter a location between 2 and 120 characters.', 400);
    }
    data.location = location;
  }

  if (!partial || body.approximateDate !== undefined) {
    const approximateDate = parseApproximateDate(body.approximateDate);
    if (!approximateDate) {
      throw new AppError('Please enter a valid date that is not in the future.', 400);
    }
    data.approximateDate = approximateDate;
  }

  if (!partial || body.approximateTime !== undefined) {
    const approximateTime = parseTime(body.approximateTime);
    if (approximateTime === undefined) {
      throw new AppError('Please enter a valid time (HH:MM).', 400);
    }
    data.approximateTime = approximateTime;
  }

  return data;
}

async function createReport(req, res, next) {
  try {
    const reportType = String(req.body.reportType || '').trim().toLowerCase();
    if (!REPORT_TYPES.includes(reportType)) {
      throw new AppError('Please choose whether this is a lost or found report.', 400);
    }

    const communityId = userCommunityId(req.user);
    if (!communityId) {
      throw new AppError('A community must be assigned before you can submit a report.', 400);
    }

    const fields = parseReportFields(req.body, { partial: false });
    let imageKey = null;
    if (req.file) {
      imageKey = await saveReportImage(req.file);
    }

    try {
      const report = await Item.create({
        ...fields,
        reportType,
        communityId,
        reporterId: req.user._id,
        status: 'active',
        imageKey
      });
      const populated = await Item.findById(report._id)
        .populate('communityId', 'name')
        .populate('reporterId', 'name email role');
      try {
        await createCommunityAlerts({
          communityId,
          itemId: report._id,
          reporterId: req.user._id,
          type: reportType === 'found' ? 'NEW_FOUND_ITEM' : 'NEW_LOST_ITEM',
          itemName: populated.itemName,
          location: populated.location
        });
      } catch (alertErr) {
        console.error('Unable to create community alerts.', alertErr && alertErr.name, alertErr && alertErr.message);
      }
      res.status(201).json({
        message: reportType === 'lost' ? 'Lost item report submitted.' : 'Found item report submitted.',
        report: mapReport(populated, { hasImage: Boolean(imageKey), viewerId: req.user._id })
      });
    } catch (err) {
      if (imageKey) {
        await deleteReportImage(imageKey);
      }
      throw err;
    }
  } catch (err) {
    next(err);
  }
}

async function listMyReports(req, res, next) {
  try {
    const type = String(req.query.type || '').trim().toLowerCase();
    const status = String(req.query.status || '').trim().toLowerCase();
    const filter = { reporterId: req.user._id };

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

    const reports = await Item.find(filter)
      .select('+imageKey')
      .populate('communityId', 'name')
      .populate('reporterId', 'name email role')
      .sort({ createdAt: -1 })
      .limit(200);

    res.json({
      reports: reports.map((item) => mapReport(item, {
        hasImage: Boolean(item.imageKey),
        viewerId: req.user._id
      }))
    });
  } catch (err) {
    next(err);
  }
}

async function getMyReport(req, res, next) {
  try {
    const report = await loadReportOr404(req.params.id);
    await requireReportAccess(req, report);
    res.json({
      report: mapReport(report, {
        hasImage: Boolean(report.imageKey),
        viewerId: req.user._id
      })
    });
  } catch (err) {
    next(err);
  }
}

async function updateMyReport(req, res, next) {
  try {
    const report = await loadReportOr404(req.params.id);
    await requireReportOwner(req, report);

    if (report.status !== 'active') {
      throw new AppError('Only active reports can be updated.', 400);
    }

    const fields = parseReportFields(req.body, { partial: true });
    Object.assign(report, fields);

    if (req.file) {
      const nextKey = await saveReportImage(req.file);
      const previousKey = report.imageKey;
      report.imageKey = nextKey;
      if (previousKey) {
        await deleteReportImage(previousKey);
      }
    }

    await report.save();
    const updated = await loadReportOr404(report._id);
    res.json({
      message: 'Report updated.',
      report: mapReport(updated, { hasImage: Boolean(updated.imageKey) })
    });
  } catch (err) {
    next(err);
  }
}

function reporterAllowedStatuses(reportType) {
  if (reportType === 'lost') {
    return ['recovered', 'closed'];
  }
  return ['claimed', 'closed'];
}

async function updateMyReportStatus(req, res, next) {
  try {
    const report = await loadReportOr404(req.params.id);
    await requireReportOwner(req, report);

    if (report.status !== 'active') {
      throw new AppError('This report can no longer be updated.', 400);
    }

    const status = String(req.body.status || '').trim().toLowerCase();
    if (!reporterAllowedStatuses(report.reportType).includes(status)) {
      throw new AppError('That status is not allowed for this report.', 400);
    }

    report.status = status;
    await report.save();
    const updated = await loadReportOr404(report._id);
    res.json({
      message: 'Report status updated.',
      report: mapReport(updated, { hasImage: Boolean(updated.imageKey) })
    });
  } catch (err) {
    next(err);
  }
}

async function getReportImage(req, res, next) {
  try {
    const report = await loadReportOr404(req.params.id);
    await requireReportAccess(req, report);

    if (!report.imageKey) {
      throw new AppError('No image is attached to this report.', 404);
    }

    const filePath = safeImagePath(report.imageKey);
    if (!filePath) {
      throw new AppError('No image is attached to this report.', 404);
    }

    res.setHeader('Content-Type', contentTypeForKey(report.imageKey));
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.sendFile(filePath, (err) => {
      if (err) {
        next(err);
      }
    });
  } catch (err) {
    next(err);
  }
}

async function removeReportAndImage(report) {
  if (report.imageKey) {
    await deleteReportImage(report.imageKey);
  }
  await Item.deleteOne({ _id: report._id });
}

async function deleteMyReport(req, res, next) {
  try {
    const report = await loadReportOr404(req.params.id);
    await requireReportOwner(req, report);
    await assertNoInvestigation(report._id);

    await removeReportAndImage(report);
    res.json({ message: 'Report deleted.' });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  createReport,
  listMyReports,
  getMyReport,
  updateMyReport,
  updateMyReportStatus,
  getReportImage,
  deleteMyReport,
  parseReportFields,
  parseApproximateDate,
  parseTime
};
