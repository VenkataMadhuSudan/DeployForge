import { DeploymentWorkerService } from './orchestrator/deployment-worker';
import { AppLogger } from '@deployforge/logging';

const logger = new AppLogger('WorkerMain');

async function main() {
  logger.info('Starting DeployForge Background Worker process...');
  const workerService = new DeploymentWorkerService();

  await workerService.start();

  const shutdown = async (signal: string) => {
    logger.info(`Received ${signal}. Gracefully stopping deployment worker...`);
    await workerService.stop();
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
  logger.error(`Fatal worker process error: ${err.message}`);
  process.exit(1);
});
