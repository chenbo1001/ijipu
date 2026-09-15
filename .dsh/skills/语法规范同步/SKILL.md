---
name: 语法规范同步
description: 修改 src/engine/parser（tokenizer/parser/errors）或 format 的 .jps 语法行为（描述头字段、Q/C 行、音符符号、标点、注释、分页等）后，同步更新 docs/SYNTAX.md（《脚本语法说明》——应用内帮助文档，也是 .jps 语法的唯一对外口径），并检查是否需要补充示例谱登记（samples/*.jps + src/samples/index.ts）与 smoke 断言。当用户说"更新语法文档""同步语法规范"、改了解析行为、或语法说明与实际解析不一致时使用。
whenToUse: 仅当本次改动涉及 parser/tokenizer/format 的语法行为（新增/删除/改变语法含义）时使用；纯布局/UI 调整不触发。
---

# 语法规范同步（.jps 语法 ↔ docs/SYNTAX.md）

## 目标

把 `src/engine/parser` 实际支持的 `.jps` 语法与 `docs/SYNTAX.md`（《脚本语法说明》）保持一致，
保证「帮助 → 脚本语法说明 = 解析行为」，并同步示例谱与 smoke 断言。

> adj422 起**只有一份**对外语法文档：`docs/SYNTAX.md`。
> 原先的 `docs/JPS-SPEC.md` 与 `public/doc/jps-spec.html`（帮助 → 脚本规则说明）已合并进它，
> 前者只留指向性占位、后者已删除——不要再往那两处写规则。

## 涉及文件

| 文件 | 角色 | 更新范围 |
|---|---|---|
| `src/engine/parser/tokenizer.ts` / `parser.ts` / `errors.ts` | 解析实现（只读，语法本身不在此改） | 无 |
| `docs/SYNTAX.md` | **唯一的 .jps 语法说明**（帮助菜单内展示；同时是入门手册与参考书） | 第一部分「五分钟上手」的递进示例、第二部分语法参考各表、第三部分组合示例集、第四部分报错表 |
| `samples/*.jps` + `src/samples/index.ts` | 示例谱 | 新增语法特性时补充示例谱并两处登记 |
| `scripts/smoke.mts` | 断言 | 新语法必须有断言；`[104]` 会自动校验 `docs/SYNTAX.md` 里所有 ```jps 示例 |
| `docs/ERRORS-LOG.md` | 错误日志 | 本次排错记录（E-年份-序号） |

## 步骤

1. 定位语法行为变更点：读 `tokenizer.ts` / `parser.ts` 的改动（新符号、标点归属、描述头字段规则…），提取**新行为的确切规则**
2. 在 `docs/SYNTAX.md` 对应位置更新：
   - **第二部分 语法参考**：该符号/字段所在的表格补一行或改一行（含边界说明：`-` 归谁、要不要空格、写在哪里）
   - **第一部分 五分钟上手**：若这是"新手会马上用到"的语法，在递进步骤里加一小段，并给**可整段粘贴**的 ```jps 示例
   - **第三部分 组合示例集**：必要时把新语法并进某个示例（示例要**完整可用**）
   - **第四部分 报错与排查**：新语法若带来易错点，补一行"现象 → 原因 → 正确写法"
3. 检查 `samples/` 是否有覆盖新语法的示例谱；没有则新增最小示例（`samples/*.jps` 原文 + `src/samples/index.ts` 登记 id/name/description/code）
4. 同步 `scripts/smoke.mts` 断言：新语法必须有断言覆盖；`docs/SYNTAX.md` 里的 ```jps 示例由 `[104]` 段自动逐段解析（要求**零错误零告警**），示例写错会直接失败
5. `npm run smoke` 全绿（基线失败数不变）、`npx tsc -b` 通过；必要时用无头 Chrome 打开「帮助 → 脚本语法说明」确认渲染正常（表格/代码块/引用块）

## 检查清单

- [ ] `docs/SYNTAX.md` 各相关章节与实际解析行为一致（新增/修改/删除均覆盖）
- [ ] 新增语法有**可整段粘贴**的 ```jps 示例（`[104]` 会解析它）
- [ ] 需要时补了示例谱（samples/ + src/samples/index.ts 两处同步）或 smoke 断言
- [ ] `npm run smoke` 失败项 == 基线
- [ ] 本次排错已在 docs/ERRORS-LOG.md 记录（E-年份-序号）
- [ ] 语法改动随代码一起提交 git，commit message 注明「语法同步」

## 常见问题

| 现象 | 原因 | 处理 |
|---|---|---|
| 文档与实现不一致 | 语法改动后漏同步 | 按本文档步骤补齐 `docs/SYNTAX.md` 与示例/断言 |
| `[104]` 报某示例有告警 | 示例用了旧写法（如裸写 `@乐器`） | 改成推荐写法；示例必须**零错误零告警** |
| 新增语法无示例谱 | 只改了 parser 没加样例 | 补最小示例谱 + 登记，或至少加 smoke 断言 |
| 原站谱子解析异常 | 兼容性回归 | 用 samples/ 原站风格谱回归 `npm run smoke` |

## 约束（AGENTS 五 / 十一）

- `.jps` 语法以 `docs/SYNTAX.md` 为准，兼容原「番茄简谱」语法（原站谱子可直接使用）
- 修改 parser/tokenizer 语法行为**必须**同步 `docs/SYNTAX.md`，禁止跳过；不要再往 `docs/JPS-SPEC.md` 写规则（它只是占位）
- 语法变更必须有 smoke 断言覆盖，保证「文档 = 实现 = 测试」三方一致
