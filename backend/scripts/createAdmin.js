require('dotenv').config();

const bcrypt = require('bcrypt');
const { connectDb } = require('../config/db');
const User = require('../models/User');
const {
  isValidEmail,
  isValidPassword,
  isValidName,
  normalizeEmail
} = require('../utils/validation');

async function createAdmin() {
  const name = String(process.env.ADMIN_NAME || '').trim();
  const email = normalizeEmail(process.env.ADMIN_EMAIL);
  const password = process.env.ADMIN_PASSWORD;

  if (!isValidName(name) || !isValidEmail(email) || !isValidPassword(password)) {
    console.error(
      'Admin setup requires valid ADMIN_NAME, ADMIN_EMAIL, and ADMIN_PASSWORD environment variables.'
    );
    process.exit(1);
  }

  await connectDb();

  const existing = await User.findOne({ email });
  if (existing) {
    console.error('An account with this email already exists.');
    process.exit(1);
  }

  const hashedPassword = await bcrypt.hash(password, 10);
  await User.create({
    name,
    email,
    password: hashedPassword,
    role: 'admin',
    communityId: null,
    authProvider: 'local',
    emailVerified: true
  });

  console.log('Admin account created.');
  process.exit(0);
}

createAdmin().catch(() => {
  console.error('Unable to create the admin account.');
  process.exit(1);
});
