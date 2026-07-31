"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createMonitoringControl } = require("../src/monitoring-control");

function createHarness(initialState, command = async () => ({}), stop = async () => {}) {
  const state = { monitoring: false, pendingAction: null, ...initialState };
  const commands = [];
  const stops = [];
  const control = createMonitoringControl({
    getState: () => state,
    command: async name => {
      commands.push(name);
      return command(name);
    },
    stop: async () => {
      stops.push("stop");
      return stop();
    },
    publishState: patch => Object.assign(state, patch),
  });
  return { commands, control, state, stops };
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

test("running and paused stop immediately and become idle after the backend stops", async () => {
  for (const item of [
    { phase: "running", monitoring: true },
    { phase: "paused", monitoring: false },
  ]) {
    let release;
    const blocked = new Promise(resolve => { release = resolve; });
    const { control, state, stops } = createHarness(
      { ...item, runtimeMode: "game", error: "old error" },
      undefined,
      () => blocked,
    );

    const pending = control.stop();
    assert.equal(state.phase, "stopping");
    assert.equal(state.pendingAction, "stop");
    assert.equal(state.runtimeMode, "game");
    assert.deepEqual(stops, ["stop"]);

    release();
    await pending;
    assert.equal(state.phase, "idle");
    assert.equal(state.monitoring, false);
    assert.equal(state.pendingAction, null);
    assert.equal(state.error, null);
    assert.equal(state.runtimeMode, "game");
  }
});

test("idle starting and stopping cannot stop", async () => {
  for (const phase of ["idle", "starting", "stopping"]) {
    const { control, state, stops } = createHarness({
      phase,
      runtimeMode: "game",
    });

    const result = await control.stop();

    assert.deepEqual(stops, []);
    assert.deepEqual(result, state);
    assert.equal(state.phase, phase);
    assert.equal(state.runtimeMode, "game");
  }
});

test("a pending stop blocks every lifecycle operation and stops the backend once", async () => {
  let release;
  const blocked = new Promise(resolve => { release = resolve; });
  const { commands, control, state, stops } = createHarness(
    { phase: "running", monitoring: true, runtimeMode: "game" },
    undefined,
    () => blocked,
  );

  const pending = control.stop();
  await control.stop();
  await control.pause();
  await control.resume();

  assert.equal(state.phase, "stopping");
  assert.equal(state.pendingAction, "stop");
  assert.deepEqual(stops, ["stop"]);
  assert.deepEqual(commands, []);

  release();
  await pending;
});

test("a failed stop restores the previous lifecycle state and runtime mode", async () => {
  for (const item of [
    { phase: "running", monitoring: true },
    { phase: "paused", monitoring: false },
  ]) {
    const { control, state, stops } = createHarness(
      { ...item, runtimeMode: "game" },
      undefined,
      async () => { throw new Error("backend stop failed"); },
    );

    await assert.rejects(control.stop(), /backend stop failed/);

    assert.deepEqual(stops, ["stop"]);
    assert.equal(state.phase, item.phase);
    assert.equal(state.monitoring, item.monitoring);
    assert.equal(state.runtimeMode, "game");
    assert.equal(state.pendingAction, null);
    assert.equal(state.error, "backend stop failed");
  }
});
