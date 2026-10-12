require('dotenv').config();

const { connectDb } = require('../config/db');
const Community = require('../models/Community');

const DEFAULT_COMMUNITIES = ['MCA', 'BCA', 'BBA', 'Faculty', 'Administration'];

async function seed() {
  await connectDb();

  for (const name of DEFAULT_COMMUNITIES) {
    await Community.updateOne({ name }, { $setOnInsert: { name } }, { upsert: true });
  }

  console.log('Community seed complete.');
  process.exit(0);
}

seed().catch(() => {
  console.error('Seed failed.');
  process.exit(1);
});
