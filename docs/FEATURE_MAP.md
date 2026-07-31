# AI Jarvis 功能地图

本文按功能记录当前主要代码文件、真实数据流、关键边界、修改风险和验证要求。文件和流程以当前仓库实现为准。

风险等级含义：

- **低**：局部展示或纯逻辑，接口边界清晰。
- **中**：跨越持久化、IPC、配置或窗口生命周期。
- **高**：涉及场景判断、模型、原生采集、进程协议、安装包或兼容迁移。

## 1. 设置系统

### 相关文件

- `desktop/src/ui/launcher.html`
- `desktop/src/ui/launcher.js`
- `desktop/src/preload.js`
- `desktop/src/main.js`
- `desktop/src/game-profiles.js`
- `desktop/src/image-generation-settings.js`
- `src/jarvis_backend/settings.py`
- `config/default.toml`
- `src/jarvis_backend/packaged_launcher.py`
- `start-real.ps1`

### 数据流

游戏方案设置：

```text
launcher 设置弹窗
→ window.jarvis preload API
→ Electron ipcMain
→ normalizeProfile
→ app.getPath("userData")/game-profiles.json
→ set_game_profile HTTP 命令
→ Python NamedPipeNativeClient
→ CONFIGURE_GAME
→ C++ Worker 保存当前 name/prompt
```

图像 API 设置：

```text
launcher 日程图设置
→ Electron ipcMain
→ normalizeSettings
→ API Key 通过 safeStorage 加密
→ userData/image-generation.json
→ 生成日程图时解密并传给后端
```

一般运行设置：

```text
config/default.toml
→ Settings.load
→ 按实际消费者分别进入 FastAPI、OrchestrationService 或启动器链路
```

配置接线状态必须分开理解：

- `app.py` 创建应用时主要消费 `native.mode`、`native.pipe_name` 和 `native.request_timeout_seconds`，应用标题使用 `name`；其 `run()` 入口消费 `server.host` 和 `server.port`。
- `OrchestrationService` 实际消费场景、弹幕、交互、记忆和课程相关设置。
- 安装版的 Electron `BackendManager` 直接选择端口和唯一 Pipe，并通过环境变量交给 `packaged_launcher.py`；`start-real.ps1` 和 `packaged_launcher.py` 还会直接选择 Worker、模型目录并分别生成 `real.toml`。这些启动器行为不等于同名 `Settings` 字段已被后端运行逻辑消费。
- `native.protocol_version`、`native.heartbeat_interval_seconds` 和 `native.max_frame_bytes` 当前会被 `Settings` 解析，但没有接入对应的 Python 运行逻辑；协议版本在 `native/protocol.py` 另行硬编码为 1，协议最大载荷也使用独立硬编码值。
- `native.worker_path` 和 `native.model_path` 也会写入配置并被解析，但实际 Worker 进程和模型目录由源码/安装版启动器直接选择，FastAPI 编排不会通过这两个 `Settings` 字段启动 Worker 或加载模型。
- 默认配置、源码启动模板和安装版模板包含重复常量，修改 `default.toml` 不保证真实运行路径同步变化。
- 后续新增或修改设置时，必须验证“界面 → 保存 → 配置读取 → 后端 → 原生模块 → 实际行为”的完整链路，不能以字段存在或成功解析代替实际生效验证。

### 重启恢复

- Electron `whenReady()` 读取游戏方案和图像 API 设置。
- 后端启动后，Electron 再次下发选中的游戏方案。
- 课程和记忆从对应文件目录恢复，不依赖 Electron 设置文件。

### 修改风险与验证

- 风险：**中**。
- 可以在 Mac 测试 JSON 归一化、保存和加载逻辑。
- `safeStorage`、真实 userData 路径、后端同步和重启恢复应在 Windows 验证。

## 2. assistant 与强制 game 运行模式

### 相关文件

