"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createMonitoringControl } = require("../src/monitoring-control");

function createHarness(initialState, command = async () => ({})) {
  const state = { monitoring: false, pendingAction: null, ...initialState };
  const commands = [];
  const control = createMonitoringControl({
    getState: () => state,
    command: async name => {
      commands.push(name);
      return command(name);
    },
    publishState: patch => Object.assign(state, patch),
  });
  return { commands, control, state };
}

test("pause and resume reject lifecycle states that do not allow the action", async () => {
  const cases = [
    { phase: "idle", action: "resume" },
    { phase: "running", action: "resume", monitoring: true },
    { phase: "paused", action: "pause" },
  ];

  for (const item of cases) {
    const { commands, control, state } = createHarness({
      phase: item.phase,
      monitoring: item.monitoring ?? false,
      runtimeMode: "game",
    });

    const result = await control[item.action]();

    assert.deepEqual(commands, []);
    assert.deepEqual(result, state);
    assert.equal(state.phase, item.phase);
    assert.equal(state.runtimeMode, "game");
  }
});

test("a pending pause or resume sends only one downstream command", async () => {
  for (const item of [
    {
      phase: "running",
      monitoring: true,
      action: "pause",
      duplicate: "resume",
      command: "pause_monitoring",
      finalPhase: "paused",
    },
    {
      phase: "paused",
      monitoring: false,
      action: "resume",
      duplicate: "pause",
      command: "resume_monitoring",
      finalPhase: "running",
    },
  ]) {
    let release;
    const blocked = new Promise(resolve => { release = resolve; });
    const { commands, control, state } = createHarness(
      { phase: item.phase, monitoring: item.monitoring, runtimeMode: "game" },
      () => blocked,
    );

    const pending = control[item.action]();
    assert.equal(state.phase, item.phase);
    assert.equal(state.pendingAction, item.action);
    assert.deepEqual(commands, [item.command]);

    await control[item.action]();
    await control[item.duplicate]();
    assert.deepEqual(commands, [item.command]);
    assert.equal(state.phase, item.phase);

    release({});
    await pending;
    assert.equal(state.phase, item.finalPhase);
    assert.equal(state.pendingAction, null);
    assert.equal(state.runtimeMode, "game");
  }
});

test("a failed pause or resume clears pending state without changing phase or runtime mode", async () => {
  for (const item of [
    { phase: "running", monitoring: true, action: "pause", command: "pause_monitoring" },
    { phase: "paused", monitoring: false, action: "resume", command: "resume_monitoring" },
  ]) {
    const { commands, control, state } = createHarness(
      { phase: item.phase, monitoring: item.monitoring, runtimeMode: "game" },
      async () => { throw new Error("command failed"); },
    );

    await assert.rejects(control[item.action](), /command failed/);
    await assert.rejects(control[item.action](), /command failed/);

    assert.deepEqual(commands, [item.command, item.command]);
    assert.equal(state.pendingAction, null);
    assert.equal(state.phase, item.phase);
    assert.equal(state.monitoring, item.monitoring);
    assert.equal(state.runtimeMode, "game");
  }
});
