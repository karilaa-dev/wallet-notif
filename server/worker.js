import { byId } from "./networks.js";
import { scan, page } from "./providers.js";
import { createDispatcher } from "./delivery.js";

export function startWorkers(store, interval) {
  let stopping = false;
  const timers = new Set();
  function loop(task, ms) {
    async function tick() {
      if (stopping) return;
      try {
        await task();
      } catch (e) {
        console.error("Background task failed:", e.name);
      }
      if (!stopping) {
        const timer = setTimeout(() => {
          timers.delete(timer);
          void tick();
        }, ms);
        timers.add(timer);
      }
    }
    void tick();
  }
  loop(async () => {
    const watches = store.db
      .prepare("SELECT * FROM watches WHERE due<=? ORDER BY due,id LIMIT 12")
      .all(Date.now());
    // Limit pressure on shared public APIs and isolate a failed feed from other chains.
    for (let i = 0; i < watches.length && !stopping; i += 2) {
      await Promise.all(
        watches.slice(i, i + 2).map(async (w) => {
          const source = store.sources.get(w.network);
          try {
            const result = await scan(w, byId.get(w.network), (...args) =>
              page(...args, undefined, source),
            );
            if (store.sources.get(w.network).revision === source.revision)
              store.commitScan(w, result, interval);
          } catch (e) {
            if (store.sources.get(w.network).revision !== source.revision)
              return;
            const delay = Math.min(
              900000,
              interval * 2 ** Math.min(w.failures, 8),
            );
            const error =
              e instanceof SyntaxError
                ? "Provider returned an invalid response."
                : e.message;
            store.db
              .prepare(
                "UPDATE watches SET due=?,updated=?,failures=failures+1,error=? WHERE id=?",
              )
              .run(Date.now() + delay, Date.now(), error.slice(0, 240), w.id);
          }
        }),
      );
    }
  }, 1000);
  loop(createDispatcher(store), 500);
  return () => {
    stopping = true;
    for (const timer of timers) clearTimeout(timer);
  };
}
