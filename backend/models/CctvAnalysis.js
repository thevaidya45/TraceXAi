const mongoose = require('mongoose');

const PROCESSING_STATUSES = ['AVAILABLE', 'PROCESSING', 'COMPLETED', 'FAILED'];
const DISAPPEARANCE_CERTAINTY = ['high', 'moderate'];
// Module 6 evidence-frame extraction state for this recording.
const EVIDENCE_STATUSES = ['AVAILABLE', 'EXTRACTING', 'COMPLETED', 'FAILED'];

// Anonymous tracking instance inside one recorded clip. It is not an identity.
const trackSchema = new mongoose.Schema(
  {
    trackingId: {
      type: String,
      required: true
    },
    yoloClass: {
      type: String,
      default: null
    },
    firstSeenSeconds: {
      type: Number,
      required: true,
      min: 0
    },
    lastSeenSeconds: {
      type: Number,
      required: true,
      min: 0
    },
    framesTracked: {
      type: Number,
      required: true,
      min: 0
    },
    bestConfidence: {
      type: Number,
      default: null,
      min: 0,
      max: 1
    }
  },
  { _id: false }
);

const cctvAnalysisSchema = new mongoose.Schema(
  {
    investigationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Investigation',
      required: true
    },
    footageId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'CctvFootage',
      required: true,
      unique: true
    },
    itemId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Item',
      required: true
    },
    processingStatus: {
      type: String,
      enum: PROCESSING_STATUSES,
      default: 'AVAILABLE'
    },
    processingStartedAt: {
      type: Date,
      default: null
    },
    processingCompletedAt: {
      type: Date,
      default: null
    },
    processingError: {
      type: String,
      default: null,
      maxlength: 300
    },
    attempts: {
      type: Number,
      default: 0,
      min: 0
    },
    startedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null
    },

    // Video metadata read by OpenCV. No video bytes are stored here.
    videoFps: {
      type: Number,
      default: null
    },
    frameCount: {
      type: Number,
      default: null
    },
    videoDurationSeconds: {
      type: Number,
      default: null
    },
    framesSampled: {
      type: Number,
      default: null
    },
    frameInterval: {
      type: Number,
      default: null
    },
    modelName: {
      type: String,
      default: null
    },
    confidenceThreshold: {
      type: Number,
      default: null
    },

    itemDetectionSupported: {
      type: Boolean,
      default: false
    },
    itemDetectionNote: {
      type: String,
      default: null,
      maxlength: 300
    },
    itemTargetClasses: {
      type: [String],
      default: []
    },
    itemTracking: {
      type: [trackSchema],
      default: []
    },
    itemFirstSeenSeconds: {
      type: Number,
      default: null
    },
    itemLastSeenSeconds: {
      type: Number,
      default: null
    },
    disappearanceSeconds: {
      type: Number,
      default: null
    },
    disappearanceCertainty: {
      type: String,
      enum: [...DISAPPEARANCE_CERTAINTY, null],
      default: null
    },
    observedAbsenceSeconds: {
      type: Number,
      default: null
    },
    missingDurationSeconds: {
      type: Number,
      default: null
    },

    // Module 6 pulls still frames for the events found above. Only the state is
    // kept here; each frame is its own EvidenceFrame document.
    evidenceStatus: {
      type: String,
      enum: EVIDENCE_STATUSES,
      default: 'AVAILABLE'
    },
    evidenceStartedAt: {
      type: Date,
      default: null
    },
    evidenceExtractedAt: {
      type: Date,
      default: null
    },
    evidenceError: {
      type: String,
      default: null,
      maxlength: 300
    },
    evidenceAttempts: {
      type: Number,
      default: 0,
      min: 0
    },

    // Structured hand-off for Module 6. No identities, no face data.
    anonymousPersonTracking: {
      type: [trackSchema],
      default: []
    },
    detectionStatistics: {
      framesSampled: { type: Number, default: 0 },
      personDetections: { type: Number, default: 0 },
      itemDetections: { type: Number, default: 0 },
      uniquePersonTracks: { type: Number, default: 0 },
      uniqueItemTracks: { type: Number, default: 0 }
    }
  },
  {
    timestamps: true
  }
);

cctvAnalysisSchema.index({ investigationId: 1, createdAt: 1 });

module.exports = mongoose.model('CctvAnalysis', cctvAnalysisSchema);
module.exports.PROCESSING_STATUSES = PROCESSING_STATUSES;
module.exports.EVIDENCE_STATUSES = EVIDENCE_STATUSES;
module.exports.MAX_TRACKS_STORED = 200;
