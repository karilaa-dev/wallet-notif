import { DatabaseSync } from "node:sqlite";
import { randomUUID, createHash } from "node:crypto";
import { byId, networks } from "./networks.js";
import { feeds } from "./providers.js";
import { Sources } from "./sources.js";
import { publicDestination } from "./config.js";

import { compileCoverage, coversEvent } from "./routing.js";

function savedCoverage(destination) {
  return destination.coverage ?? compileCoverage(destination.rules, 0);
}

// Etherscan's account feed omits ERC-20 log indices and uses trace paths.
// Use the same key across indexers, including an ordinal for identical legs.
function deliveryKey(network, wallet, event, counts) {
  const base = [network, wallet, event.id].join("/");
  const family = byId.get(network)?.family;
  if (
    !["evm", "ton"].includes(family) ||
    !event.transaction ||
    !event.rawAmount
  )
    return base;
  const kind =
    family === "ton"
      ? "action"
      : event.asset !== "native"
        ? "token"
        : event.id.includes(":trace:")
          ? "trace"
          : null;
  if (!kind) return base;
  const hash = createHash("sha256")
    .update(
      JSON.stringify([
        network,
        wallet,
        kind,
        event.transaction,
        event.from,
        event.to,
        event.asset,
        event.rawAmount,
      ]),
    )
    .digest("hex");
  const ordinal = counts.get(hash) ?? 0;
  counts.set(hash, ordinal + 1);
  return family + "/" + hash + "/" + ordinal;
}

