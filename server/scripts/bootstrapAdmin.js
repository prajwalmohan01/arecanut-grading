'use strict';

const mongoose = require('mongoose');
const User = require('../models/User');
const { config } = require('../config');
const { connectDatabase } = require('../database');

async function bootstrap() {
  await connectDatabase();
  const username = (process.env.ADMIN_USERNAME || 'admin').trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD;
  const email = process.env.ADMIN_EMAIL || null;
  const displayName = process.env.ADMIN_DISPLAY_NAME || 'Administrator';

  let user = await User.findOne({ username });
  if (user) {
    let changed = false;
    if (user.role !== 'admin') {
      user.role = 'admin';
      changed = true;
    }
    if (process.env.ADMIN_PASSWORD) {
      user.password = password;
      changed = true;
    }
    if (changed) {
      await user.save();
      console.log(`[admin] Updated existing user ${username} to admin`);
    } else {
      console.log(`[admin] Admin user ${username} already exists`);
    }
    await mongoose.disconnect();
    return;
  }

  if (!password || password.length < 8) {
    await mongoose.disconnect();
    throw new Error('ADMIN_PASSWORD must be set to at least 8 characters.');
  }

  user = await User.create({
    username,
    password,
    email,
    displayName,
    role: 'admin',
  });
  console.log(`[admin] Created admin user ${username}`);
  await mongoose.disconnect();
}

bootstrap().catch((err) => {
  console.error('[admin] Bootstrap failed:', err.message);
  process.exit(1);
});