- `desktop/src/ui/launcher.html`
- `desktop/src/ui/launcher.js`
- `desktop/src/preload.js`
- `desktop/src/monitoring-control.js`
- `desktop/src/backend-manager.js`
- `desktop/src/runtime-mode.js`
- `desktop/src/main.js`
- `src/jarvis_backend/orchestrator/service.py`
- `src/jarvis_backend/native/client.py`
- `native/include/jarvis/worker.hpp`
- `native/src/windows/named_pipe_server.cpp`
- `native/src/worker.cpp`
- `desktop/test/runtime-mode.test.js`
- `tests/unit/test_control_plane_api.py`
- `native/tests/native_tests.cpp`

### 端到端数据流

```text
用户启动前选择 runtimeMode
→ launcher.js 在未启动状态保留选择
→ preload IPC
→ Electron startJarvis(runtimeMode)
→ HTTP start_monitoring {runtimeMode}
→ Python OrchestrationService.runtime_mode
→ Named Pipe START JSON
→ runtime_mode_from_start_payload
→ Worker::start_monitoring(..., RuntimeMode)
```

`runtimeMode` 不写入用户设置文件，只描述本次运行周期。`assistant` 是所有层的默认值；非法、缺失或无法解析的值都会回退到 `assistant`。暂停不会清除模式，恢复时 Python 把已保存的模式再次放入 START JSON。模型输出的 `scene` 不会写回或改变 `runtimeMode`。

### 当前行为对照

| 行为 | `assistant` | 强制 `game` |
| --- | --- | --- |
| 屏幕和系统音频采集 | 启动 monitoring 后持续采集 | 启动 monitoring 后持续采集 |
| 结构化感知提示词 | 由 `previous_scene_` 选择统一、游戏连续或课程连续提示词 | 每轮固定使用低延迟游戏提示词，并追加强制游戏约束 |
| 游戏方案注入 | 仅下一轮游戏连续状态注入 | 每轮注入当前方案名称和提示词 |
| 模型 `scene` | 控制候选保留、Python业务分支和Electron窗口 | 只作为真实识别与诊断结果，不控制游戏链路 |
| `screen_idle` | 阻断新的结构化感知，保留原提醒逻辑 | 继续按原正常节奏调度结构化感知，不移除并发保护 |
| 弹幕候选 | 只有验证后的游戏场景保留 | `game/other/course` 都可保留合法候选 |
| Python弹幕 | 稳定场景不是游戏时拒绝或取消 | 不因稳定场景或显示场景不是游戏而拒绝、取消 |
| Electron弹幕窗口 | 按稳定scene显示或隐藏 | 本次运行期间不因scene变化隐藏或丢弃事件 |
| 普通桌宠气泡 | 保留原行为 | 普通气泡被抑制；致命故障仍主动打开控制面板 |
| ambient duplex | monitoring后按现有逻辑后台创建 | 当前代码同样会后台创建，但普通主动消息不显示为桌宠气泡 |

强制 `game` 是当前已经实现、待 GitHub Windows 验证和真实 Windows/NVIDIA 实测的代码能力。它不等于产品规划中的“专注游戏模式/画面加音频游戏模式”已经全部完成：当前尚未提供关闭音频或关闭 ambient duplex 的独立产品模式，也没有模型能力兼容矩阵。

### 方案提示生命周期

```text
game 启动周期
→ set_game_profile 成功
→ runtime session 尚未消费提示
→ 显示一次“已加载《方案名称》游戏方案”
```

- `assistant` 不显示该提示。
- 同一启动 Promise 的重复调用、`scene` 变化、暂停和恢复不会再次显示。
- 同步失败不显示成功提示。
- 停止当前 AI 运行后再次点击启动，或关闭并重新打开应用后，新运行周期可以再次显示。

### 暂停、恢复与真正停止

```text
控制面板停止按钮
→ preload jarvis:stop
→ main.js 生命周期控制
→ BackendManager.stop()
→ shutdown + Electron 自有 Backend/Worker 进程树 + WebSocket
→ idle
```

