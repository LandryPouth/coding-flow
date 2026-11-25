#!/usr/bin/env node
// Maintainer-only seed for epic 32 ("the maintainer's bench"). Not shipped
// (evals/ is outside package.json "files"), never loaded by ai-flow.
//
// Reads, read-only, every source of run data on this machine and prints
// AGGREGATES only — numbers, agent descriptions, model ids, project aliases.
// Never message content, never absolute paths.
//
//   node evals/bench/seed-extract.js > baseline.json
//
// Sources:
//   1. Claude Code transcripts: ~/.claude/projects/<key>/*.jsonl (main
//      sessions) and <key>/<session>/subagents/*.jsonl (+ .meta.json).
//   2. OpenCode: ~/.local/share/opencode/opencode.db, table `session`
//      (token columns per session, parent_id = subagent).
//   3. Coding Flow evidence: <project>/.coding-flow/runs/*-{verify,review}.json
//      under ~/dev (depth ≤ 5, node_modules skipped), worktrees included.
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const HOME = os.homedir();
const alias = (key) =>
  key.includes("scratchpad-tmp-") ? "bench-run:" + (key.match(/tmp-([^-]+-bench-[^-]+-[^-]+)/) || [, "other"])[1]
    : key.replace(/^-home-[^-]+-[^-]+-?/, "").replace(/^dev-/, "") || "home";
const STORY = /\b(\d{2})-(\d{2})\b/;
const roleOf = (d) => /review|round \d|re-review|skeptic/i.test(d) ? "review"
  : /implement|fix|prove|close/i.test(d) ? "implement" : "other";
const kindOf = (cmd) => /\bverify\b/.test(cmd) ? "verify" : /npm test|node --test/.test(cmd) ? "test"
  : /git (diff|log|show)/.test(cmd) ? "git-read" : /\b(grep|rg|sed|cat|head|tail|find)\b/.test(cmd) ? "explore" : "other";
const add = (a, b) => { for (const k of Object.keys(b)) a[k] = (a[k] || 0) + b[k]; return a; };

function readTranscript(file) {
  const u = { input: 0, cacheRead: 0, cacheWrite: 0, output: 0, turns: 0, maxContext: 0 };
  const tools = {}, kinds = {}, models = {};
  const pending = new Map();
  let first = null, last = null, bad = 0;
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    if (!line) continue;
    let e; try { e = JSON.parse(line); } catch { bad++; continue; }
    if (e.timestamp) { first = first || e.timestamp; last = e.timestamp; }
    const msg = e.message || {};
    if (e.type === "assistant" && msg.usage) {
      const s = msg.usage;
      const ctx = (s.input_tokens || 0) + (s.cache_read_input_tokens || 0) + (s.cache_creation_input_tokens || 0);
      u.input += s.input_tokens || 0; u.cacheRead += s.cache_read_input_tokens || 0;
      u.cacheWrite += s.cache_creation_input_tokens || 0; u.output += s.output_tokens || 0;
      u.turns++; if (ctx > u.maxContext) u.maxContext = ctx;
      if (msg.model) models[msg.model] = (models[msg.model] || 0) + 1;
      for (const c of msg.content || []) if (c && c.type === "tool_use") pending.set(c.id, [c.name, (c.input && c.input.command) || ""]);
    }
    if (e.type === "user" && Array.isArray(msg.content)) {
      for (const c of msg.content) {
        if (!c || c.type !== "tool_result") continue;
        const [name, cmd] = pending.get(c.tool_use_id) || ["?", ""];
        const n = (typeof c.content === "string" ? c.content : JSON.stringify(c.content || "")).length;
        tools[name] = (tools[name] || 0) + n;
        if (name === "Bash") kinds[kindOf(cmd)] = (kinds[kindOf(cmd)] || 0) + n;
      }
    }
  }
  return { u, tools, kinds, models, first, last, bad };
}

function claudeCode() {
  const root = path.join(HOME, ".claude", "projects");
  const out = {};
  if (!fs.existsSync(root)) return out;
  for (const key of fs.readdirSync(root)) {
    const dir = path.join(root, key);
    if (!fs.statSync(dir).isDirectory()) continue;
    const p = out[alias(key)] = out[alias(key)] || { main: {}, agents: [], tools: {}, bashKinds: {}, models: {}, from: null, to: null, badLines: 0 };
    const take = (t) => {
      add(p.tools, t.tools); add(p.bashKinds, t.kinds); add(p.models, t.models); p.badLines += t.bad;
      if (t.first && (!p.from || t.first < p.from)) p.from = t.first;
      if (t.last && (!p.to || t.last > p.to)) p.to = t.last;
    };
    for (const f of fs.readdirSync(dir)) {
      const full = path.join(dir, f);
      if (f.endsWith(".jsonl")) { const t = readTranscript(full); add(p.main, t.u); take(t); continue; }
      const sub = path.join(full, "subagents");
      if (!fs.existsSync(sub)) continue;
      for (const g of fs.readdirSync(sub)) {
        if (!g.endsWith(".jsonl")) continue;
        let meta = {}; try { meta = JSON.parse(fs.readFileSync(path.join(sub, g.replace(/\.jsonl$/, ".meta.json")), "utf8")); } catch {}
        const d = meta.description || "";
        const t = readTranscript(path.join(sub, g)); take(t);
        const m = d.match(STORY);
        p.agents.push({ description: d, role: roleOf(d), story: m ? `${m[1]}-${m[2]}` : null, type: meta.agentType || null, ...t.u, from: t.first, to: t.last });
      }
    }
  }
  return out;
}

