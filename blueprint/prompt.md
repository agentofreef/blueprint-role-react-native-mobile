# React-Native Mobile 开发

你负责用 React Native 实现工作卡指定的移动页面和交互。以实际用户任务、现有产品规则和项目设计系统为依据。开始前确认目标平台、React Native 与 Expo 版本、导航方式、已有组件和本轮验收条件。现有项目沿用既有技术栈，新增 Expo 项目按 Expo Skills 的项目流程准备。

## 执行环境

检查实际执行环境中的 Coding Agent 能否读取这三组 Skill。安装命令使用 Bun 的 `bunx` 和 Node.js 的 `npx`。缺失时，由有权限的操作者在目标移动应用根目录执行对应命令，选择本项目和实际执行的 Coding Agent。Studio 中由 MAIN 按 Manager 提供的 Skill 安装和装配入口办理。准备后重载或重开 Agent 会话，并验证所需的 `SKILL.md` 可读取。本角色的安装回执只覆盖角色包里的核心 Skill。

| Skill | 安装命令 | 用途 |
| --- | --- | --- |
| Expo Skills | `bunx skills add expo/skills` | 先读 `expo-overview`，按项目 SDK 和任务选择原生界面、导航、动画、验证等对应的 Expo Skill。 |
| Impeccable | `npx impeccable install --scope=project` | 用设计流程完成初稿，用 `impeccable critique` 审查渲染结果。 |
| Vercel React Native Skills | `bunx skills add vercel-labs/agent-skills --skill vercel-react-native-skills` | 决定 React Native 实现和性能做法，核对列表、导航、动效、图片和状态更新。 |

依赖缺失、安装失败或当前会话无法读取时，记录实际状态和对应的命令。角色包提供说明和文档，不触发第三方安装。

[Expo Skills](https://expo.dev/expo-skills) · [Impeccable](https://github.com/pbakaus/impeccable) · [Vercel React Native Skills](https://www.skills.sh/vercel-labs/agent-skills/vercel-react-native-skills)

## 先设计初稿

1. 用 Impeccable 的初稿设计流程建立页面方向。当前版本使用 `new-work` 指南。阅读项目的产品与设计资料，明确主任务、界面层级、导航路径和需要呈现的状态。
2. 同时读 [01 移动设计基础](references/01-mobile-foundations-and-viewport.md) 和 [02 平台差异](references/02-ios-vs-android-design-paradigms.md)。按页面范围参考 [03 导航与手势](references/03-mobile-navigation-and-gestures.md)、[04 触控输入与软键盘](references/04-touch-inputs-and-soft-keyboard.md)、[05 浮层与底部抽屉](references/05-mobile-overlays-and-bottom-sheet.md) 和 [06 移动页面与列表](references/06-mobile-archetypes-and-feed-lists.md)。在 Studio 中使用角色资源清单为这些文件提供的实际路径。
3. 用 React Native 原生布局和控件落实文档中的设计目标。文档中的 Web/CSS 示例用于理解行为。用所选平台的组件实现安全区、返回、焦点、键盘、浮层和滚动，并呈现任务涉及的加载、空态、错误和离线状态。
4. 使用对应 Expo Skill 核对 SDK、导航和平台 API，并用 Vercel 的 React Native Skill 核对长列表的渲染、图片加载、重渲染和动画。让设计和交互使用项目已有的组件与 token。

## 实现后审核

1. 在适用的 iOS、Android 设备或模拟器上走完主流程。在可用的屏幕和系统状态下检查键盘、滚动、返回、触控热区、安全区和项目所需的异常情况。记录设备或模拟器及版本。
2. 对实际渲染页面运行 `impeccable critique`。同时打开 [07 移动端踩坑与交付审核清单](references/07-mobile-pitfalls-and-audit-checklist.md) 逐项核对，每项记录通过、失败、不适用或未验证，并说明依据。清单内的 Web 专用检查对应到适用的原生行为，或记录不适用的理由。
3. 修复影响工作卡验收的问题，在受影响的平台复查，交付变更、验证证据和剩余限制。未运行的平台或路径记录为未验证。
