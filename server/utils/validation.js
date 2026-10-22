'use strict';

const USERNAME_RE = /^[a-zA-Z0-9_.-]{3,30}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function validateUsername(value) {
  if (typeof value !== 'string') return 'Username is required';
  const username = value.trim();
  if (!USERNAME_RE.test(username)) {
    return 'Username must be 3-30 characters and contain only letters, numbers, dots, underscores, or hyphens';
  }
  return null;
}

function validatePassword(value) {
  if (typeof value !== 'string') return 'Password is required';
  if (value.length < 8) return 'Password must be at least 8 characters';
  if (value.length > 128) return 'Password must be at most 128 characters';
  return null;
}

function validateEmail(value) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || !EMAIL_RE.test(value.trim())) {
    return 'Enter a valid email address';
  }
  return null;
}

function parseDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function parsePagination(query, defaults = {}) {
  const page = Math.max(1, Number.parseInt(query.page, 10) || defaults.page || 1);
  const limitRaw = Number.parseInt(query.limit, 10) || defaults.limit || 10;
  const limit = Math.min(Math.max(1, limitRaw), 100);
  return { page, limit, skip: (page - 1) * limit };
}

module.exports = {
  validateUsername,
  validatePassword,
  validateEmail,
  parseDate,
  parsePagination,
};
