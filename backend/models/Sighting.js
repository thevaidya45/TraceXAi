const mongoose = require('mongoose');
const { TIME_REGEX } = require('./Item');

const SIGHTING_STATUSES = ['active', 'invalid'];

const sightingSchema = new mongoose.Schema(
  {
    itemId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Item',
      required: true
    },
    reporterId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    communityId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Community',
      required: true
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
    observation: {
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
    status: {
      type: String,
      enum: SIGHTING_STATUSES,
      default: 'active'
    }
  },
  {
    timestamps: true
  }
);

sightingSchema.index({ itemId: 1, createdAt: -1 });
sightingSchema.index({ reporterId: 1, createdAt: -1 });
sightingSchema.index({ communityId: 1, createdAt: -1 });

module.exports = mongoose.model('Sighting', sightingSchema);
module.exports.SIGHTING_STATUSES = SIGHTING_STATUSES;
