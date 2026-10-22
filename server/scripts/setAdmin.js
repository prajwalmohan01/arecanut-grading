'use strict';

const mongoose = require('mongoose');
const User = require('../models/User');
const { config } = require('../config');
const { connectDatabase } = require('../database');

async function run() {
  await connectDatabase();
  const username = (process.env.ADMIN_USERNAME || 'admin').trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD;
  if (!password || password.length < 8) {
    throw new Error('ADMIN_PASSWORD must be set to at least 8 characters.');
  }
  let user = await User.findOne({ username });
  if (!user) {
    user = new User({ username, password, role: 'admin', displayName: 'Administrator' });
    await user.save();
  } else {
    user.role = 'admin';
    user.set('password', password);
    await user.save();
  }
  console.log(`Admin ready: ${username}`);
  await mongoose.disconnect();
}

run().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
