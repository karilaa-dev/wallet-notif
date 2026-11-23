import { mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { Store } from "./store.js";
import { createApp } from "./app.js";
import { startWorkers } from "./worker.js";

process.umask(0o077);
const {
  ADMIN_PASSWORD,
  DB_PATH = "data/wallet.sqlite",
  HOST = "127.0.0.1",
  PORT = "3000",
  POLL_SECONDS = "60",
} = process.env;
if (!ADMIN_PASSWORD)
  throw Error("Set ADMIN_PASSWORD in the environment or .env.");
const interval = Number(POLL_SECONDS) * 1000;
if (!Number.isSafeInteger(interval) || interval < 1000)
  throw Error("POLL_SECONDS must be at least 1.");
mkdirSync(dirname(resolve(DB_PATH)), { recursive: true });
const store = new Store(DB_PATH);
const app = createApp(store, ADMIN_PASSWORD, {
  secureCookie: process.env.COOKIE_SECURE === "true",
});
const server = app.listen(Number(PORT), HOST, () => {
  console.log(
    "Wallet monitor listening on http://" + HOST + ":" + server.address().port,
  );
  const stop = startWorkers(store, interval);
  for (const signal of ["SIGTERM", "SIGINT"])
    process.once(signal, () => {
      stop();
      server.close(() => process.exit(0));
    });
});
