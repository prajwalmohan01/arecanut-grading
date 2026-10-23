'use strict';

const User = require('../models/User');

const PLACEHOLDER_PASSWORD =
  /replace_with|change[_-]?me|example|your_password|choose_a_strong_password/i;

/**
 * Ensure the admin account configured in .env exists.
 *
 * Behaviour:
 * - Creates the account when it does not exist yet.
 * - Promotes an existing account with the same username to the admin role.
 * - Never overwrites an existing password, so a password changed from the UI
 *   survives restarts.
 * - Skips silently when ADMIN_USERNAME/ADMIN_PASSWORD are not configured, and
 *   refuses obvious placeholder passwords from .env.example.
 */
async function ensureAdminFromEnv() {
  const username = String(process.env.ADMIN_USERNAME || '')
    .trim()
    .toLowerCase();
  const password = String(process.env.ADMIN_PASSWORD || '');

  if (!username || !password) {
    return { skipped: true, reason: 'ADMIN_USERNAME/ADMIN_PASSWORD not set' };
  }
  if (password.length < 8) {
    return { skipped: true, reason: 'ADMIN_PASSWORD must be at least 8 characters' };
  }
  if (PLACEHOLDER_PASSWORD.test(password)) {
    return { skipped: true, reason: 'ADMIN_PASSWORD is still a placeholder' };
  }

  const existing = await User.findOne({ username });
  if (existing) {
    if (existing.role !== 'admin') {
      existing.role = 'admin';
      await existing.save();
      return { username, created: false, promoted: true };
    }
    return { username, created: false, promoted: false };
  }

  await User.create({
    username,
    password,
    email: process.env.ADMIN_EMAIL || null,
    displayName: process.env.ADMIN_DISPLAY_NAME || 'Administrator',
    role: 'admin',
  });
  return { username, created: true, promoted: false };
}

module.exports = { ensureAdminFromEnv };
