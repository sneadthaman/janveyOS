type Level = "info" | "warn" | "error";

function write(level: Level, message: string, meta?: unknown) {
  const prefix = `[${new Date().toISOString()}] [${level.toUpperCase()}]`;
  if (meta === undefined) {
    console.log(`${prefix} ${message}`);
    return;
  }
  console.log(`${prefix} ${message}`, meta);
}

export const logger = {
  info: (message: string, meta?: unknown) => write("info", message, meta),
  warn: (message: string, meta?: unknown) => write("warn", message, meta),
  error: (message: string, meta?: unknown) => write("error", message, meta)
};