- `running` 和 `paused` 允许停止，并立即进入 `stopping`；`idle`、`starting`、`stopping` 不允许停止。
- `stopping` 期间禁止启动、暂停、恢复和重复停止，Backend 停止调用最多执行一次。
- 停止成功进入 `idle`、清除 pending 与旧错误，并保留用户当前选择的 `runtimeMode`。
- 停止失败恢复操作前状态和 `runtimeMode`，不得假装进入 `idle`；非 Electron 自有 Backend 会明确拒绝真正停止且不会被擅自终止。
- 暂停仍保留 Backend、Worker 和模型，恢复沿现有命令继续运行，不重新启动或重新加载 Backend。

### 修改风险与验证

- 风险：**高**，因为跨越Renderer、Electron主进程、HTTP、Python、Named Pipe和C++ Worker。
- 纯策略、Python编排和Native解析已有针对性测试。
- 当前仍需 `.github/workflows/windows-validate.yml` 验证 MSVC/Named Pipe/CUDA 正式目标，并需真实 Windows/NVIDIA 验证采集、全屏窗口、连续运行和游戏效果。

## 3. 游戏场景识别

### 相关文件

- `native/src/worker.cpp`
- `native/src/fingerprint.cpp`
- `native/src/windows/dxgi_capture.cpp`
- `native/src/windows/wasapi_capture.cpp`
- `src/jarvis_backend/orchestrator/service.py`
- `src/jarvis_backend/orchestrator/scene.py`
- `config/default.toml`
- `desktop/src/event-router.js`
- `desktop/src/scene-policy.js`
- `desktop/src/main.js`

### 数据流

本轮场景结果：

```text
DXGI/GDI 当前帧 + WASAPI 音频
→ Worker 判断画面变化、音频活动和感知触发条件
→ MiniCPM-o 结构化感知 JSON
→ C++ 初步归一化 scene/confidence/scene_evidence
→ Steam/Steam WebHelper 前台窗口硬拒绝
→ Python _parse_perception 再次证据校验
→ CourseSceneStabilizer 连续样本稳定
→ perception.completed
→ WebSocket
→ Electron setScene
```

下一轮连续状态：

```text
C++ validated_scene_for_prompt
→ previous_scene_
→ 选择下一轮统一/低延迟/课程连续提示词
→ 决定下一轮是否注入游戏方案和近期观察
```

`validated_scene_for_prompt` 只更新用于下一轮的 `previous_scene_`，不会直接改写本轮 `value["scene"]`；本轮最终展示场景由 Python 证据验证和场景稳定器确定。

强制 `game` 的控制分支：

```text
模型真实 scene
→ C++保留scene作为本轮结果，但把下一轮previous_scene_维持为game
→ Python保留observed_scene并继续运行稳定器
→ runtime_mode=game绕过候选清空、弹幕取消和显示场景门禁
→ Electron记录scene但保持弹幕窗口可用
```

### 当前规则

- 场景值固定为 `game`、`course`、`other`。
- 游戏置信度最低 `0.72`，课程最低 `0.78`。
- 默认进入游戏需连续 2 个有效样本。
- 默认进入课程需连续 2 个有效样本。
- 游戏遇到明确非游戏证据时 1 个样本退出；不确定退出默认 2 个样本。
- 前台窗口在一次推理期间切换时，C++ 丢弃旧结果并清理连续历史。
- `SceneHysteresis` 和 `/scene/observations` 是兼容接口，不是当前真实多模态场景链路的主稳定器。
- 课程录制结束另有 4 个样本和 90 秒 grace period，不等同于桌面显示场景。
- 这些阈值和稳定器仍在强制 `game` 中产生诊断结果，但不再决定该运行周期是否继续游戏弹幕。

### 关键边界

