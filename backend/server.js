require('dotenv').config();

const { connectDb } = require('./config/db');
const { createApp } = require('./app');

const app = createApp();
const port = Number(process.env.PORT) || 5000;
const isProduction = process.env.NODE_ENV === 'production';

async function start() {
  try {
    if (!process.env.JWT_SECRET || !process.env.MONGO_URI) {
      throw new Error('Missing configuration');
    }
    if (isProduction && (!process.env.CLIENT_ORIGIN || process.env.CLIENT_ORIGIN === '*')) {
      throw new Error('Missing configuration');
    }
    await connectDb();
    const server = app.listen(port, () => {
      console.log(`TraceX AI server running on port ${port}`);
    });
    server.on('error', (listenErr) => {
      if (listenErr && listenErr.code === 'EADDRINUSE') {
        console.error(`Port ${port} is already in use.`);
        process.exit(1);
      }
      throw listenErr;
    });
    const shutdown = () => {
      server.close(() => process.exit(0));
    };
    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);
  } catch (err) {
    console.error('Unable to start the server.');
    process.exit(1);
  }
}

start();
