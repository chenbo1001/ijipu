---
name: 语法规范同步
description: 修改 src/engine/parser（tokenizer/parser/errors）或 format 的 .jps 语法行为（描述头字段、Q/C 行、音符符号、标点、注释、分页等）后，同步更新 docs/JPS-SPEC.md 语法规范，并检查是否需要同步 docs/README.md 功能清单与新增示例谱登记（samples/*.jps + src/samples/index.ts）。当用户说"更新语法文档""同步语法规范"、改了解析行为、或 .jps 语法速查与实际解析不一致时使用。
whenToUse: 仅当本次改动涉及 parser/tokenizer/format 的语法行为（新增/删除/改变语法含义）时使用；纯布局/UI 调整不触发。
---

# 语法规范同步（.jps 语法 ↔ docs/JPS-SPEC.md）

## 目标

把 `src/engine/parser` 实际支持的 `.jps` 语法与 `docs/JPS-SPEC.md` 文档保持一致，保证「语法速查 = 解析行为」，并同步示例谱与功能清单。

## 涉及文件

| 文件 | 角色 | 更新范围 |
|---|---|---|
| `src/engine/parser/tokenizer.ts` / `parser.ts` / `errors.ts` | 解析实现（只读，语法本身不在此改） | 无 |
| `docs/JPS-SPEC.md` | .jps 语法规范（数据源文档） | 描述头/主体行/音符符号/标点/分页/注释各节 |
| `docs/README.md` | 项目说明与功能清单 | 语法相关功能勾选/描述（如变更影响） |
| `samples/*.jps` + `src/samples/index.ts` | 示例谱 | 新增语法特性时补充示例谱并登记 |
| `docs/ERRORS-LOG.md` | 错误日志 | 本次排错记录（E-年份-序号） |

## 步骤

1. 定位语法行为变更点：读取 `tokenizer.ts` / `parser.ts` 的改动（如新增符号、改变标点归属、描述头字段规则），提取新行为的确切规则
2. 对照 `docs/JPS-SPEC.md` 现有章节（文件结构 / 描述头 / 主体行 / 音符与符号 / 标点 / 分页 / 注释）逐节核对：
   - 新增语法 → 在对应章节补充条目与示例（含边界说明）
   - 行为改变 → 修改原条目描述与示例，注明旧行为 → 新行为
   - 删除语法 → 移除或标注废弃，避免误导
3. 检查 `samples/` 是否有覆盖新语法的示例谱；没有则新增一个最小示例（`samples/*.jps` 原文 + `src/samples/index.ts` 登记 id/name/description/code）
4. 语法相关功能在 `docs/README.md` 功能清单中勾选/补充（若 README 有对应条目）
5. 同步 `scripts/smoke.mts` 断言：新语法必须有 smoke 断言覆盖（`npm run smoke` 全绿），保证文档与实现一致且可回归

## 检查清单

- [ ] JPS-SPEC.md 各相关章节与实际解析行为一致（新增/修改/删除均覆盖）
- [ ] 新语法有示例谱（samples/ + src/samples/index.ts 两处同步）或有 smoke 断言覆盖
- [ ] `npm run smoke` 全绿
- [ ] 本次排错已在 docs/ERRORS-LOG.md 记录（E-年份-序号）
- [ ] 语法改动随代码一起提交 git，commit message 注明「语法同步」

## 常见问题

| 现象 | 原因 | 处理 |
|---|---|---|
| 文档与实现不一致 | 语法改动后漏同步 | 按本文档步骤补齐 JPS-SPEC.md 与示例/断言 |
| 新增语法无示例谱 | 只改了 parser 没加样例 | 补充最小示例谱 + 登记，或至少加 smoke 断言 |
| 原站谱子解析异常 | 兼容性回归 | 用 samples/ 原站风格谱回归 `npm run smoke` |

## 约束（AGENTS 六 / 十一）

- `.jps` 语法以 docs/JPS-SPEC.md 为准，兼容原「番茄简谱」语法（原站谱子可直接使用）
- 修改 parser/tokenizer 语法行为**必须**同步 JPS-SPEC.md，禁止跳过
- 语法变更必须有 smoke 断言覆盖，保证「文档 = 实现 = 测试」三方一致
