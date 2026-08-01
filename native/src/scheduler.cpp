#include "jarvis/scheduler.hpp"

#include <chrono>
#include <exception>
#include <iostream>
#include <sstream>
#include <string>
#include <string_view>
#include <utility>

namespace jarvis {
namespace {
void log_inference_event(std::string_view event, std::uint64_t inference_id,
                         std::chrono::steady_clock::time_point started_at,
                         std::chrono::steady_clock::time_point now) noexcept {
  try {
    const auto monotonic_ms = std::chrono::duration_cast<std::chrono::milliseconds>(
                                  now.time_since_epoch())
                                  .count();
    const auto elapsed_ms =
        std::chrono::duration_cast<std::chrono::milliseconds>(now - started_at).count();
    std::ostringstream line;
    line << "{\"native_event\":\"" << event << "\",\"inference_id\":"
         << inference_id << ",\"monotonic_ms\":" << monotonic_ms
         << ",\"elapsed_ms\":" << elapsed_ms << '}';
    std::cerr << line.str() << '\n';
  } catch (...) {
  }
}
} // namespace

LatestOnlyScheduler::LatestOnlyScheduler(IOmniRuntime& runtime, Completion completion)
    : runtime_(runtime), completion_(std::move(completion)) {}
LatestOnlyScheduler::~LatestOnlyScheduler() { stop(); }
void LatestOnlyScheduler::start() {
  std::lock_guard lock(mutex_);
  if (!thread_.joinable()) thread_ = std::jthread([this](std::stop_token stop) { run(stop); });
}
void LatestOnlyScheduler::stop() noexcept {
  if (thread_.joinable()) {
    {
      std::lock_guard lock(mutex_);
      pending_.reset();
      if (active_cancel_) active_cancel_->store(true);
    }
    thread_.request_stop(); ready_.notify_all(); thread_.join();
  }
}
void LatestOnlyScheduler::submit(ScheduledRequest request) {
  std::lock_guard lock(mutex_);
  const bool accepted = !pending_ || request.priority >= pending_->priority;
  if (accepted) {
    pending_ = std::move(request);
    ++next_generation_;
    current_generation_ = next_generation_;
    if (active_cancel_ && pending_->priority >= Priority::interactive &&
        pending_->priority >= active_priority_) {
      active_cancel_->store(true);
    }
  }
  ready_.notify_one();
}
void LatestOnlyScheduler::cancel(std::uint64_t id) noexcept {
  std::lock_guard lock(mutex_);
  if (pending_ && pending_->request.id == id) pending_.reset();
  if (active_id_ == id && active_cancel_) active_cancel_->store(true);
}
bool LatestOnlyScheduler::busy() const noexcept {
  std::lock_guard lock(mutex_); return active_id_ != 0 || pending_.has_value();
}
SchedulerDiagnostics LatestOnlyScheduler::diagnostics() const noexcept {
  std::lock_guard lock(mutex_);
  SchedulerDiagnostics result{
      .busy = active_id_ != 0 || pending_.has_value(), .active_id = active_id_};
  if (active_id_ != 0) {
    result.active_elapsed = std::chrono::duration_cast<std::chrono::milliseconds>(
        std::chrono::steady_clock::now() - active_started_at_);
  }
  return result;
}
void LatestOnlyScheduler::run(std::stop_token stop) {
  while (!stop.stop_requested()) {
    ScheduledRequest work; std::shared_ptr<std::atomic_bool> cancel; std::uint64_t generation{};
    std::chrono::steady_clock::time_point started_at;
    {
      std::unique_lock lock(mutex_);
      ready_.wait(lock, stop, [this] { return pending_.has_value(); });
      if (stop.stop_requested()) break;
      work = std::move(*pending_); pending_.reset();
      generation = current_generation_;
      active_id_ = work.request.id; active_priority_ = work.priority;
      active_started_at_ = started_at = std::chrono::steady_clock::now();
      active_cancel_ = cancel = std::make_shared<std::atomic_bool>(false);
    }
    log_inference_event("infer.begin", work.request.id, started_at, started_at);
    InferenceResult result;
    bool failed{};
    try {
      result = runtime_.infer(work.request, *cancel);
    } catch (const std::exception& error) {
      failed = true;
      result = {work.request.id, std::string("runtime error: ") + error.what(), false};
    } catch (...) {
      failed = true;
      result = {work.request.id, "runtime error: unknown exception", false};
    }
    const auto finished_at = std::chrono::steady_clock::now();
    log_inference_event(failed ? "infer.failed" : "infer.end", work.request.id,
                        started_at, finished_at);
    result.cancelled = result.cancelled || cancel->load();
    bool stale{};
    {
      std::lock_guard lock(mutex_);
      stale = generation != current_generation_ && work.priority <= Priority::normal;
      active_id_ = 0; active_started_at_ = {};
      active_priority_ = Priority::background; active_cancel_.reset();
    }
    if (completion_ && !stale) completion_(std::move(result));
  }
}
} // namespace jarvis