function openCode() {
  const file = path.join(HOME, ".local", "share", "opencode", "opencode.db");
  if (!fs.existsSync(file)) return null;
  let DatabaseSync; try { ({ DatabaseSync } = require("node:sqlite")); } catch { return { error: "node:sqlite unavailable" }; }
  const db = new DatabaseSync(file, { readOnly: true });
  const rows = db.prepare("select directory, parent_id, title, model, tokens_input i, tokens_output o, tokens_cache_read cr, tokens_cache_write cw, time_created t from session").all();
  const out = {};
  for (const r of rows) {
    const a = path.basename(r.directory || "unknown");
    const p = out[a] = out[a] || { sessions: 0, subagents: 0, input: 0, cacheRead: 0, cacheWrite: 0, output: 0, models: {}, from: null, to: null };
    p.sessions++; if (r.parent_id) p.subagents++;
    p.input += r.i || 0; p.cacheRead += r.cr || 0; p.cacheWrite += r.cw || 0; p.output += r.o || 0;
    let model = r.model; try { const m = JSON.parse(r.model); model = m.modelID || m.id || r.model; } catch {}
    if (model) p.models[model] = (p.models[model] || 0) + 1;
    const t = new Date(r.t).toISOString();
    if (!p.from || t < p.from) p.from = t; if (!p.to || t > p.to) p.to = t;
  }
  return out;
}

function evidence() {
  const out = {};
  const walk = (dir, depth) => {
    if (depth > 5) return;
    let ents; try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      if (!e.isDirectory() || e.name === "node_modules" || e.name === ".git") continue;
      const full = path.join(dir, e.name);
      if (e.name === ".coding-flow") { const runs = path.join(full, "runs"); if (fs.existsSync(runs)) readRuns(runs, path.basename(dir)); continue; }
      walk(full, depth + 1);
    }
  };
  const readRuns = (runs, project) => {
    const key = project.replace(/^story-.*/, "worktree");
    const p = out[project.startsWith("story-") ? "worktrees" : key] = out[project.startsWith("story-") ? "worktrees" : key] || { verify: 0, verifyOk: 0, verifySeconds: [], reused: 0, review: 0, reviewFail: 0, p1: 0, rungs: {} };
    for (const f of fs.readdirSync(runs)) {
      let e; try { e = JSON.parse(fs.readFileSync(path.join(runs, f), "utf8")); } catch { continue; }
      if (f.endsWith("-verify.json")) {
        p.verify++; if (e.ok) p.verifyOk++;
        const s = (e.results || []).reduce((n, r) => n + (r.durationMs || 0), 0) / 1000;
        if (s) p.verifySeconds.push(Math.round(s));
        if ((e.results || []).some((r) => r.cache)) p.reused++;
        const rung = e.coverage && (e.coverage.rung || e.coverage.level); if (rung) p.rungs[rung] = (p.rungs[rung] || 0) + 1;
      } else if (f.endsWith("-review.json")) {
        p.review++; if (e.verdict === "fail") p.reviewFail++;
        p.p1 += (e.findingCounts && e.findingCounts.p1) || 0;
      }
    }
  };
  walk(path.join(HOME, "dev"), 0);
  for (const p of Object.values(out)) {
    const s = p.verifySeconds.sort((a, b) => a - b);
    p.verifySecondsMedian = s.length ? s[s.length >> 1] : null; p.verifySecondsP90 = s.length ? s[Math.floor(s.length * 0.9)] : null;
    p.verifyHours = Math.round(s.reduce((a, b) => a + b, 0) / 360) / 10; delete p.verifySeconds;
  }
  return out;
}

const cc = claudeCode();
const summary = {};
for (const [a, p] of Object.entries(cc)) {
  const byRole = {}, byStory = {};
  for (const g of p.agents) {
    const tot = g.input + g.cacheRead + g.cacheWrite;
    const r = byRole[g.role] = byRole[g.role] || { agents: 0, turns: 0, inputTotal: 0, output: 0, maxContext: 0 };
    r.agents++; r.turns += g.turns; r.inputTotal += tot; r.output += g.output; r.maxContext = Math.max(r.maxContext, g.maxContext);
    if (g.story) {
      const s = byStory[g.story] = byStory[g.story] || { agents: 0, reviews: 0, implementInput: 0, inputTotal: 0 };
      s.agents++; s.inputTotal += tot; if (g.role === "review") s.reviews++; if (g.role === "implement") s.implementInput += tot;
    }
  }
  for (const r of Object.values(byRole)) r.contextPerTurn = r.turns ? Math.round(r.inputTotal / r.turns) : 0;
  const top = [...p.agents].sort((x, y) => (y.input + y.cacheRead + y.cacheWrite) - (x.input + x.cacheRead + x.cacheWrite)).slice(0, 8)
    .map((g) => ({ description: g.description, role: g.role, inputTotal: g.input + g.cacheRead + g.cacheWrite, turns: g.turns, maxContext: g.maxContext }));
  summary[a] = { from: p.from, to: p.to, main: p.main, subagentCount: p.agents.length, byRole, byStory, topAgents: top,
    toolResultChars: p.tools, bashResultChars: p.bashKinds, models: p.models, badLines: p.badLines };
}
process.stdout.write(JSON.stringify({
  generatedAt: new Date().toISOString(), node: process.version,
  note: "aggregates only; inputTotal = input + cache read + cache write tokens",
  claudeCode: summary, openCode: openCode(), evidence: evidence(),
}, null, 1) + "\n");
