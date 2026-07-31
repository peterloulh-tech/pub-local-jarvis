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

function createMonitoringControl({ getState, command, publishState }) {
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

  return {
    pause: () => transition("pause"),
    resume: () => transition("resume"),
  };
}

module.exports = { createMonitoringControl };
