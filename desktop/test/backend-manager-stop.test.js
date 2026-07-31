"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { BackendManager } = require("../src/backend-manager");

test("an external backend cannot be reported as stopped", async () => {
  const manager = new BackendManager({ backendRoot: process.cwd() });
  let socketCloses = 0;
  let terminations = 0;
  manager.connectedBackend = true;
  manager.socket = { close: () => { socketCloses += 1; } };
  manager.terminateChildTree = async () => { terminations += 1; };

  await assert.rejects(manager.stop(), /Electron/);

  assert.equal(socketCloses, 0);
  assert.equal(terminations, 0);
  assert.equal(manager.connectedBackend, true);
  assert.equal(manager.stopping, false);
});

test("stopping an owned backend resets the manager for a later restart", async () => {
  const manager = new BackendManager({ backendRoot: process.cwd() });
  const commands = [];
  let terminations = 0;
  manager.connectedBackend = true;
  manager.ownsBackend = true;
  manager.command = async name => { commands.push(name); };
  manager.terminateChildTree = async () => { terminations += 1; };

  await Promise.all([manager.stop(), manager.stop()]);

  assert.deepEqual(commands, ["shutdown"]);
  assert.equal(terminations, 1);
  assert.equal(manager.connectedBackend, false);
  assert.equal(manager.ownsBackend, false);
  assert.equal(manager.stopping, false);
});
