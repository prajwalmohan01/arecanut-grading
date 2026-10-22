'use strict';

const mongoose = require('mongoose');
const { config } = require('./config');

async function connectDatabase(uri = config.mongoUri) {
  if (!uri) throw new Error('MONGO_URI is not configured');
  mongoose.set('strictQuery', true);
  await mongoose.connect(uri, {
    serverSelectionTimeoutMS: 8000,
    connectTimeoutMS: 8000,
  });
  return mongoose.connection;
}

async function disconnectDatabase() {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
}

module.exports = { connectDatabase, disconnectDatabase };
