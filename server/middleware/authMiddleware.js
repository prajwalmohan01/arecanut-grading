'use strict';

const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { config } = require('../config');

async function protect(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const [scheme, token] = header.split(' ');

    if (!token || !/^Bearer$/i.test(scheme)) {
      return res.status(401).json({ error: 'Not authorized. No token provided.' });
    }

    const decoded = jwt.verify(token, config.jwtSecret);
    const user = await User.findById(decoded.id).select('-password');
    if (!user) {
      return res.status(401).json({ error: 'User no longer exists.' });
    }

    req.user = user;
    return next();
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Session expired. Please sign in again.' });
    }
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({ error: 'Token is invalid.' });
    }
    return next(error);
  }
}

function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Administrator access required.' });
  }
  return next();
}

module.exports = { protect, requireAdmin };
