# AI Jarvis 代码库地图

本文记录 `pub-local-jarvis` 当前代码库的架构事实，供后续维护和二次开发使用。结论以代码为准；当本文、README 与实际实现不一致时，应重新沿入口、调用链和数据流验证并更新本文。

## 1. 项目定位

AI Jarvis 是一个主要面向 64 位 Windows 10/11 的本地多模态桌面助手。它由 Electron 桌面端、Python/FastAPI 编排后端和 C++20 原生 Worker 组成，通过本地 MiniCPM-o 4.5 GGUF 模型理解屏幕画面和系统播放音频。当前分支新增了用户明确选择的 `assistant` 与强制 `game` 两值 `runtimeMode`：普通助手仍由稳定场景控制桌宠、弹幕和课程行为；强制游戏模式则持续执行游戏感知和弹幕链路，模型输出的场景只保留为识别与诊断信息。

核心屏幕、音频和模型推理在本机完成。日程图生成功能是独立的可选联网能力，只有用户配置图像 API 并主动生成时才访问外部服务。

当前能力边界：

- 以文字交互为主，不提供语音播报或实时语音对话。
- 游戏功能只观察、提示和互动，不控制游戏。
- 屏幕与系统音频采集依赖 Windows DXGI/GDI 和 WASAPI。
- 模型权重不随源码或安装包分发，首次启动时另行下载。
- 当前没有授权序列号、许可证激活或商业订阅实现。

## 2. 技术栈

| 层级 | 技术与依赖 | 用途 |
| --- | --- | --- |
| 桌面端 | Electron 41、Node.js CommonJS、HTML/CSS/JavaScript、Lucide、`ws` | 控制面板、桌宠、弹幕、托盘、设置与后端进程管理 |
| 后端 | Python 3.12+、FastAPI、Uvicorn、Pydantic | API、事件总线、场景稳定、弹幕策略、课程和记忆编排 |
| 原生层 | C++20、Windows Named Pipe、DXGI Desktop Duplication、GDI、WASAPI Loopback | 屏幕与音频采集、推理调度、本地 Worker |
| 模型运行时 | MiniCPM-o 4.5 GGUF、固定版本 `llama.cpp-omni`、llama.cpp/ggml | LLM、视觉 VPM、音频 APM 和全双工上下文 |
| GPU | NVIDIA CUDA；安装包同时包含 CPU Worker | 优先使用 CUDA，初始化失败时回退 CPU |
| 本地存储 | TOML、JSON、Markdown、图片和普通文件 | 设置、课程、记忆、运行配置与日志；未使用数据库 |
| 进程通信 | HTTP、WebSocket、自定义二进制 Named Pipe 协议 | Electron ↔ Python ↔ C++ |
| 构建发布 | CMake、MSVC、CUDA Toolkit、PyInstaller、electron-builder、NSIS | 原生 Worker、冻结后端和 Windows 安装包 |
| 测试 | pytest、Node.js test runner、CTest、Electron visual smoke | Python、桌面纯逻辑、原生核心和视觉检查 |

## 3. 目录与模块职责

| 目录 | 模块职责 | 主要语言/框架 | 主要入口 |
| --- | --- | --- | --- |
| `desktop/` | Electron 桌面应用、窗口、托盘、桌宠、弹幕、设置、进程管理和安装包配置 | JavaScript、HTML、CSS、Electron | `desktop/src/main.js` |
| `desktop/src/runtime-mode.js` | 运行模式归一化、启动前选择保留、弹幕/气泡显示策略、方案提示会话和致命故障窗口展示 | JavaScript、CommonJS | `runtime-mode.js` |
| `desktop/src/ui/` | 控制面板、桌宠和弹幕 Renderer | HTML、CSS、JavaScript | `launcher.html`、`pet.html`、`barrage.html` |
| `src/jarvis_backend/api/` | HTTP API、WebSocket 事件流、请求/响应模型和可选 Bearer Token | Python、FastAPI、Pydantic | `routes.py`、`ws.py` |
| `src/jarvis_backend/orchestrator/` | 生命周期、事件总线、场景稳定、弹幕调度、课程和记忆编排 | Python、asyncio | `service.py` |
| `src/jarvis_backend/native/` | Python 侧 Named Pipe client、协议编码和 Worker 事件转发 | Python、asyncio | `client.py`、`protocol.py` |
| `src/jarvis_backend/memory/` | 活动事件、每日记忆、日程图调用和图片存储 | Python | `store.py`、`image_generation.py` |
| `src/jarvis_backend/courses/` | 课程会话、转写、关键帧、Markdown 输出和桌面目录解析 | Python | `core.py` |
| `src/jarvis_backend/prompts/` | 桌宠聊天、全双工、记忆、课程和日程图提示词 | Python | `templates.py` |
| `native/` | C++ Worker、调度器、采集接口、Windows 实现和模型适配层 | C++20、Win32、D3D11/DXGI、WASAPI | `native/src/main.cpp` |
| `third_party/runtime/` | 固定上游运行时、补丁、模型布局校验和第三方声明 | C++、CMake | `CMakeLists.txt`、`VENDOR.json` |
| `config/` | 默认开发配置 | TOML | `config/default.toml` |
| `desktop/scripts/` | 依赖准备、发布构建、运行时冻结和安装包验证 | JavaScript、PowerShell | `build.js`、`prepare-release.ps1` |
| `tests/unit/` | Python 后端单元和控制面测试 | Python、pytest | `pyproject.toml` 中的 pytest 配置 |
| `desktop/test/` | Electron/Node 纯逻辑测试与视觉 smoke | JavaScript | `desktop/package.json` scripts |
| `native/tests/` | 协议、音频、调度器和 Worker 行为测试 | C++20 | `native_tests.cpp` |

