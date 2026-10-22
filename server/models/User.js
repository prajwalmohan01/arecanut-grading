'use strict';

const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const { config } = require('../config');

const userSchema = new mongoose.Schema(
  {
    username: {
      type: String,
      required: [true, 'Username is required'],
      unique: true,
      trim: true,
      minlength: [3, 'Username must be at least 3 characters'],
      maxlength: [30, 'Username must be at most 30 characters'],
      match: [
        /^[a-zA-Z0-9_.-]+$/,
        'Username may contain letters, numbers, dots, underscores, and hyphens only',
      ],
    },
    password: {
      type: String,
      required: [true, 'Password is required'],
      minlength: [8, 'Password must be at least 8 characters'],
    },
    email: {
      type: String,
      trim: true,
      lowercase: true,
      default: null,
    },
    displayName: {
      type: String,
      trim: true,
      maxlength: [60, 'Display name must be at most 60 characters'],
      default: '',
    },
    role: {
      type: String,
      enum: ['user', 'admin'],
      default: 'user',
    },
    theme: {
      type: String,
      enum: ['light', 'dark'],
      default: 'light',
    },
  },
  { timestamps: true }
);

// Sparse unique index allows existing users without an email.
userSchema.index(
  { email: 1 },
  { unique: true, sparse: true, partialFilterExpression: { email: { $type: 'string' } } }
);

userSchema.pre('save', async function hashPassword(next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, config.bcryptRounds);
  next();
});

userSchema.methods.comparePassword = function comparePassword(enteredPassword) {
  return bcrypt.compare(enteredPassword, this.password);
};

userSchema.methods.toSafeJSON = function toSafeJSON() {
  return {
    id: this._id,
    username: this.username,
    email: this.email || null,
    displayName: this.displayName || '',
    role: this.role || 'user',
    theme: this.theme || 'light',
    createdAt: this.createdAt,
    updatedAt: this.updatedAt,
  };
};

userSchema.set('toJSON', {
  transform(_doc, ret) {
    delete ret.password;
    delete ret.__v;
    return ret;
  },
});

module.exports = mongoose.model('User', userSchema);
