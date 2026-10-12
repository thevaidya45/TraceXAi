const mongoose = require('mongoose');

const REPORT_TYPES = ['lost', 'found'];
const CATEGORIES = [
  'electronics',
  'clothing',
  'documents',
  'accessories',
  'books',
  'keys',
  'bags',
  'other'
];
const STATUSES = ['active', 'recovered', 'claimed', 'closed', 'invalid'];

const TIME_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/;
const MAX_COMMUNITY_EMAIL_SENDS = 2;

const itemSchema = new mongoose.Schema(
  {
    reportType: {
      type: String,
      enum: REPORT_TYPES,
      required: true
    },
    itemName: {
      type: String,
      required: true,
      trim: true,
      minlength: 2,
      maxlength: 80
    },
    category: {
      type: String,
      enum: CATEGORIES,
      required: true
    },
    description: {
      type: String,
      required: true,
      trim: true,
      minlength: 10,
      maxlength: 1000
    },
    imageKey: {
      type: String,
      default: null,
      select: false
    },
    location: {
      type: String,
      required: true,
      trim: true,
      minlength: 2,
      maxlength: 120
    },
    approximateDate: {
      type: Date,
      required: true
    },
    approximateTime: {
      type: String,
      default: null,
      validate: {
        validator(value) {
          return value == null || TIME_REGEX.test(value);
        },
        message: 'Invalid time'
      }
    },
    communityId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Community',
      required: true
    },
    reporterId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    status: {
      type: String,
      enum: STATUSES,
      default: 'active'
    },
    communityEmailNotification: {
      sent: { type: Boolean, default: false },
      sentAt: { type: Date, default: null },
      sentBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
      sentByName: { type: String, default: null },
      recipientCount: { type: Number, default: 0 },
      sendCount: { type: Number, default: 0 },
      sentCommunityNames: { type: [String], default: [] }
    }
  },
  {
    timestamps: true
  }
);

itemSchema.index({ reporterId: 1, createdAt: -1 });
itemSchema.index({ communityId: 1, createdAt: -1 });
itemSchema.index({ status: 1, reportType: 1 });
itemSchema.index({ itemName: 1 });

function allowedStatusesForType(reportType) {
  if (reportType === 'lost') {
    return ['active', 'recovered', 'closed', 'invalid'];
  }
  return ['active', 'claimed', 'closed', 'invalid'];
}

module.exports = mongoose.model('Item', itemSchema);
module.exports.REPORT_TYPES = REPORT_TYPES;
module.exports.CATEGORIES = CATEGORIES;
module.exports.STATUSES = STATUSES;
module.exports.TIME_REGEX = TIME_REGEX;
module.exports.MAX_COMMUNITY_EMAIL_SENDS = MAX_COMMUNITY_EMAIL_SENDS;
module.exports.allowedStatusesForType = allowedStatusesForType;
