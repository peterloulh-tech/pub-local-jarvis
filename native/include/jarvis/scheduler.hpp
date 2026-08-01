#pragma once

#include "jarvis/runtime.hpp"

#include <atomic>
#include <chrono>
#include <cstddef>
#include <condition_variable>
#include <cstdint>
#include <functional>
#include <memory>
#include <mutex>
#include <optional>
#include <stop_token>
#include <thread>

namespace jarvis {

enum class Priority : std::uint8_t { background = 0, normal = 1, interactive = 2, control = 3 };

struct ScheduledRequest {
  InferenceRequest request{};
  Priority priority{Priority::normal};
};

struct SchedulerDiagnostics {
  bool busy{};
  std::uint64_t active_id{};
  std::chrono::milliseconds active_elapsed{};
};

class RuntimeOperationGate {
 public:
  class Lease {
   public:
    ~Lease();
    Lease(const Lease&) = delete;
    Lease& operator=(const Lease&) = delete;
    Lease(Lease&& other) noexcept;
    Lease& operator=(Lease&& other) noexcept;

   private:
    friend class RuntimeOperationGate;
    Lease(RuntimeOperationGate& gate, bool inference) noexcept;
    void release() noexcept;

    RuntimeOperationGate* gate_{};
    bool inference_{};
  };

  enum class RebuildRequest : std::uint8_t { accepted, coalesced, rejected };

  [[nodiscard]] std::optional<Lease> begin_inference(std::stop_token stop);
  [[nodiscard]] RebuildRequest request_rebuild() noexcept;
  [[nodiscard]] std::optional<Lease> begin_rebuild(std::stop_token stop);
  [[nodiscard]] Lease begin_lifecycle();
  void close_rebuild_requests() noexcept;
  void open_rebuild_requests() noexcept;

 private:
  void end_inference() noexcept;
  void end_lifecycle() noexcept;

  std::mutex mutex_{};
  std::condition_variable_any ready_{};
  bool inference_active_{};
  bool rebuild_pending_{};
  bool rebuild_active_{};
  bool lifecycle_active_{};
  bool rebuild_requests_open_{true};
  std::size_t lifecycle_waiters_{};
};

class LatestOnlyScheduler {
 public:
  using Completion = std::function<void(InferenceResult)>;

  LatestOnlyScheduler(IOmniRuntime& runtime, Completion completion,
                      RuntimeOperationGate* operation_gate = nullptr);
  ~LatestOnlyScheduler();
  LatestOnlyScheduler(const LatestOnlyScheduler&) = delete;
  LatestOnlyScheduler& operator=(const LatestOnlyScheduler&) = delete;

  void start();
  void stop() noexcept;
  void submit(ScheduledRequest request);
  void cancel(std::uint64_t request_id) noexcept;
  [[nodiscard]] bool busy() const noexcept;
  [[nodiscard]] SchedulerDiagnostics diagnostics() const noexcept;

 private:
  void run(std::stop_token stop);

  IOmniRuntime& runtime_;
  RuntimeOperationGate owned_operation_gate_{};
  RuntimeOperationGate* operation_gate_{};
  Completion completion_;
  mutable std::mutex mutex_{};
  std::condition_variable_any ready_{};
  std::optional<ScheduledRequest> pending_{};
  std::uint64_t next_generation_{};
  std::uint64_t current_generation_{};
  std::uint64_t active_id_{};
  std::chrono::steady_clock::time_point active_started_at_{};
  Priority active_priority_{Priority::background};
  std::shared_ptr<std::atomic_bool> active_cancel_{};
  std::jthread thread_{};
};

} // namespace jarvis