## 4. 主要程序入口

### 4.1 Electron

- `desktop/package.json` 的 `main` 指向 `desktop/src/main.js`。
- `desktop/src/main.js` 创建控制面板、桌宠、弹幕和托盘，注册 IPC，并持有桌面端运行状态。
- `desktop/src/preload.js` 通过 `contextBridge` 向 Renderer 暴露受限 API。
- `desktop/src/runtime-mode.js` 提供 `normalizeRuntimeMode()`、`runtimeModeForRender()`、`shouldAcceptBarrage()`、`shouldShowAssistantBubble()`、一次性方案提示会话和 `revealFatalError()`；`desktop/test/runtime-mode.test.js` 覆盖这些纯策略。
- `desktop/src/backend-manager.js` 负责启动、健康检查、HTTP 请求、WebSocket 重连和进程树停止。

### 4.2 Python 后端

- 包命令：`jarvis-backend = jarvis_backend.app:run`。
- `src/jarvis_backend/app.py` 创建 FastAPI 应用并在 lifespan 中启动/停止 `OrchestrationService`。
- `src/jarvis_backend/api/routes.py` 提供 `/api/v1/*`。
- `src/jarvis_backend/api/ws.py` 提供 `/ws/events`。
- `src/jarvis_backend/orchestrator/service.py` 是后端主要业务编排入口。

### 4.3 C++ Worker

- `native/src/main.cpp` 接收 Named Pipe 名称和模型目录参数。
- `Worker::start()` 加载模型、创建 scheduler 并进入运行状态。
- `native/src/windows/named_pipe_server.cpp` 接收 Python 命令并向 Python 返回状态、推理结果和原生事件。
- `native/src/worker.cpp` 负责采集循环、结构化感知、游戏方案注入、双工任务和上下文重建。
- `native/src/omni_runtime.cpp` 是真实 MiniCPM-o 运行时适配器。

### 4.4 启动和打包

- `start-real.cmd`：启动源码版 Electron。
- `start-real.ps1`：检查 Windows 环境、准备 Python、下载模型、构建 Worker、生成配置并启动 Worker/FastAPI。
- `src/jarvis_backend/packaged_launcher.py`：安装版冻结启动器。
- `desktop/scripts/build.js`：正式构建总入口。
- `desktop/scripts/prepare-release.ps1`：构建 CPU/CUDA Worker、冻结 Python 后端并组装自包含运行时。

## 5. 模块通信方式

```text
Electron Renderer
    │  preload IPC
    ▼
Electron Main Process
    │  HTTP /api/v1/*
    │  WebSocket /ws/events
    ▼
FastAPI + OrchestrationService
    │  自定义二进制 Named Pipe 协议 v1
    ▼
C++ Native Worker
    ├─ DXGI / GDI 屏幕采集
    ├─ WASAPI Loopback 系统音频采集
    └─ llama.cpp-omni / MiniCPM-o 4.5
```

### 5.1 Electron ↔ Python

- 命令使用 HTTP，例如 `/api/v1/commands`、`/api/v1/assistant/chat`。
- 后端事件使用 `/ws/events` 推送。
- 安装版依次检查 `31847` 至 `31866`；若这 20 个端口全部不可用，再让系统分配临时端口，并非无限递增搜索。源码真实模式默认使用 `8000`。
- API 默认只绑定 `127.0.0.1`，Bearer Token 为可选配置，默认未启用。