- 游戏方案不得用于首次游戏分类。
- 提示词规定必须先填写客观 observation 和 evidence，再生成内容。
- DXGI 捕获桌宠所在显示器；桌宠和游戏位于不同显示器时存在漏捕风险。
- `dxgi_capture.cpp` 使用硬编码窗口标题 `AI Jarvis Pet` 查找桌宠显示器；品牌改名时必须同步评估原生捕获逻辑，不能只修改 Electron 标题。
- DXGI/WASAPI 在线程内启动失败时，当前可能只写 stderr 并退出线程，缺少可靠的上层状态回传，START 请求可能已经返回成功。

### 修改风险与验证

- 风险：**高**。
- Python 稳定器和解析器可在 Mac 单测。
- 识别准确率、多显示器、游戏视频与真实互动游戏必须在 Windows+真实模型验证；CUDA性能需 NVIDIA。

## 4. 游戏方案

### 相关文件

- `desktop/src/game-profiles.js`
- `desktop/src/ui/launcher.js`
- `desktop/src/main.js`
- `desktop/src/backend-manager.js`
- `src/jarvis_backend/api/routes.py`
- `src/jarvis_backend/native/client.py`
- `native/src/windows/named_pipe_server.cpp`
- `native/src/worker.cpp`

### 数据流

```text
用户新建、编辑或选择游戏方案
→ Electron 归一化并保存 game-profiles.json
→ syncGameProfile
→ POST /api/v1/commands: set_game_profile
→ Named Pipe CONFIGURE_GAME
→ Worker::set_game_profile
→ 清空 recent_perceptions
→ assistant 仅在下一轮游戏连续状态注入 <game_profile>
→ 强制 game 每轮游戏提示词都注入 <game_profile>
→ 方案只控制称呼、语气、领域关注和表达方式
```

启动提示是独立链路：Electron 在强制 `game` 启动时等待 `set_game_profile` 成功，再由本次 runtime session 显示一次方案加载提示；它不再绑定 `setScene("game")`。

### 当前数据结构

- `id`：最多 80 字符。
- `name`：最多 40 字符。
- `prompt`：最多 8000 字符。
- 内置方案：我的世界、植物大战僵尸、胡闹厨房。
- 删除内置方案会记录 `deletedBuiltInIds`，避免重启时重新出现。
- C++ 对过长方案做首尾压缩后再注入提示词。

### 关键边界

- `assistant` 中方案只在 `previous_scene_ == "game"` 时注入；强制 `game` 中每轮注入。
- 方案数据块被标记为非指令事实，不得修改分类或补充画面事实。
- 直接改变注入时机可能导致任意用户方案污染场景判断。

### 修改风险与验证

- 风险：**中**；改变注入边界时升为**高**。
- 保存、升级和删除行为可在 Mac 单测。
- 对弹幕风格和分类隔离的实际影响需 Windows+真实模型验证。

## 5. 弹幕生成

### 相关文件

- `native/src/worker.cpp`
- `native/src/omni_runtime.cpp`
- `src/jarvis_backend/orchestrator/service.py`
- `config/default.toml`
- `tests/unit/test_control_plane_api.py`
- `native/tests/native_tests.cpp`

### 数据流

```text
当前画面/音频
→ 结构化感知提示词
→ observation + 最多 3 个 barrage_candidates
→ C++ JSON 完整/截断恢复
→ 候选去空、去完全重复、限制数量
→ 空候选时按 observation/evidence/方案风格生成 fallback
→ Python 截断恢复和字段限制
→ 质量 penalty、近期精确重复和语义相似过滤
→ 排序后的可用候选
```

在 `assistant` 中，只有校验后的游戏场景进入候选链路；在强制 `game` 中，提示词要求保留真实scene但始终生成游戏弹幕候选，C++和Python不会因为scene为`other/course`清空合法候选。

### 关键规则

- 每条候选在 Python 中最多保留 30 字。
- 疑问句、推测语气和“根据画面”等元叙述会被降权。
- 精确重复窗口默认 20 秒。
- 语义相似窗口默认 4 秒。
- fallback 的具体画面事实必须来自 observation 和 scene evidence，不能凭游戏名称或提示词虚构；游戏方案名称和提示词可以影响称呼、表达风格和语气，但不得被当作真实画面事实。

