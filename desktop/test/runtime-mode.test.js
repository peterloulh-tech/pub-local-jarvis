"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  consumeGameProfileNotice,
  createRuntimeSession,
  normalizeRuntimeMode,
  revealFatalError,
  runtimeModeForRender,
  shouldAcceptBarrage,
  shouldShowAssistantBubble,
  syncGameProfileForRuntime,
} = require("../src/runtime-mode");

test("runtime mode accepts explicit game mode and defaults everything else to assistant", () => {
  assert.equal(normalizeRuntimeMode("game"), "game");
  assert.equal(normalizeRuntimeMode("assistant"), "assistant");
  assert.equal(normalizeRuntimeMode("other"), "assistant");
  assert.equal(normalizeRuntimeMode(undefined), "assistant");
});

test("forced game mode keeps barrage available for every detected scene", () => {
  for (const scene of ["game", "other", "course"]) {
    assert.equal(shouldAcceptBarrage("game", scene, false), true);
  }
  assert.equal(shouldAcceptBarrage("game", "other", true), false);
});

test("assistant mode preserves scene-controlled barrage and bubble behavior", () => {
  assert.equal(shouldAcceptBarrage("assistant", "game", false), true);
  assert.equal(shouldAcceptBarrage("assistant", "other", false), false);
  assert.equal(shouldAcceptBarrage("assistant", "course", false), false);
  assert.equal(shouldShowAssistantBubble("assistant", "other"), true);
  assert.equal(shouldShowAssistantBubble("assistant", "game"), false);
  assert.equal(shouldShowAssistantBubble("game", "other"), false);
});

test("idle state refresh keeps the user's pending game selection for start", () => {
  let selectedMode = "game";
  for (const gameProfile of ["保存后的方案", "切换后的方案"]) {
    selectedMode = runtimeModeForRender(selectedMode, {
      phase: "idle",
      runtimeMode: "assistant",
      gameProfile,
    });
  }

  assert.equal(selectedMode, "game");
  assert.equal(normalizeRuntimeMode(selectedMode), "game");
  assert.equal(runtimeModeForRender("game", {
    phase: "starting",
    runtimeMode: "assistant",
  }), "assistant");
  assert.equal(runtimeModeForRender("assistant", {
    phase: "running",
    runtimeMode: "game",
  }), "game");
  assert.equal(runtimeModeForRender("assistant", {
    phase: "paused",
    runtimeMode: "game",
  }), "game");
});

test("fatal worker errors reveal the control panel even when game bubbles are suppressed", () => {
  const calls = [];
  const launcherWindow = {
    isDestroyed: () => false,
    show: () => calls.push("show"),
    focus: () => calls.push("focus"),
  };

  assert.equal(shouldShowAssistantBubble("game", "other"), false);
  assert.equal(revealFatalError(launcherWindow), true);
  assert.deepEqual(calls, ["show", "focus"]);
});

test("game profile success notice is consumed once per game runtime session", () => {
  const gameSession = createRuntimeSession("game");
  assert.equal(consumeGameProfileNotice(gameSession, false), false);
  assert.equal(consumeGameProfileNotice(gameSession, true), true);
  assert.equal(consumeGameProfileNotice(gameSession, true), false);

  const assistantSession = createRuntimeSession("assistant");
  assert.equal(consumeGameProfileNotice(assistantSession, true), false);

  const nextGameSession = createRuntimeSession("game");
  assert.equal(consumeGameProfileNotice(nextGameSession, true), true);
});

test("profile synchronization failure never displays the success notice", async () => {
  const session = createRuntimeSession("game");
  const notices = [];
  await assert.rejects(
    syncGameProfileForRuntime(
      session,
      async () => { throw new Error("sync failed"); },
      () => notices.push("shown"),
    ),
    /sync failed/,
  );
  assert.deepEqual(notices, []);

  await syncGameProfileForRuntime(
    session,
    async () => ({ name: "测试方案" }),
    profile => notices.push(profile.name),
  );
  assert.deepEqual(notices, ["测试方案"]);
});
