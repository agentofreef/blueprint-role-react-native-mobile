# React-Native Mobile 开发

![React-Native Mobile 开发立绘](blueprint/images/portrait.png)

Blueprint Studio 的 React Native / Expo 开发角色。用 Impeccable 和移动设计参考做初稿，用 Expo 与 Vercel 的 React Native Skill 核对实现。页面完成后，在实际运行结果上执行 Impeccable Critique，并逐项检查参考文档 07。

- [安装命令与完整工作流程](blueprint/prompt.md)
- [移动设计参考 01–07](blueprint/references) · [交付审核清单 07](blueprint/references/07-mobile-pitfalls-and-audit-checklist.md)
- [角色清单](blueprint/manifest.json) · [发布版本](https://github.com/agentofreef/blueprint-role-react-native-mobile/releases)

## 在 Studio 中使用

打开「设置 → 角色 → 管理角色包 → GitHub 市场」，搜索 **React-Native Mobile 开发** 并安装。开始移动项目时按角色 Prompt 为实际执行的 Coding Agent 准备 Expo Skills、Impeccable 和 Vercel React Native Skills。

## 本地打包

```sh
node tools/pack-character.mjs --official blueprint dist
```

从版本标签对应的源码提交打包，在 GitHub Release 手动上传 `.blueprint` 附件，并记录 SHA-256。发布后核对附件与源码版本，再更新市场索引。

参考文档原样来自 Ludi 的 [mobile-design-system-skill](https://github.com/Ludi-Herry/mobile-design-system-skill/tree/33750d83c42f6f37e3ffbe1f61153c9c4d410cc0/references)。[许可](blueprint/LICENSE.txt) · [立绘来源](ARTWORK.md)
