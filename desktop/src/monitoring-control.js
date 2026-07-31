"use strict";

const transitions = Object.freeze({
  pause: {
    from: "running",
    command: "pause_monitoring",
    success: {
      phase: "paused",
      monitoring: false,
      environmentStatus: "idle",
      screenBlocked: false,
    },
  },
  resume: {
    from: "paused",
    command: "resume_monitoring",
    success: { phase: "running", monitoring: true },
  },
});

function createMonitoringControl({ getState, command, stop: stopBackend, publishState }) {
  let pendingAction = null;

  async function transition(action) {
    const before = { ...getState() };
    const spec = transitions[action];
    if (pendingAction || before.phase !== spec.from) return before;

    pendingAction = action;
    publishState({ pendingAction: action });
    try {
      await command(spec.command);
    } catch (error) {
      pendingAction = null;
      publishState({ pendingAction: null });
      throw error;
    }

    pendingAction = null;
    publishState({ ...spec.success, pendingAction: null });
    return { ...getState() };
  }

  async function stop() {
    const before = { ...getState() };
    if (pendingAction || !["running", "paused"].includes(before.phase)) return before;

    pendingAction = "stop";
    publishState({ phase: "stopping", pendingAction: "stop" });
    try {
      await stopBackend();
    } catch (error) {
      pendingAction = null;
      publishState({
        phase: before.phase,
        monitoring: before.monitoring,
        runtimeMode: before.runtimeMode,
        pendingAction: null,
        error: String(error?.message || "停止失败"),
      });
      throw error;
    }

    pendingAction = null;
    publishState({
      phase: "idle",
      monitoring: false,
      environmentStatus: "idle",
      screenBlocked: false,
      pendingAction: null,
      error: null,
    });
    return { ...getState() };
  }

  return {
    pause: () => transition("pause"),
    resume: () => transition("resume"),
    stop,
  };
}

module.exports = { createMonitoringControl };