### 5.2 Python ↔ C++

- 使用 Windows Named Pipe，安装版使用每次启动生成的唯一管道名。
- 协议固定为 32 字节头，包含 magic、版本、类型、flags、request ID、payload 长度和 CRC32。
- 主要命令包括 `START`、`STOP`、`SUBMIT`、`CONFIGURE_GAME`、`START_DUPLEX`、`STOP_DUPLEX` 和 `SHUTDOWN`。
- C++ 使用 request ID 最大值封装无需请求对应的原生监控事件。

### 5.3 Python → Electron

- `EventBus` 保存有限历史并向 WebSocket 订阅者扇出事件。
- Electron `event-router.js` 将后端 topic 转换为 scene、bubble、barrage、capture 或 fault effect。
- Electron 主进程结合 `runtimeMode`、当前场景和隐私状态更新窗口：`assistant` 仍按场景显示，强制 `game` 不因 `other/course` 隐藏弹幕或丢弃 `barrage.generated`。

### 5.4 `runtimeMode` 端到端链路与控制优先级

```text
launcher.html 选择 assistant/game
→ launcher.js 保留未启动阶段的本地选择
→ preload.js jarvis:start(runtimeMode)
→ Electron main.js startJarvis(runtimeMode)
→ POST /api/v1/commands start_monitoring {runtimeMode}
→ OrchestrationService 保存 runtime_mode
→ NamedPipeNativeClient 将参数编码为 START JSON payload
→ named_pipe_server.cpp 解析 runtimeMode
→ Worker::start_monitoring(..., RuntimeMode)
```

- `runtimeMode` 只由用户本次启动选择确定；未启动阶段的普通状态刷新不会把选择框强制改回主进程默认 `assistant`，`starting/running/paused` 才同步后端实际模式。
- `pause_monitoring` 不清除 Python/Electron 保存的模式；`resume_monitoring` 重新把同一 `runtimeMode` 放入 START JSON。暂停和恢复不会创建新的方案提示会话。
- `assistant` 是 Electron、Python、C++ 和非法/缺失 START 值的默认模式，保持原自动场景行为。
- 强制 `game` 中，C++ 每轮使用低延迟游戏提示词并注入当前方案；真实 `scene` 仍输出，但不会改变 `runtimeMode`、清空合法候选或关闭游戏连续状态。
- Python 仍执行证据验证和 `CourseSceneStabilizer`，同时保留 `observed_scene`；强制 `game` 下这些结果不再取消或拒绝合法弹幕。
- Electron 仍显示真实 scene 状态，但强制 `game` 下 `setScene(other/course)` 不隐藏弹幕窗口。

### 5.5 `scene`、`screen_idle` 和方案提示的控制位置

- `scene` 的 C++ 归一化和下一轮连续状态在 `native/src/worker.cpp`；Python 证据校验、稳定和弹幕分支在 `src/jarvis_backend/orchestrator/service.py`；Electron窗口决策在 `desktop/src/main.js` 与 `desktop/src/runtime-mode.js`。
- `screen_idle` 检测仍由 C++ `ScreenIdleMonitor` 保留。`structured_perception_allowed()` 只在强制 `game` 下绕过静止画面对结构化感知的阻断；scheduler busy、单任务在途、`perception_pending` 和 latest-only 保护未移除。`assistant` 仍按原逻辑暂停结构化感知。
- 方案同步由 Electron 启动流程先调用 `set_game_profile`。强制 `game` 仅在同步成功后，由一次性 runtime session 显示一次“已加载《方案名称》游戏方案”；scene切换、暂停和恢复不再触发该提示。
- `worker.fatal` 会直接使 Electron 进入错误状态并主动显示、聚焦控制面板，不依赖普通气泡规则。

### 5.6 原生采集边界

- `native/src/windows/dxgi_capture.cpp` 通过硬编码窗口标题 `AI Jarvis Pet` 查找桌宠所在显示器；品牌改名时必须同步评估 Electron 窗口标题和原生捕获逻辑，不能只改展示名称。
- DXGI 或 WASAPI 在采集线程内部启动失败时，当前主要写入 stderr 并退出线程，缺少可靠的上层状态回传；原始 START 请求可能已经返回成功。

## 6. 启动流程

### 6.1 安装版

