const { EventEmitter } = require("node:events");

const STATES = ["queued", "running", "waiting", "done", "failed"];

class Runner extends EventEmitter {
  constructor(store) {
    super();
    this.store = store;
    this.queue = [];
    this.active = new Map();
  }

  enqueue(run) {
    if (!run || !run.id) {
      throw new Error("a run needs an id");
    }
    this.queue.push({ ...run, state: "queued", attempts: 0 });
    this.emit("queued", run.id);
  }

  async start(id) {
    const index = this.queue.findIndex((entry) => entry.id === id);
    if (index === -1) {
      return null;
    }
    const [run] = this.queue.splice(index, 1);
    run.state = "running";
    run.attempts += 1;
    this.active.set(id, run);
    this.emit("started", id);
    return run;
  }

  async wait(id, reason) {
    const run = this.active.get(id);
    if (!run) {
      return null;
    }
    run.state = "waiting";
    run.reason = reason || "dependency";
    this.emit("waiting", id);
    return run;
  }

  async complete(id, output) {
    const run = this.active.get(id);
    if (!run) {
      return null;
    }
    run.state = "done";
    run.output = output;
    this.active.delete(id);
    this.emit("done", id);
    await this.store.save(run);
    return run;
  }

  async fail(id, error) {
    const run = this.active.get(id);
    if (!run) {
      return null;
    }
    run.state = "failed";
    run.error = String(error);
    this.active.delete(id);
    this.emit("failed", id);
    await this.store.save(run);
    return run;
  }

  pending() {
    return this.queue.filter((run) => run.state === "queued");
  }

  running() {
    return [...this.active.values()].filter((run) => run.state === "running");
  }

  waiting() {
    return [...this.active.values()].filter((run) => run.state === "waiting");
  }

  snapshot() {
    return {
      queued: this.pending().map((run) => run.id),
      running: this.running().map((run) => run.id),
      waiting: this.waiting().map((run) => run.id),
      states: STATES.slice(),
    };
  }

  reset() {
    for (const run of this.queue) {
      run.state = "queued";
      run.attempts = 0;
    }
    this.active.clear();
    this.emit("reset");
  }

  size() {
    return this.queue.length + this.active.size;
  }

  find(id) {
    return this.queue.find((entry) => entry.id === id) || this.active.get(id) || null;
  }

  has(id) {
    return Boolean(this.find(id));
  }

  remove(id) {
    this.queue = this.queue.filter((entry) => entry.id !== id);
    this.active.delete(id);
    this.emit("removed", id);
  }
}

module.exports = { Runner, STATES };
