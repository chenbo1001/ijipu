# .jps 脚本语法规范（已并入《脚本语法说明》）

> **本文件的内容已经合并到 [`docs/SYNTAX.md`](./SYNTAX.md)（帮助菜单里的「脚本语法说明」）。**
>
> 合并原因（adj422）：`docs/SYNTAX.md`（应用内「脚本语法」）与 `public/doc/jps-spec.html`
> （帮助 → 「脚本规则说明」）内容高度重叠，加上本文件是第三份，三处各改各的很容易漂移
> ——用户也反馈"两份文档不知道看哪个"。现在**只有一份对外口径**：`docs/SYNTAX.md`，
> 它同时承担「零基础入门手册」与「语法参考书」两种读法，并且其中的组合示例由
> `npm run smoke` 的 `[104]` 段逐段解析（零错误零告警）保证不会腐烂。
>
> 因此：
> - 改 `.jps` 语法行为（parser/tokenizer/format）时，**同步 `docs/SYNTAX.md`**，不要再改本文件；
> - 本文件保留为**指向性占位**，仅为兼容历史链接与项目内引用（AGENTS.md / skills / ROADMAP 等）；
> - 更偏实现细节的备忘见 `docs/SPACE-LAYOUT.md`（布局几何）、`docs/SOUNDBANKS-SPEC.md`（音色库）。
>
> 历史内容（V1.0 逆向整理、逐条语义说明）见 git 历史：`git show v0.17.2:ijipu/docs/JPS-SPEC.md`。