### 修改风险与验证

- 风险：**高**。
- 解析、排序和去重可单测。
- 内容正确性、延迟、方案服从度和幻觉必须在真实游戏、Windows 和模型环境验证。

## 6. 弹幕调度和显示

### 相关文件

- `src/jarvis_backend/orchestrator/service.py`
- `src/jarvis_backend/barrage/policy.py`
- `src/jarvis_backend/orchestrator/events.py`
- `desktop/src/event-router.js`
- `desktop/src/main.js`
- `desktop/src/barrage-overlay.js`
- `desktop/src/ui/barrage.js`
- `desktop/src/ui/barrage.css`

### 自动游戏弹幕数据流

```text
Python 可用候选
→ _start_barrage_sequence
→ 第一条立即发布 barrage.generated
→ 其余候选每隔 game_barrage_interval_seconds 发布
→ 新的非空有效候选进入 _start_barrage_sequence 时取消旧 _barrage_task
→ assistant离开game，或任一模式停止monitoring时取消未发送候选
→ EventBus
→ WebSocket
→ Electron event-router
→ assistant仅当前scene=game且非隐私模式时转发
→ 强制 game 只检查非隐私模式，不用 `scene` 拒绝
→ 透明、置顶、点击穿透 barrage BrowserWindow
→ 5 条轨道选择最早可用轨道
→ 6 秒 CSS 动画
```

### `BarragePolicy` 的真实用途

`BarragePolicy` 维护陈旧、重复和容量限制，服务 `POST /api/v1/barrage`。当前自动游戏弹幕链路没有调用其 `drain()`，因此它不是自动弹幕的真实发送队列。优化弹幕持续性时不能只修改 `barrage/policy.py`。

### 当前时间参数

- 候选发送间隔：2.5 秒。
- 弹幕轨道占用时间：1.5 秒。
- 屏幕飞行动画：6 秒。
- 自动候选序列只有一个任务；新的非空有效弹幕组会取消旧组的剩余发送任务，因此仍存在新有效弹幕组覆盖旧组剩余弹幕的问题。
- 如果新一轮没有有效候选，不会调用 `_start_barrage_sequence()`；强制 `game` 中即使真实scene为`other/course`，旧弹幕序列也可能继续发送。

### 修改风险与验证

- 风险：**高**，因为“候选序列”和“API 队列”是两条不同路径。
- Python任务取消和顺序可在 Mac 单测。
- 视觉密度、帧率、全屏置顶、点击穿透和反作弊兼容必须在 Windows 游戏实测。

## 7. 桌宠

### 相关文件

- `desktop/src/main.js`
- `desktop/src/pet-state.js`
- `desktop/src/pet-window.js`
- `desktop/src/pet-display.js`
- `desktop/src/pet-hit-test.js`
- `desktop/src/privacy-mode.js`
- `desktop/src/ui/pet.html`
- `desktop/src/ui/pet.js`
- `desktop/src/ui/pet.css`
- `desktop/assets/pet/`

### 数据流

```text
后端 scene/bubble/course/idle/fault 事件
→ Electron routeBackendEvent
→ 主进程检查 scene、monitoring 和 screenBlocked
→ pet BrowserWindow
→ preload 事件
→ pet.js 更新形象、气泡、聊天和隐私状态
```

### 窗口行为

- 无边框、透明、置顶、跨工作区、默认点击穿透。
- 鼠标位于桌宠主体、气泡或聊天区时临时恢复交互。
- 支持拖拽，并限制在当前显示器工作区。
- `assistant` 中 `game` 场景隐藏桌宠主体；强制 `game` 中不论模型 `scene` 为何都隐藏桌宠主体，聊天展开时仍可显示。
- 双击桌宠切换屏幕/音频感知隐私状态。
- `Ctrl+M` 打开或关闭聊天框。

