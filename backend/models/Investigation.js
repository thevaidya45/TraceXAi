const mongoose = require('mongoose');

const INVESTIGATION_STATUSES = [
  'CREATED',
  'CCTV_SELECTED',
  'READY',
  'PROCESSING',
  'COMPLETED',
  'CLOSED'
];

const OPEN_STATUSES = ['CREATED', 'CCTV_SELECTED', 'READY', 'PROCESSING', 'COMPLETED'];
const MODULE4_SETTABLE_STATUSES = ['CREATED', 'CCTV_SELECTED', 'READY', 'CLOSED'];
const FUTURE_STATUSES = ['PROCESSING', 'COMPLETED'];

const investigationSchema = new mongoose.Schema(
  {
    caseId: {
      type: String,
      required: true,
      unique: true,
      trim: true
    },
    caseSeq: {
      type: Number,
      required: true,
      unique: true,
      min: 1
    },
    itemId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Item',
      required: true
    },
    communityId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Community',
      required: true
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    status: {
      type: String,
      enum: INVESTIGATION_STATUSES,
      default: 'CREATED'
    },
    notes: {
      type: String,
      default: '',
      trim: true,
      maxlength: 2000
    },
    startedAt: {
      type: Date,
      required: true
    },
    completedAt: {
      type: Date,
      default: null
    }
  },
  {
    timestamps: true
  }
);

investigationSchema.index({ itemId: 1, status: 1 });
investigationSchema.index({ communityId: 1, createdAt: -1 });
investigationSchema.index({ status: 1, updatedAt: -1 });

module.exports = mongoose.model('Investigation', investigationSchema);
module.exports.INVESTIGATION_STATUSES = INVESTIGATION_STATUSES;
module.exports.OPEN_STATUSES = OPEN_STATUSES;
module.exports.MODULE4_SETTABLE_STATUSES = MODULE4_SETTABLE_STATUSES;
module.exports.FUTURE_STATUSES = FUTURE_STATUSES;
