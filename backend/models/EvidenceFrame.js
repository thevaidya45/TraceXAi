const mongoose = require('mongoose');

// Evidence frames are single still images taken from the CCTV file Module 4
// already stored on disk. The image itself is never kept in MongoDB, only the
// server-generated storage key and the metadata describing the event.
const EVIDENCE_TYPES = [
  'LAST_SEEN',
  'DISAPPEARANCE',
  'POST_DISAPPEARANCE',
  'PERSON_FIRST_APPEARANCE'
];

// How the timestamp for this frame was chosen. Recorded so the interface can
// describe the frame honestly instead of implying a detection or a
// disappearance that the analysis never established.
const EVIDENCE_BASIS = [
  'ITEM_DETECTION',
  'DISAPPEARANCE_ESTIMATE',
  'PERSON_DETECTION',
  'AFTER_DISAPPEARANCE_OFFSET',
  'AFTER_LAST_SEEN_OFFSET'
];

const evidenceFrameSchema = new mongoose.Schema(
  {
    investigationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Investigation',
      required: true
    },
    footageId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'CctvFootage',
      required: true
    },
    itemId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Item',
      required: true
    },
    evidenceType: {
      type: String,
      enum: EVIDENCE_TYPES,
      required: true
    },
    basis: {
      type: String,
      enum: EVIDENCE_BASIS,
      required: true
    },
    // Anonymous Module 5 tracking label (for example P-001). Never an identity.
    trackingId: {
      type: String,
      default: null
    },
    timestampSeconds: {
      type: Number,
      required: true,
      min: 0
    },
    frameNumber: {
      type: Number,
      default: null,
      min: 0
    },
    imageKey: {
      type: String,
      required: true,
      select: false
    },
    width: {
      type: Number,
      default: null
    },
    height: {
      type: Number,
      default: null
    },
    sortOrder: {
      type: Number,
      default: 0
    },
    extractedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null
    }
  },
  {
    timestamps: true
  }
);

evidenceFrameSchema.index({ footageId: 1, sortOrder: 1 });
evidenceFrameSchema.index({ investigationId: 1, createdAt: 1 });

module.exports = mongoose.model('EvidenceFrame', evidenceFrameSchema);
module.exports.EVIDENCE_TYPES = EVIDENCE_TYPES;
module.exports.EVIDENCE_BASIS = EVIDENCE_BASIS;