### 修改风险与验证

- 纯状态、边界和命中测试风险：**低至中**。
- 窗口生命周期、DPI、多显示器、全屏置顶和点击穿透风险：**高**。
- 纯函数可在 Mac 测试；窗口行为必须 Windows 实测。

## 8. 主动对话

这里的“主动对话”包括用户通过 `Ctrl+M` 发起的桌宠聊天，以及模型主动决定 `LISTEN`/`SPEAK` 的持续感知消息；两者使用不同流程。

### 相关文件

- `desktop/src/main.js`
- `desktop/src/ui/pet.js`
- `desktop/src/backend-manager.js`
- `src/jarvis_backend/api/routes.py`
- `src/jarvis_backend/orchestrator/service.py`
- `src/jarvis_backend/prompts/templates.py`
- `src/jarvis_backend/native/client.py`
- `native/src/worker.cpp`
- `native/src/omni_runtime.cpp`

### 用户聊天数据流

```text
Ctrl+M / 聊天框
→ Electron IPC jarvis:pet-chat
→ POST /api/v1/assistant/chat
→ OrchestrationService.pet_chat
→ monitoring 已请求且当前存在 ambient duplex 会话时才暂停 duplex
→ build_pet_chat_prompt + 最近 4 轮问答
→ Named Pipe SUBMIT/ask
→ 最新画面或音频存在时，simplex 模型结合媒体上下文回答；否则可能只有文字上下文
→ 清理控制 token
→ HTTP 返回聊天框
→ 只有确实暂停过且当前 monitoring/会话状态仍允许时才重新建立 ambient duplex
```

### 模型主动消息数据流

```text
start_monitoring
→ Python 后台 start_duplex(jarvis-ambient)
→ C++ 建立独立 duplex context
→ 通常约每秒更新一次当前帧，并携带最近约 2 秒的 16 kHz 单声道音频
→ 音频滚动缓冲区约 32000 个采样，不足时在前部补零
→ 模型 LISTEN 或 SPEAK
→ duplex.decision
→ Python 拼接碎片、过滤复述/提问/越权话术/重复
→ assistant.message
→ WebSocket
→ 桌宠气泡；`assistant` 的游戏场景及强制 `game` 运行模式不显示普通气泡
```

当前 ambient instruction 主要负责普通场景中的视频/直播点评；桌面、游戏和课程由结构化感知处理。

当前强制 `game` 并未关闭 ambient duplex：Python 在 monitoring 后仍会创建该上下文，但 Electron 抑制普通主动气泡。后续若实现产品规划中的“专注游戏模式”，必须另行增加不启动音频/duplex 的真实生命周期控制，不能把当前强制 `game` 误写成该功能已经存在。

duplex 使用约 2 秒滚动音频窗口；结构化感知则按画面变化、音频活动、课程连续状态和 heartbeat 等条件触发，可累计更长的待感知音频，当前上限约 12 秒。两条路径不能按相同音频窗口理解。

### 修改风险与验证

- 风险：**高**，涉及两个上下文的暂停、恢复和并发。
- simplex scheduler 和 duplex context 虽然上下文独立，但共享模型权重、显存、内存和推理吞吐，长时间并发可能产生资源竞争。
- Python消息过滤和状态切换可单测。
- 上下文显存、真实延迟、碎片输出和长时间稳定性需 Windows+真实模型验证；CUDA路径需 NVIDIA。

## 9. 模型下载和加载

### 相关文件

- `src/jarvis_backend/model_download.py`
- `src/jarvis_backend/packaged_launcher.py`
- `start-real.ps1`
- `third_party/runtime/src/model_layout.cpp`
- `native/src/main.cpp`
- `native/src/worker.cpp`
- `native/src/omni_runtime.cpp`
- `third_party/runtime/VENDOR.json`

### 下载数据流

