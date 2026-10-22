'use strict';

const express = require('express');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { protect } = require('../middleware/authMiddleware');
const { config } = require('../config');
const asyncHandler = require('../utils/asyncHandler');
const {
  validateUsername,
  validatePassword,
  validateEmail,
} = require('../utils/validation');

const router = express.Router();

function generateToken(userId) {
  return jwt.sign({ id: userId }, config.jwtSecret, {
    expiresIn: config.jwtExpiresIn,
  });
}

function authPayload(user) {
  return {
    message: 'Authentication successful',
    token: generateToken(user._id),
    username: user.username,
    userId: user._id,
    user: user.toSafeJSON(),
  };
}

// POST /api/auth/signup
router.post(
  '/signup',
  asyncHandler(async (req, res) => {
    const username = String(req.body.username || '').trim();
    const password = String(req.body.password || '');
    const email =
      req.body.email === undefined || req.body.email === ''
        ? null
        : String(req.body.email).trim().toLowerCase();
    const displayName = String(
      req.body.displayName || req.body.name || username
    ).trim();

    const usernameError = validateUsername(username);
    if (usernameError) return res.status(400).json({ error: usernameError });
    const passwordError = validatePassword(password);
    if (passwordError) return res.status(400).json({ error: passwordError });
    const emailError = validateEmail(email);
    if (emailError) return res.status(400).json({ error: emailError });
    if (displayName.length > 60) {
      return res.status(400).json({ error: 'Display name must be at most 60 characters' });
    }

    const existing = await User.findOne({ username });
    if (existing) {
      return res.status(409).json({ error: 'Username already taken' });
    }
    if (email) {
      const emailExists = await User.findOne({ email });
      if (emailExists) {
        return res.status(409).json({ error: 'Email already registered' });
      }
    }

    const user = await User.create({
      username,
      password,
      email,
      displayName: displayName || username,
    });

    return res.status(201).json({
      ...authPayload(user),
      message: 'Signup successful',
    });
  })
);

// POST /api/auth/login
router.post(
  '/login',
  asyncHandler(async (req, res) => {
    const username = String(req.body.username || '').trim();
    const password = String(req.body.password || '');

    if (!username || !password) {
      return res.status(400).json({ error: 'Please provide username and password' });
    }

    const user = await User.findOne({ username });
    if (!user) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    const matches = await user.comparePassword(password);
    if (!matches) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    return res.json({ ...authPayload(user), message: 'Login successful' });
  })
);

// POST /api/auth/logout — JWT is stateless; the client discards the token.
router.post('/logout', protect, (req, res) => {
  res.json({ message: 'Logged out' });
});

// GET /api/auth/me
router.get('/me', protect, (req, res) => {
  res.json({ user: req.user.toSafeJSON(), id: req.user._id, username: req.user.username });
});

// PUT /api/auth/profile
router.put(
  '/profile',
  protect,
  asyncHandler(async (req, res) => {
    const user = await User.findById(req.user._id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    if (req.body.displayName !== undefined) {
      const displayName = String(req.body.displayName).trim();
      if (!displayName || displayName.length > 60) {
        return res
          .status(400)
          .json({ error: 'Display name must be between 1 and 60 characters' });
      }
      user.displayName = displayName;
    }

    if (req.body.email !== undefined) {
      const email = req.body.email ? String(req.body.email).trim().toLowerCase() : null;
      const emailError = validateEmail(email);
      if (emailError) return res.status(400).json({ error: emailError });
      if (email && email !== user.email) {
        const emailExists = await User.findOne({ email, _id: { $ne: user._id } });
        if (emailExists) {
          return res.status(409).json({ error: 'Email already registered' });
        }
      }
      user.email = email;
    }

    if (req.body.theme !== undefined) {
      if (!['light', 'dark'].includes(req.body.theme)) {
        return res.status(400).json({ error: 'Theme must be light or dark' });
      }
      user.theme = req.body.theme;
    }

    await user.save();
    return res.json({ message: 'Profile updated', user: user.toSafeJSON() });
  })
);

// PUT /api/auth/password
router.put(
  '/password',
  protect,
  asyncHandler(async (req, res) => {
    const currentPassword = String(req.body.currentPassword || '');
    const newPassword = String(req.body.newPassword || '');

    if (!currentPassword || !newPassword) {
      return res
        .status(400)
        .json({ error: 'Current password and new password are required' });
    }
    const passwordError = validatePassword(newPassword);
    if (passwordError) return res.status(400).json({ error: passwordError });
    if (currentPassword === newPassword) {
      return res
        .status(400)
        .json({ error: 'New password must be different from the current password' });
    }

    const user = await User.findById(req.user._id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    const matches = await user.comparePassword(currentPassword);
    if (!matches) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }

    user.password = newPassword;
    await user.save();

    return res.json({
      message: 'Password updated',
      token: generateToken(user._id),
    });
  })
);

module.exports = router;
