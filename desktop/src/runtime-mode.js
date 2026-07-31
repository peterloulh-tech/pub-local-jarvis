"use strict";

function normalizeRuntimeMode(value) {
  return value === "game" ? "game" : "assistant";
}

function shouldAcceptBarrage(runtimeMode, scene, screenBlocked) {
  return !screenBlocked && (normalizeRuntimeMode(runtimeMode) === "game" || scene === "game");
}

function shouldShowAssistantBubble(runtimeMode, scene) {
  return normalizeRuntimeMode(runtimeMode) === "assistant" && scene !== "game";
}

function runtimeModeForRender(currentValue, state) {
  const phase = state && state.phase;
  if (["starting", "running", "paused"].includes(phase)) {
    return normalizeRuntimeMode(state.runtimeMode);
  }
  return normalizeRuntimeMode(currentValue);
}

function revealFatalError(launcherWindow) {
  if (!launcherWindow || launcherWindow.isDestroyed()) return false;
  launcherWindow.show();
  launcherWindow.focus();
  return true;
}

function createRuntimeSession(runtimeMode) {
  return {
    runtimeMode: normalizeRuntimeMode(runtimeMode),
    gameProfileNoticeShown: false,
  };
}

function consumeGameProfileNotice(session, syncSucceeded) {
  if (
    !syncSucceeded ||
    session.runtimeMode !== "game" ||
    session.gameProfileNoticeShown
  ) return false;
  session.gameProfileNoticeShown = true;
  return true;
}

async function syncGameProfileForRuntime(session, syncProfile, showNotice) {
  const profile = await syncProfile();
  if (consumeGameProfileNotice(session, true)) showNotice(profile);
  return profile;
}

module.exports = {
  consumeGameProfileNotice,
  createRuntimeSession,
  normalizeRuntimeMode,
  revealFatalError,
  runtimeModeForRender,
  shouldAcceptBarrage,
  shouldShowAssistantBubble,
  syncGameProfileForRuntime,
};