```text
用户启动 AI Jarvis.exe
→ Electron 创建控制面板、桌宠、弹幕和托盘
→ 用户选择 assistant 或 game 并点击启动
→ BackendManager 选择端口和唯一 Named Pipe
→ 启动冻结的 jarvis-launcher.exe
→ 选择 %LOCALAPPDATA%\AIJarvis 数据目录
→ 检查、下载并校验模型
→ 优先尝试 CUDA Worker，失败时回退 CPU Worker
→ Worker 加载模型并创建 Named Pipe
→ launcher 生成 %LOCALAPPDATA%\AIJarvis\runtime\real.toml
→ launcher 启动冻结 FastAPI 子进程
→ Python 连接 Pipe 并 ping Worker
→ Electron 健康检查和 WebSocket 连接成功
→ Electron 下发当前游戏方案
→ game 模式在 set_game_profile 成功后显示本运行周期唯一一次方案提示
→ Electron 下发 start_monitoring {runtimeMode}
→ Python 保存模式并通过 START JSON 传给 C++ Worker
→ Worker 创建采集线程后返回 START
→ DXGI/WASAPI 在线程内部初始化；Python 同时可能开始后台建立全双工上下文
→ 采集初始化与 duplex 建立可能并行；采集启动失败当前可能只写 stderr 并退出线程
→ duplex.task.started
→ Electron 显示环境感知已就绪
```

### 6.2 源码真实模式

```text
start-real.cmd
→ 启动 desktop/node_modules 中的 Electron
→ 用户点击启动
→ BackendManager 启动 start-real.ps1 -SkipSmokeTest
→ 检查或安装缺失工具
→ 创建/更新 .venv 并安装项目依赖
→ 下载并校验模型
→ 准备固定上游运行时与补丁
→ 构建真实 C++ Worker
→ 写入 .runtime/real.toml
→ 启动 Worker 和 jarvis-backend.exe
→ 后续流程与安装版相同
```

源码真实启动不是轻量启动脚本；首次执行可能安装工具、下载约 6.32 GiB 模型并编译原生运行时。

## 7. 模型生命周期

### 7.1 文件位置和身份

- 源码默认：`models/MiniCPM-o-4_5-gguf`。
- 安装版默认：`%LOCALAPPDATA%\AIJarvis\models\MiniCPM-o-4_5-gguf`。
- `JARVIS_MODEL_ROOT` 可以覆盖安装版位置。
- 下载仓库：`openbmb/MiniCPM-o-4_5-gguf`。
- revision、文件大小和 SHA-256 固定在 `model_download.py` 和源码启动脚本中。

### 7.2 下载和校验

```text
检查 .aijarvis-model.json marker
→ 检查三个文件的存在性和大小
→ 缺失时使用 Hugging Face snapshot_download 断点续传
→ 官方源失败后可切换配置镜像
→ 对三个模型文件进行完整 SHA-256 校验
→ 原子写入 marker
```

marker 快速路径依赖上一次完整哈希校验结果；C++ 运行时还会检查目录、文件可读性和 GGUF magic，但 C++ 层本身不重新计算 SHA-256。

### 7.3 加载和上下文

- `Worker::start()` 调用 `RealOmniRuntime::load()`。
- 运行时加载 LLM、VPM、APM，设置 4096 context、1024 token 感知预算和自动 GPU layer 分配。
- 主 simplex context 用于结构化感知、聊天、记忆和课程总结。
- 持续主动对话使用共享模型权重但独立的 llama/omni duplex context。
- simplex scheduler 和 duplex context 虽然上下文独立，但共享模型权重、显存、内存和推理吞吐，长时间并发仍需实机观察资源竞争。
- Worker 每完成 24 个双工帧，请求用相同 instruction 重建 duplex context，避免上下文无限增长。
- simplex 和 duplex 推理会在系统临时目录写入 BMP/WAV；正常流程会清理，但异常崩溃时可能残留，应作为隐私和清理风险处理。

### 7.4 停止和异常

- 暂停或停止 monitoring：停止采集、停止双工、清空最新帧/音频和近期感知。
- Worker 停止：停止 scheduler、释放 simplex/duplex context、卸载模型。
- CUDA 初始化失败：安装版 launcher 终止 CUDA Worker 并尝试 CPU Worker。
- DXGI/WASAPI 启动失败：当前采集线程可能只写 stderr 后退出，缺少与 Electron 运行状态一致的可靠失败回传。
- Pipe 断开：Python 发布 `worker.fatal`，Electron 进入错误状态。
- 双工重建失败：发布 `duplex.failed` 和 `duplex.stopped`。
- `WorkerSupervisor.restart_limit` 当前未实现自动重启逻辑。

