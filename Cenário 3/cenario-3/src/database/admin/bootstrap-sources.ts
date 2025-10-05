import 'dotenv/config';
import mongoose from 'mongoose';
import { runSeed } from '../seed/seed';

const run = async () => {
  try {
    await runSeed({ dryRun: true, bootstrapSources: true });
    console.log('Bootstrap of sources completed.');
  } catch (error) {
    console.error('Bootstrap failed', error);
    process.exitCode = 1;
  } finally {
    try {
      if (
        mongoose.connection.readyState !==
        mongoose.ConnectionStates.disconnected
      ) {
        await mongoose.disconnect();
      }
    } catch (disconnectError) {
      console.warn('mongoose disconnect error:', disconnectError);
    }
  }
};

void run();
