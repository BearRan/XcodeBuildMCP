## simulator / device / macos（含 Catalyst）能力说明（中文）

这份文档补充说明 XcodeBuildMCP 在「iOS（simulator / device）」与「macOS / Catalyst」上的能力边界，以及为什么在当前 Cursor 集成下，`macos` 相关的 build/run 工具暂时不可直接使用。

### 1. simulator / device 与 Catalyst 的根本区别

- **simulator（iOS Simulator 工作流）**
  - 对应的 workflow id：`simulator`
  - 面向的是 **iOS 系列的模拟器**（iOS / iPadOS 等）。
  - 编译产物是 iOS App（使用 iOS SDK），运行在 `iOS Simulator` runtime 里。
  - 典型工具：
    - `build_run_sim`：一次性完成「编译 + 安装 + 启动」模拟器 App。
    - `build_sim`：只编译，不启动。
    - `launch_app_sim` / `launch_app_logs_sim`：单独负责启动已有的模拟器 App。

- **device（真机工作流）**
  - 对应的 workflow id：`device`
  - 面向的是 **物理设备**（iPhone / iPad / Apple Watch / Apple TV / Vision Pro 等）。
  - 编译产物同样是 iOS 家族的 App，部署到真机并通过 `idevicedebug` / `devicectl` 一类通道运行。
  - 典型工具：
    - `build_run_device`：一次性完成「编译 + 安装 + 启动」真机 App。
    - `launch_app_device`：针对已有安装好的 App 再次启动，并返回 PID 等信息。

- **macos（含 Mac Catalyst）**
  - 对应的 workflow id：`macos`
  - 面向的是 **运行在 macOS 上的 App**，包括：
    - 传统的 Cocoa App（AppKit 为主）。
    - **Mac Catalyst App**：由 iOS 工程通过 Catalyst 方式构建出的 macOS 目标。
  - 核心点：**Catalyst 是「跑在 macOS 上的 iOS 代码」，在 XcodeBuildMCP 里属于 `macos` 工作流的一部分**，而不是一个单独的 `catalyst` workflow。
  - 是否是 Catalyst，由 Xcode 工程的 scheme / target 配置决定；对 XcodeBuildMCP 来说，它只看到「这是一个 macOS 平台的构建与运行」。

### 2. 什么是 `build_macos` 和 `build_run_macos`

在 `macos` 工作流中，XcodeBuildMCP 暴露了两类关键工具（见 `docs/TOOLS.md`）：

- `build_macos`
  - 作用：**只负责编译 macOS App**（包括 Catalyst App）。
  - 对应 CLI：`macos build`
  - 内部使用 `xcodebuild` + `XcodePlatform.macOS` 做一次构建，不会主动启动应用。

- `build_run_macos`
  - 作用：**编译并启动 macOS App**。
  - 对应 CLI：`macos build-and-run`（MCP canonical 名为 `build_run_macos`）。
  - 典型流程：
    1. 调用 `xcodebuild` 完成 macOS 构建；
    2. 通过 `xcodebuild -showBuildSettings` 解析出 `BUILT_PRODUCTS_DIR` 和 `FULL_PRODUCT_NAME`；
    3. 通过 `open <AppPath>` 在当前 macOS 上启动 App（Catalyst 或普通 macOS App）。

如果 Xcode 工程的 scheme 是配置为 **Mac Catalyst 目标**，那么上述两个工具就会自然地对「Catalyst 版本」进行构建和运行。

### 3. 为什么当前 Cursor 集成下看不到 `build_macos` / `build_run_macos`

> 以下说明的是「当前 Cursor 集成」对这个仓库生成的 `project-0-...` MCP 实例的行为，并非 XcodeBuildMCP 本身的能力限制。

- 从 XcodeBuildMCP 自己的角度：
  - CLI 层面已经有完整的 `macos build` / `macos build-and-run` / 其他 `macos` 工具。
  - MCP server 也按照 manifests 把这些工具注册进了工具集合。

- 从 **Cursor 集成（`project-0-ShoppingStreets-XcodeBuildMCP`）** 的角度：
  - Cursor 在为某个具体工程生成 `mcps/project-0-...` 实例时，会根据内部策略挑选一部分 workflow/tools 暴露出来。
  - 目前这个工程里，Cursor 只暴露了：
    - `simulator` / `device` 工作流的构建运行工具；
    - `debugging`（LLDB attach / 断点 / 栈 / 变量 / LLDB 命令）；
    - `logging`（日志采集）等。
  - **`macos` 工作流下的构建/运行工具（`build_macos` / `build_run_macos` / `launch_mac_app` 等）目前没有被 Cursor 这一层导出到 `project-0-...` 实例中**，因此：
    - 在 `mcps/project-0-.../tools/` 目录里看不到 `build_run_macos.json`；
    - 在 Cursor 里通过 `call_mcp_tool("project-0-...", "build_run_macos", ...)` 会报 “Tool ... was not found”，即便 CLI 里已经存在这一能力。

### 4. 对当前工程的实际影响与使用建议

- **XcodeBuildMCP 本身是支持 Mac Catalyst 的**：  
  只要 scheme 配置为 Catalyst 目标，`macos build` / `macos build-and-run` 就可以在 CLI 或其他 MCP 客户端中正常使用。

- **在当前 Cursor 集成版本下**：
  - 运行阶段：
    - macOS/Catalyst App 仍建议通过 Xcode 或工程内脚本（如 `xcode_run_project.sh catalyst`）来启动；
  - 调试阶段：
    - 可以使用已暴露的 `debug_*` 工具族（`debug_attach_device` / `debug_breakpoint_add` / `debug_lldb_command` 等）对已运行的 macOS/Catalyst 进程进行 attach、下断点和执行 LLDB 命令；
    - 配合自定义 LLDB Python 模块（例如本工程中的 `auto_breakpoints.py`），可以实现「自动下断点 + 自动 `po self` + 写入日志 + 控制是否自动 continue」等高级调试行为。

- 一旦未来 Cursor 在 `project-0-...` 实例里正式暴露 `macos` 工作流的 build/run 工具，现有的 `build_macos` / `build_run_macos` 能力即可直接在 Cursor 中被调用，无需再修改 XcodeBuildMCP 源码。