```text
launcher 选择模型目录
→ marker + 文件大小快速检查
→ 缺失时 snapshot_download 固定 repo/revision/allow_patterns
→ 官方源失败后切换可配置镜像
→ 下载完成后完整 SHA-256
→ 写入 .aijarvis-model.json
```

### 加载数据流

```text
launcher 选择 CUDA/CPU Worker
→ 传入 pipe_name + model_root
→ C++ validate_minicpm_o_4_5_layout
→ 验证三文件位置、可读性和 GGUF magic
→ RealOmniRuntime::load
→ omni_init simplex context
→ Worker 创建 scheduler
→ Named Pipe 开始接受连接
→ 安装版 launcher 写入 %LOCALAPPDATA%\AIJarvis\runtime\real.toml 并启动 FastAPI
→ monitoring 后按需创建 duplex context
```

### 上下文重建和停止

- duplex 每完成 24 帧触发重建。
- 重建使用原 session instruction。
- 停止 monitoring 会停止并释放 duplex context。
- Worker 停止会停止 scheduler 并卸载所有模型上下文。
- simplex 和 duplex 会把输入画面/音频临时写为系统临时目录中的 BMP/WAV；正常完成或停止时会清理，异常崩溃时可能残留，应列入隐私和清理策略。

### 修改风险与验证

- 风险：**高**。
- 未经明确确认，不应修改模型文件名、目录布局、GGUF 格式、上游 revision、补丁或 Named Pipe 协议。
- 下载器逻辑可在 Mac 使用 mock 测试。
- 真实模型加载、Windows 原生采集、Named Pipe、CPU/CUDA fallback、显存和长时间运行不能由 Mac 测试证明，必须 Windows 实测；CUDA必须 NVIDIA。

## 10. 日志

### 相关文件

- `src/jarvis_backend/packaged_launcher.py`
- `start-real.ps1`
- `desktop/src/backend-manager.js`
- `desktop/src/ui/launcher.js`
- `src/jarvis_backend/orchestrator/service.py`
- `src/jarvis_backend/native/client.py`
- `native/src/worker.cpp`
- `native/src/omni_runtime.cpp`

### 当前日志路径

安装版：

- `%LOCALAPPDATA%\AIJarvis\runtime\native-worker.log`，追加写入 Worker stdout/stderr。
- launcher 的结构化启动进度通过 stdout 的 `JARVIS_PROGRESS <json>` 传给 Electron。
- Uvicorn/Python 日志主要进入进程输出，没有统一持久化文件。

源码真实模式：

- `.runtime/native-worker.out.log`
- `.runtime/native-worker.err.log`
- PowerShell 和后端输出进入启动进程控制台/Electron 进度流。

Electron 控制面只保留最近少量进度消息，不是持久日志系统。

### 当前缺口

- 没有统一跨进程 correlation/session ID。
- 没有日志轮转、大小上限或保留期。
- Python业务事件和原生日志没有统一格式。
- Electron收到 `worker.fatal` 后会进入错误状态并主动显示、聚焦控制面板；但跨进程日志关联、崩溃原因归档和自动恢复仍未实现。

### 修改风险与验证

- 风险：**中**。
- 格式化和脱敏逻辑可跨平台测试。
- 进程重定向、中文编码、安装目录权限和崩溃日志需 Windows 验证。

## 11. Windows 安装包

### 相关文件

- `desktop/package.json`
- `desktop/scripts/build.js`
- `desktop/scripts/prepare-release.ps1`
- `desktop/scripts/resource-fallback.js`
- `desktop/scripts/verify-installer.ps1`
- `.github/workflows/windows-installer.yml`
- `.github/workflows/windows-validate.yml`
- `src/jarvis_backend/packaged_launcher.py`
- `LICENSE`
- `THIRD_PARTY_NOTICES.md`
- `third_party/runtime/NOTICE.md`
- `third_party/runtime/LICENSE.llama.cpp-omni`

### 构建数据流

