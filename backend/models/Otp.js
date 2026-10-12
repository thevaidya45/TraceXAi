const mongoose = require('mongoose');

const PURPOSES = ['login', 'reset', 'verify'];

const otpSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      required: true,
      lowercase: true,
      trim: true
    },
    purpose: {
      type: String,
      enum: PURPOSES,
      default: 'login',
      required: true
    },
    otpHash: {
      type: String,
      required: true
    },
    expiresAt: {
      type: Date,
      required: true
    },
    attempts: {
      type: Number,
      default: 0
    },
    lastSentAt: {
      type: Date,
      required: true
    },
    sendCount: {
      type: Number,
      default: 1
    },
    hourlyWindowStart: {
      type: Date
    }
  },
  {
    timestamps: { createdAt: true, updatedAt: false }
  }
);

otpSchema.index({ email: 1, purpose: 1 }, { unique: true });
otpSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('Otp', otpSchema);
module.exports.PURPOSES = PURPOSES;
