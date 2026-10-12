require('dotenv').config();

const { MongoMemoryServer } = require('mongodb-memory-server');

async function start() {
  const port = 27017;
  const mongod = await MongoMemoryServer.create({
    instance: {
      port,
      dbName: 'tracex_ai'
    }
  });

  const uri = mongod.getUri();
  if (!uri) {
    throw new Error('Unable to start local MongoDB.');
  }
  console.log('Local MongoDB is ready.');

  const stop = async () => {
    await mongod.stop();
    process.exit(0);
  };

  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

start().catch(() => {
  console.error('Unable to start local MongoDB.');
  process.exit(1);
});
