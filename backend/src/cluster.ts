import cluster from 'node:cluster';
import os from 'node:os';

/**
 * Cluster mode entry point.
 *
 * Forks N worker processes (default: CPU count) so the app uses all cores.
 * Each worker runs the full Express server + BullMQ worker.
 *
 * Safety:
 *   - Exponential backoff on rapid restarts (prevents fork bombs)
 *   - Max 5 consecutive rapid restarts before giving up on a worker slot
 *   - Graceful SIGTERM forwarding to workers
 *   - Primary exits after all workers shut down
 */

const WORKER_COUNT = parseInt(process.env.CLUSTER_WORKERS || '0', 10) || os.cpus().length;
const RAPID_RESTART_WINDOW_MS = 5_000; // If worker dies within 5s of starting, it's a rapid restart
const MAX_RAPID_RESTARTS = 5;          // Give up after 5 rapid restarts in a row

interface WorkerTracker {
  lastStartTime: number;
  rapidRestarts: number;
}

if (cluster.isPrimary) {
  console.log(`[cluster] Primary ${process.pid} starting ${WORKER_COUNT} workers...`);

  const workerTrackers = new Map<number, WorkerTracker>();
  let shuttingDown = false;

  for (let i = 0; i < WORKER_COUNT; i++) {
    forkWorker(i);
  }

  function forkWorker(slot: number): void {
    const tracker = workerTrackers.get(slot) || { lastStartTime: 0, rapidRestarts: 0 };

    if (tracker.rapidRestarts >= MAX_RAPID_RESTARTS) {
      console.error(`[cluster] Worker slot ${slot}: ${MAX_RAPID_RESTARTS} rapid restarts — giving up. Manual intervention required.`);
      return;
    }

    const worker = cluster.fork({ WORKER_SLOT: String(slot) });
    tracker.lastStartTime = Date.now();
    workerTrackers.set(slot, tracker);

    // Store the slot on the worker for lookup in exit handler
    (worker as any).__slot = slot;
  }

  cluster.on('online', (worker) => {
    console.log(`[cluster] Worker ${worker.process.pid} is online`);
  });

  cluster.on('exit', (worker, code, signal) => {
    if (shuttingDown) return; // Don't restart during shutdown

    const slot = (worker as any).__slot as number;
    const tracker = workerTrackers.get(slot);

    if (tracker) {
      const uptime = Date.now() - tracker.lastStartTime;
      if (uptime < RAPID_RESTART_WINDOW_MS) {
        tracker.rapidRestarts++;
        const backoffMs = Math.min(tracker.rapidRestarts * 1_000, 10_000);
        console.error(`[cluster] Worker slot ${slot} (pid ${worker.process.pid}) died after ${uptime}ms (code=${code}, signal=${signal}). Rapid restart #${tracker.rapidRestarts}. Backing off ${backoffMs}ms...`);
        setTimeout(() => forkWorker(slot), backoffMs);
      } else {
        // Not a rapid restart — reset counter and restart immediately
        tracker.rapidRestarts = 0;
        console.error(`[cluster] Worker slot ${slot} (pid ${worker.process.pid}) died (code=${code}, signal=${signal}). Restarting...`);
        forkWorker(slot);
      }
    }
  });

  // Forward SIGTERM/SIGINT to all workers, then exit after they all close
  const shutdownPrimary = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[cluster] Primary received ${signal}, forwarding to workers...`);

    for (const id in cluster.workers) {
      cluster.workers[id]?.process.kill('SIGTERM');
    }

    // Wait for all workers to exit, then exit primary
    const checkInterval = setInterval(() => {
      const workers = Object.values(cluster.workers || {}).filter(Boolean);
      if (workers.length === 0) {
        clearInterval(checkInterval);
        console.log('[cluster] All workers exited. Primary shutting down.');
        process.exit(0);
      }
    }, 500);

    // Hard exit after 45s (workers have 30s for graceful shutdown)
    setTimeout(() => {
      console.error('[cluster] Shutdown timeout, forcing primary exit');
      process.exit(1);
    }, 45_000);
  };

  process.on('SIGTERM', () => shutdownPrimary('SIGTERM'));
  process.on('SIGINT', () => shutdownPrimary('SIGINT'));
} else {
  // Worker process — start the server
  require('./infrastructure/http/server');
}