```text
npm run build
→ build.js 调用 prepare-release.ps1
→ 复制并应用固定 runtime patch
→ 构建静态 CPU Worker
→ 构建 CUDA Worker
→ 创建构建专用 Python venv
→ PyInstaller 冻结 packaged_launcher
→ 复制 CPU/CUDA Worker、参考音频和 CUDA DLL
→ 生成 runtime-manifest.json
→ jarvis-launcher.exe --self-test
→ electron-builder --win nsis:x64
→ AI-Jarvis-Setup-<version>-x64.exe
```

### 验证数据流

```text
verify:installer
→ 安装到临时目录
→ 清理 PATH 中 Python/构建工具
→ 运行冻结 runtime self-test
→ 启动安装后的 Electron
→ 可选 FullStartup：模型、Worker、FastAPI、环境模型、真实聊天
→ 可选 RequireCuda：强制检查 CUDA backend
→ 成功后静默卸载和清理临时目录
```

GitHub Actions分为两条用途不同的链路：

- `windows-installer.yml` 构建CPU/CUDA Worker、Python后端和NSIS安装包并上传EXE。
- `windows-validate.yml` 运行JavaScript/Python/Ruff、CPU Native测试，并编译正式CPU/CUDA Worker；它不生成安装包。当前强制游戏模式尚待该工作流实际运行验证。

### 许可证边界

- 项目源码使用 MIT LICENSE。
- 第三方 runtime、Electron、Python依赖和模型权重有独立声明或条款。
- 当前 `desktop/package.json` 明确复制项目 LICENSE 和 `THIRD_PARTY_NOTICES.md`；正式发布前还应核验最终安装目录是否包含所有需要保留的上游许可证文本和 notices。
- 模型权重不在仓库 MIT LICENSE 范围内。

### 修改风险与验证

- 风险：**高**。
- NSIS、冻结运行时、升级/卸载、CPU fallback 必须 Windows 验证。
- CUDA Worker、DLL完整性和 `RequireCuda` 必须 NVIDIA 实机验证。

## 12. 未来授权激活

### 当前状态

当前仓库没有许可证序列号、激活码、试用期、设备绑定、订阅或 entitlement 实现。代码中的 WASAPI `Activate` 是 COM 音频接口调用，与产品授权无关。

### 未来可能涉及的边界

- Electron 控制面：输入许可证、展示状态和错误。
- Electron 主进程：安全存储本地凭据或许可证缓存。
- 启动编排：在模型下载/加载前确定允许启动、降级或离线宽限。
- Python API：本机许可证状态查询，但不应把商业授权等同于现有可选 Bearer Token。
- 设备标识：需要明确隐私、稳定性、硬件变更和重装策略。
- 在线服务：激活、撤销、并发席位、离线签名或续期；当前均不存在。
- 安装包：许可证条款、隐私说明、升级兼容和安全更新。

### 建议数据流边界

```text
用户输入序列号
→ Electron 主进程校验格式
→ 在线激活或离线签名验证
→ safeStorage 保存最小必要凭据/缓存
→ 启动前许可证状态机
→ 允许启动、宽限、降级或阻止
→ 不修改模型文件、GGUF、C++推理运行时或 Named Pipe 协议
```

### 前置决策

实现前必须先确认：

- 在线还是离线激活；
- 是否设备绑定以及绑定强度；
- 试用期和宽限期；
- 永久授权还是订阅；
- 同一许可证允许的设备数量；
- 服务器不可达时的行为；
- 本地缓存、隐私、撤销和时钟回拨策略；
- 是否允许未激活用户下载约 6.32 GiB 模型。

### 修改风险与验证

- 风险：**高**。
- 授权应作为新的独立业务边界设计，不应通过修改 MiniCPM-o、CUDA、GGUF 或底层协议实现。
- 必须测试 Windows 安装、重装、升级、离线、系统时间变化、安全存储和服务故障；通常不需要 NVIDIA，但必须验证授权门禁不会破坏 CPU/CUDA启动路径。
