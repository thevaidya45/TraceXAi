const mongoose = require('mongoose');
const { TIME_REGEX } = require('./Item');

const cctvFootageSchema = new mongoose.Schema(
  {
    investigationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Investigation',
      required: true
    },
    fileKey: {
      type: String,
      required: true,
      select: false
    },
    displayName: {
      type: String,
      required: true,
      trim: true,
      maxlength: 120
    },
    cameraLocation: {
      type: String,
      required: true,
      trim: true,
      minlength: 2,
      maxlength: 120
    },
    recordedDate: {
      type: Date,
      required: true
    },
    recordingStartTime: {
      type: String,
      default: null,
      validate: {
        validator(value) {
          return value == null || TIME_REGEX.test(value);
        },
        message: 'Invalid time'
      }
    },
    recordingEndTime: {
      type: String,
      default: null,
      validate: {
        validator(value) {
          return value == null || TIME_REGEX.test(value);
        },
        message: 'Invalid time'
      }
    }
  },
  {
    timestamps: true
  }
);

cctvFootageSchema.index({ investigationId: 1, createdAt: 1 });

module.exports = mongoose.model('CctvFootage', cctvFootageSchema);
module.exports.MAX_FOOTAGE_PER_CASE = 10;