## 8. 测试和构建方式

本节只记录命令。运行前应确认任务允许安装依赖、写构建目录或启动真实模型。

### 8.1 Python 测试

```bash
python -m pytest
```

测试目录由 `pyproject.toml` 配置为 `tests/unit`。

### 8.2 Electron/Node 测试

```bash
cd desktop
npm test
```

实际运行 `node --test test/*.test.js`。

`desktop/test/runtime-mode.test.js` 专门覆盖运行模式默认值、未启动选择保留、game模式弹幕显示、普通气泡隔离、一次性方案提示和致命故障控制面板展示。

可视化 smoke：

```bash
cd desktop
npm run test:visual
```

### 8.3 C++ 核心测试

仓库定义了 `jarvis-native-tests` 目标，预期命令如下：

```bash
cmake -S . -B build/test \
  -DJARVIS_ENABLE_STUB_RUNTIME=ON \
  -DJARVIS_RUNTIME_ENABLE_UPSTREAM=OFF \
  -DBUILD_TESTING=ON
cmake --build build/test --target jarvis-native-tests
ctest --test-dir build/test
```

当前静态代码存在非 Windows 编译阻塞：`Worker::set_game_profile()` 在非 Windows 构建中仍会访问仅定义于 `_WIN32` 条件内的成员。在修复并实际验证之前，不得宣称 C++ Worker 核心测试可以在 Mac 执行。即使该阻塞被修复，Mac 构建也不会覆盖 DXGI、WASAPI、Named Pipe、CUDA、Windows安装包或真实 Windows Worker 路径。

### 8.4 源码开发运行

```powershell
cd desktop
npm run deps:install
cd ..
.\start-real.cmd
```

### 8.5 正式 Windows 安装包

```powershell
cd desktop
npm run deps:install
npm run build
```

产物：`desktop/dist/AI-Jarvis-Setup-<version>-x64.exe`。

### 8.6 安装包验证

```powershell
npm run verify:installer
npm run verify:installer -- -FullStartup
npm run verify:installer -- -FullStartup -RequireCuda
```

### 8.7 平台验证边界

| 能力 | Mac | Windows CPU | Windows + NVIDIA |
| --- | --- | --- | --- |
| Python 单元测试 | 可执行，前提是依赖已存在 | 可执行 | 可执行 |
| Node 纯逻辑测试 | 可执行，前提是依赖已存在 | 可执行 | 可执行 |
| Electron visual smoke | 部分可执行，不代表 Windows | 可执行 | 可执行 |
| C++ Worker 核心测试 | 当前存在非 Windows 编译阻塞；修复并实测前不得宣称可执行 | 可执行，仍不代表 CUDA 路径 | 可执行，CUDA 行为仍需单独实测 |
| DXGI/GDI/WASAPI/Named Pipe | 不可验证 | 必须实测 | 必须实测 |
| 真实 CPU 模型路径 | 不适用 | 可验证但可能极慢 | 可验证 fallback |
| CUDA、显存卸载和性能 | 不可验证 | 不可验证 | 必须实测 |
| 托盘、透明置顶、点击穿透、全屏游戏 | 不可验证 | 必须实测 | 必须实测 |
| NSIS 安装、升级和卸载 | 不可验证 | 必须实测 | 必须实测 |

Mac 可以用于代码阅读、静态分析，以及依赖已经存在时实际可运行的 JavaScript、Python 或其他跨平台轻量检查。DXGI、WASAPI、Named Pipe、CUDA fallback、Windows 安装包、透明置顶/点击穿透、全屏游戏和真实游戏运行都必须由 Windows 环境验证；CUDA 路径还需要 NVIDIA 实机。

当前分支还包含 `.github/workflows/windows-validate.yml`：它在 `windows-2022` 上运行 Node/Python 测试与 Ruff，编译并运行 CPU Native 测试目标，再编译正式 CPU/CUDA Worker；该工作流不生成安装包。其结果只能作为云端编译和自动测试证据，不能替代真实 Windows/NVIDIA 安装、窗口、采集和游戏验证。

## 9. 文档维护规则

- 重要结论必须由入口、引用、调用链或数据流证明，不能只根据文件名判断。
- 修改模块边界、通信协议、启动方式、模型布局或构建命令时，应同步更新本文。
- Windows/CUDA/游戏行为若只完成静态分析或 Mac 测试，必须明确标记尚未实机验证。