export class Store {
  constructor(path, legacyEnv = process.env) {
    this.db = new DatabaseSync(path);
    this.db.exec(`
      PRAGMA journal_mode=WAL;
      PRAGMA foreign_keys=ON;
      PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS destinations (
        id TEXT PRIMARY KEY, settings TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS watches (
        id INTEGER PRIMARY KEY AUTOINCREMENT, network TEXT, address TEXT, feed TEXT,
        started INTEGER, watermark INTEGER, updated INTEGER, due INTEGER DEFAULT 0,
        error TEXT, failures INTEGER DEFAULT 0, UNIQUE(network,address,feed)
      );
      CREATE TABLE IF NOT EXISTS deliveries (
        id TEXT PRIMARY KEY, destination TEXT REFERENCES destinations(id) ON DELETE CASCADE,
        eventKey TEXT, summary TEXT, payload TEXT, created INTEGER, status TEXT,
        attempts INTEGER DEFAULT 0, due INTEGER DEFAULT 0, error TEXT,
        UNIQUE(destination,eventKey)
      );
      CREATE INDEX IF NOT EXISTS due_deliveries ON deliveries(status,due);
      CREATE INDEX IF NOT EXISTS recent_deliveries ON deliveries(created DESC);
    `);
    this.sources = new Sources(this.db, legacyEnv);
    this.db.exec(
      "CREATE TABLE IF NOT EXISTS migrations(name TEXT PRIMARY KEY)",
    );
    this.atomic(() => {
      if (
        this.db
          .prepare("SELECT 1 FROM migrations WHERE name=?")
          .get("indexed-transfer-keys")
      )
        return;
      const countsByDestination = new Map();
      const update = this.db.prepare(
        "UPDATE deliveries SET eventKey=? WHERE id=?",
      );
      for (const row of this.db
        .prepare("SELECT id,destination,payload FROM deliveries ORDER BY rowid")
        .all()) {
        const event = JSON.parse(row.payload);
        if (
          event.type !== "transfer" ||
          !["evm", "ton"].includes(byId.get(event.network)?.family)
        )
          continue;
        const counts = countsByDestination.get(row.destination) ?? new Map();
        countsByDestination.set(row.destination, counts);
        update.run(
          deliveryKey(event.network, event.wallet, event, counts),
          row.id,
        );
      }
      this.db
        .prepare("INSERT INTO migrations VALUES(?)")
        .run("indexed-transfer-keys");
    });
  }
  atomic(fn) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = fn();
      this.db.exec("COMMIT");
      return result;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
  destinations() {
    return this.db
      .prepare("SELECT * FROM destinations ORDER BY rowid")
      .all()
      .map((r) => ({ id: r.id, ...JSON.parse(r.settings) }));
  }
  destination(id) {
    const row = this.db
      .prepare("SELECT settings FROM destinations WHERE id=?")
      .get(id);
    return row && { id, ...JSON.parse(row.settings) };
  }
  save(id, settings, now = Date.now()) {
    this.atomic(() => {
      const previous = this.destination(id);
      const coverage = compileCoverage(
        settings.rules,
        now,
        previous ? savedCoverage(previous) : {},
      );
      this.db
        .prepare(
          "INSERT INTO destinations VALUES(?,?) ON CONFLICT(id) DO UPDATE SET settings=excluded.settings",
        )
        .run(id, JSON.stringify({ ...settings, coverage }));
      this.syncWatches(now);
    });
  }
  remove(id) {
    this.atomic(() => {
      this.db.prepare("DELETE FROM destinations WHERE id=?").run(id);
      this.syncWatches(Date.now());
    });
  }
  syncWatches(now) {
    const wanted = new Set();
    const insert = this.db.prepare(
      "INSERT OR IGNORE INTO watches(network,address,feed,started,watermark) VALUES(?,?,?,?,?)",
    );
    for (const d of this.destinations())
      for (const rule of d.rules)
        for (const network of rule.networks) {
          for (const feed of feeds[byId.get(network).family]) {
            wanted.add([network, rule.address, feed].join("/"));
            insert.run(network, rule.address, feed, now, now);
          }
        }
    for (const w of this.db.prepare("SELECT * FROM watches").all()) {
      if (!wanted.has([w.network, w.address, w.feed].join("/")))
        this.db.prepare("DELETE FROM watches WHERE id=?").run(w.id);
    }
  }
  enqueue(destination, eventKey, payload, summary, now) {
    const id = randomUUID();
    this.db
      .prepare(
        `INSERT OR IGNORE INTO deliveries(id,destination,eventKey,summary,payload,created,due,status)
      VALUES(?,?,?,?,?,?,?,'queued')`,
      )
      .run(
        id,
        destination,
        eventKey,
        summary,
        JSON.stringify(payload),
        now,
        now,
      );
    return id;
  }
  commitScan(w, result, interval) {
    this.atomic(() => {
      const now = Date.now();
      const updated = this.db
        .prepare(
          "UPDATE watches SET watermark=?,updated=?,due=?,failures=0,error=NULL WHERE id=?",
        )
        .run(result.watermark, now, now + interval, w.id);
      if (!updated.changes) return;
      const destinations = this.destinations().map((d) => ({
        id: d.id,
        coverage: savedCoverage(d),
      }));
      const counts = new Map();
      for (const event of result.events) {
        const key = deliveryKey(w.network, w.address, event, counts);
        for (const d of destinations) {
          if (!coversEvent(d.coverage, event)) continue;
          const summary =
            event.direction +
            " " +
            event.amount +
            " " +
            event.symbol +
            " on " +
            byId.get(w.network).name;
          this.enqueue(d.id, key, { type: "transfer", ...event }, summary, now);
        }
      }
    });
  }
  state() {
    const ds = this.destinations(),
      names = new Map(ds.map((d) => [d.id, d.name]));
    const monitors = new Map();
    for (const w of this.db
      .prepare("SELECT * FROM watches ORDER BY network,address,feed")
      .all()) {
      const key = w.network + w.address;
      const m = monitors.get(key) ?? {
        network: w.network,
        address: w.address,
        status: "watching",
        updatedAt: null,
        error: null,
      };
      if (!w.updated && !m.error) m.status = "starting";
      if (w.updated && (!m.updatedAt || w.updated < Date.parse(m.updatedAt)))
        m.updatedAt = new Date(w.updated).toISOString();
      if (w.error) {
        m.status = "error";
        m.error = [m.error, w.feed + " — " + w.error]
          .filter(Boolean)
          .join("\n");
      }
      monitors.set(key, m);
    }
    const deliveries = this.db
      .prepare(
        "SELECT id,destination,summary,created,status,error FROM deliveries ORDER BY created DESC,rowid DESC LIMIT 100",
      )
      .all();
    return {
      networks: networks.map(
        ({ id, name, family, symbol, usdt, additionalUsdt }) => ({
          id,
          name,
          family,
          symbol,
          usdt,
          additionalUsdt,
        }),
      ),
      sources: this.sources.list(),
      destinations: ds.map(publicDestination),
      monitors: [...monitors.values()],
      deliveries: deliveries.map(({ destination, created, ...d }) => ({
        ...d,
        destinationId: destination,
        destinationName: names.get(destination),
        createdAt: new Date(created).toISOString(),
      })),
    };
  }
}
