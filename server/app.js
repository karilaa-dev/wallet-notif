import express from "express";
import { byId } from "./networks.js";
import { TokenCatalog } from "./catalog.js";
import {
  randomBytes,
  randomUUID,
  timingSafeEqual,
  createHash,
} from "node:crypto";
import { fileURLToPath } from "node:url";
import { validate } from "./config.js";
import { testDestination } from "./delivery.js";

const dist = fileURLToPath(new URL("../client/dist/", import.meta.url));
const digest = (s) => createHash("sha256").update(s).digest();
export function createApp(
  store,
  password,
  { secureCookie = false, send, catalog = new TokenCatalog(store.db) } = {},
) {
  if (!password) throw Error("Set ADMIN_PASSWORD before starting.");
  const app = express(),
    sessions = new Map(),
    failures = new Map(),
    expected = digest(password);
  const ttl = 12 * 3600000;
  const cookie = {
    httpOnly: true,
    sameSite: "strict",
    secure: secureCookie,
    path: "/",
  };
  const session = (req) =>
    (req.headers.cookie ?? "").match(
      /(?:^|;\s*)wallet_session=([a-f0-9]{64})(?:;|$)/,
    )?.[1];
  app.disable("x-powered-by");
  app.use((_req, res, next) => {
    res.set({
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "X-Frame-Options": "DENY",
      "Content-Security-Policy":
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
    });
    next();
  });
  app.use(
    "/api",
    (req, res, next) => {
      res.set("Cache-Control", "no-store");
      if (!["GET", "HEAD"].includes(req.method)) {
        const origin = req.get("origin");
        if (
          req.get("sec-fetch-site") === "cross-site" ||
          (origin && !validOrigin(origin, req.get("host")))
        )
          return res
            .status(403)
            .json({ error: "Cross-origin request rejected." });
      }
      next();
    },
    express.json({ limit: "256kb" }),
  );
  app.post("/api/login", (req, res) => {
    const now = Date.now(),
      ip = req.socket.remoteAddress;
    for (const [k, v] of failures) if (v.until <= now) failures.delete(k);
    for (const [k, expires] of sessions) if (expires <= now) sessions.delete(k);
    const attempt = failures.get(ip) ?? { count: 0, until: now + 60000 };
    if (attempt.count >= 10)
      return res
        .status(429)
        .json({ error: "Too many sign-in attempts. Try again in one minute." });
    if (
      typeof req.body?.password !== "string" ||
      !timingSafeEqual(expected, digest(req.body.password))
    ) {
      failures.set(ip, { ...attempt, count: attempt.count + 1 });
      return res.status(401).json({ error: "Incorrect admin password." });
    }
    failures.delete(ip);
    const token = randomBytes(32).toString("hex");
    sessions.delete(session(req));
    sessions.set(token, now + ttl);
    res
      .cookie("wallet_session", token, { ...cookie, maxAge: ttl })
      .json({ ok: true });
  });
  app.use("/api", (req, res, next) => {
    if (!(sessions.get(session(req)) > Date.now()))
      return res.status(401).json({ error: "Sign in to continue." });
    next();
  });
  app.post("/api/logout", (req, res) => {
    sessions.delete(session(req));
    res.clearCookie("wallet_session", cookie).json({ ok: true });
  });
  app.get("/api/state", (_req, res) => res.json(store.state()));
  app.put("/api/sources/:network", (req, res) => {
    const net = byId.get(req.params.network);
    if (!net) return res.status(404).json({ error: "Unknown network." });
    try {
      store.atomic(() => store.sources.save(net, req.body));
    } catch (e) {
      return res.status(400).json({ error: e.message });
    }
    res.json({ ok: true });
  });
  app.get("/api/tokens", async (req, res) => {
    try {
      const ids = String(req.query.networks ?? "").split(",");
      res.json(await catalog.search(ids, String(req.query.q ?? "")));
    } catch (e) {
      res.status(e.status ?? 400).json({ error: e.message });
    }
  });
  app.param("id", (req, res, next, id) => {
    req.destination = store.destination(id);
    if (!req.destination)
      return res.status(404).json({ error: "Destination no longer exists." });
    next();
  });
  async function save(req, res) {
    let data;
    try {
      data = validate(req.body, req.destination);
      await catalog.resolveRules(data.rules, req.destination);
      if (req.destination) {
        const current = store.destination(req.params.id);
        if (!current)
          return res
            .status(404)
            .json({ error: "Destination no longer exists." });
        if (JSON.stringify(current) !== JSON.stringify(req.destination))
          return res
            .status(409)
            .json({
              error:
                "The destination changed while saving. Reopen it and retry.",
            });
      }
    } catch (e) {
      return res.status(e.status ?? 400).json({ error: e.message });
    }
    const id = req.destination?.id ?? randomUUID();
    store.save(id, data);
    res.status(req.destination ? 200 : 201).json({ id });
  }
  app.post("/api/destinations", save);
  app.put("/api/destinations/:id", save);
  app.delete("/api/destinations/:id", (req, res) => {
    store.remove(req.params.id);
    res.sendStatus(204);
  });
  app.post("/api/destinations/:id/test", async (req, res) => {
    try {
      await testDestination(store, req.params.id, send);
      res.json({ ok: true });
    } catch (e) {
      res.status(502).json({ error: e.message });
    }
  });
  app.use("/api", (_req, res) =>
    res.status(404).json({ error: "Unknown API route." }),
  );
  app.use(express.static(dist));
  app.use((err, _req, res, _next) =>
    res.status(err.status ?? 500).json({
      error:
        err.status === 413
          ? "Request too large."
          : err.status === 400
            ? "Invalid JSON."
            : "Server error.",
    }),
  );
  return app;
}
function validOrigin(origin, host) {
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}
