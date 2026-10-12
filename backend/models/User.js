const mongoose = require('mongoose');

const ROLES = ['student', 'employee', 'admin'];
const AUTH_PROVIDERS = ['local', 'otp'];

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      minlength: 2,
      maxlength: 80
    },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true
    },
    password: {
      type: String,
      default: null,
      select: false
    },
    role: {
      type: String,
      enum: ROLES,
      required: true
    },
    communityId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Community',
      required: function requiredCommunity() {
        return this.role !== 'admin';
      },
      default: null
    },
    authProvider: {
      type: String,
      enum: AUTH_PROVIDERS,
      default: 'local'
    },
    status: {
      type: String,
      enum: ['active', 'inactive'],
      default: 'active'
    },
    emailVerified: {
      type: Boolean,
      default: true
    }
  },
  {
    timestamps: { createdAt: true, updatedAt: false }
  }
);

userSchema.index({ role: 1 });
userSchema.index({ status: 1 });
userSchema.index({ name: 1 });

module.exports = mongoose.model('User', userSchema);
module.exports.ROLES = ROLES;
module.exports.AUTH_PROVIDERS = AUTH_PROVIDERS;
