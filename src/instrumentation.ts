export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  if (process.env.WORKER_ENABLED === "false") return;
  const { startWorker } = await import("./lib/worker");
  startWorker(); // not awaited: register() must finish before the server accepts requests
}
