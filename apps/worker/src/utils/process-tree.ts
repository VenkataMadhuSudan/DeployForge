import { spawn } from 'node:child_process';

/**
 * Cross-platform process tree killer.
 * On Windows, spawns `taskkill /pid <pid> /T /F` to reliably terminate all descendant
 * child processes (e.g., cmd.exe -> node.exe -> esbuild).
 * On Unix, attempts process group termination (-pid), then falls back to direct kill.
 */
export function killProcessTree(pid: number, signal: NodeJS.Signals | 'SIGKILL' = 'SIGKILL'): Promise<void> {
  return new Promise<void>((resolve) => {
    if (!pid || pid <= 0) {
      resolve();
      return;
    }

    if (process.platform === 'win32') {
      try {
        const killer = spawn('taskkill', ['/pid', String(pid), '/T', '/F'], {
          windowsHide: true,
          stdio: 'ignore',
        });
        killer.on('close', () => resolve());
        killer.on('error', () => resolve());
        setTimeout(resolve, 3000);
      } catch {
        resolve();
      }
    } else {
      try {
        process.kill(-pid, signal);
      } catch {
        try {
          process.kill(pid, signal);
        } catch {
          // Process may have already exited
        }
      }
      resolve();
    }
  });
}
