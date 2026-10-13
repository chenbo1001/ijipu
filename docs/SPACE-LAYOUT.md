# 空间优先布局计算规则（adj283 ~ adj318）

> 适用：`packages/ijipu-engine/src/engine/layout/index.ts`，`useSpace = config.noteSpaceLayout === 'space'` 路径
> 默认 `noteSpaceLayout: 'space'`（见 `defaultPageConfig`），时值优先仍保留为备选
> 本文是「计算规则」备忘：核心常量、口分配、口约束、口差异、口已知问题。实施细节看代码注释 + ERRORS-LOG

---

## 一、单声部 `placeMusicRowSpace`（行内布局）

### 1.1 计算阶段（行级）

`noteList[]`：收集所有带时值元素的元数据（`noteDur / augDur / dotDur / noteBodyW / dotBodyW / accW / leftExt / hasHx`）

```
totalDur   = Σ (noteElDur + augCount×augDur)           # 总时值拍数
durBodySum = Σ (noteBodyW + hasDot×dotBodyW + augCount×augBodyW)   # 本体宽（不含独立标记）
nonDurPad  = Σ_barline (barlineTotalW + bp×2)  +  Σ_标记 markBodyW(code)
           # adj375/adj376：独立标记 = &zkh/&ykh 括号 + &hx 呼吸记号，统一用基本占宽 bracketBodyW(=BRACKET_PAD)
           # （&hx 的"占时值"是演奏概念，不影响排版宽度）
           # 旧写法「&hx 依附音符」(hasHx/hxW) 已废弃（tokenizer 不再产生该 symbols）
           # bp = barlinePad(noteSize) = noteSize/4  ←  单声部线两侧净间距
W          = max(0, availW − durBodySum − nonDurPad)    # 可拉伸空白

# 每音符「实际时值宽」noteElW = 本体 + 拉伸分摊（W 按总时值比分）
noteElW    = noteBodyW + (hasDot ? dotBodyW : 0) + (noteElDur/totalDur) · W
perPerBeatW = noteElDur>0 ? noteElW/noteElDur : 0      # 拍宽（供小节线间距自适应收紧）
```

`gapL / gapR`：小节线两侧净间距（adj315）—— 行首 / 行末背对音面那一侧 = 0，中间 = `barlinePad`。

### 1.1b 整份谱只有一行：按 `align_min_bars` 个小节槽预分占宽（adj421，用户规则）

> 场景：**整份谱只有一行**（新建文件、示例谱那种一行就写完的曲子）。此前这类行按「自然宽」排布，
> 内容挤在左侧、行尾一大片空白（1 小节的 `Q: 1 2 3 4 |` 只占约 1/4 行宽里的一小段）。
> 用户规则：**小节数 < `align_min_bars`（默认 4）时，把整行占宽按 `align_min_bars` 个小节预分**。
>
> ⚠ **adj935 起生效范围 = 「整份谱只有一行」**（`rows.length === 1` **且**整份谱只有一个排版单元）：
> 用户裁定「**除了整份谱的最后一行，其它行一律撑满（两端对齐）**」⇒ **多行谱里"某段只有一行"**
> 不再算末行、**不再预分槽**，那一行一律撑满（实测：旧口径给它 417.70，新口径 544.80）。
> `adj925` 时那条「单行曲部本身就是末行」已删除（整份谱只有一行时它天然就是最后一行）。
> 本条的开关 `singleRowOfScore && !stretch` 里，`!stretch` 现在蕴含"这一行就是末行"。

```
slotOuter = availW / align_min_bars                     # 一个小节槽宽（默认 = 行内容宽 / 4）
每小节 b： natOuter[b] = segNatW[b] + barOuter[b]        # 本体宽 + 该小节小节线占位（lineW + bp + max(bp, meterGap)）
          extraWByBar[b] = max(0, slotOuter − natOuter[b])   # 槽内富余 → 按该小节各时值元素**时值比例**摊开
                                                            # 本体宽 + 小节线占位 > 槽宽 → extra = 0（保持自然宽、允许越出槽）
```

- **适用条件**：**整份谱只有一行**（`rows.length === 1 && unitCount === 1`）且 `barCount < align_min_bars`；
  行首空小节（多声部填充）不参与。**多行谱不适用**——末行仍按 adj199/adj940「对齐前面行」的规则（见 §1.1c）；
  adj935 起：**多行谱里除"整份谱最后一行"以外的行一律撑满**（`align_min_bars` 只对末行生效）。
- **效果**：N(<4) 小节的单行谱，每小节占 `1/align_min_bars` 行宽、行尾留 `(align_min_bars − N)` 个槽的空白；
  单行 1 小节的每小节几何与「4 小节铺满行」里的一个小节**完全一致**（槽宽相同）。
- **时值优先路径**（`placeMusicRow`）同规则：按小节把该小节的 `perBeats` 整体等比放大到槽内容宽
  （`scale = (slotInner − 拍间距) / 本体宽`），本体超槽时不缩放。
- 断言：`scripts/smoke.mts` `[106]`（两种布局各 8 条）+ `adj935 ③`（整份谱单行 3 小节 ⇒ 末线 ≈ 左边距 + 3 槽，
  实测空间优先 `417.70` / 时值优先 `432.00`；整份谱单行 4 小节 ⇒ 撑满 `544.80`）+ 负对照（"整份谱只有一行就该撑满"是错的）。

### 1.1c 自然宽行（末行）「按小节序号对齐上一行」——基准 = 上一行的小节线**实位**（adj940，用户裁定）

> **默认行为、不依赖任何 `# jps-config` 键**：整份谱的**最后一行**只要小节数 < `align_min_bars`
> （默认 4）就走这条对齐——与**上一行的小节线**逐根对齐。
>
> 用户裁定（2026-10）：这条对齐原来（`adj355`）的基准是"上一行各小节的**内容宽**"，
> 只能保证"每小节内容不窄于上一行"；而**线落在哪**还取决于「内容右端 → 线中心」的偏移
> （`gapL + 线半宽`）——上一行末小节是 `|`（线组宽 1）、本行末小节是 `:|`（线组宽 7.6）时
> 这条偏移差 **3.3px**，逐根累积 ⇒ 用户看到的"末行没对上"（实测残差 `+3.3 / −3.4 / −5.2px`）。
> 多声部那一侧 `adj644` 早就是"记下**实际**偏移"，本口径把单声部两条路径也换成同一办法。

```
上一行的每根小节线**实测 x**（未取整原值）→ prevRowLineX[]     # 跨组、跨页都不清空
本行逐小节（空间优先）：
  cursor = margin_left
  for b in 行内小节:
    off   = gapL(b) + barlineTotalW(type_b)/2           # 本小节自己的"内容右端 → 线中心"
    outer = gapL(b) + barlineTotalW(type_b) + gapR(b)   # 本小节线组完整占位（无临时拍号时 gapR = bp）
    nat   = segNatW[b] + 非时值占位[b]                   # 本小节自然推进量（&hx / 大括号预留 / 行内括号）
    aim   = (b 是末小节) ? min(ref[b], 页内容右界 − 线半宽) : ref[b]   # 末根线贴右内容界
    adv   = max(nat, aim − cursor − off)                # **只能加宽**（空间优先的自然宽 = 墨迹本体之和）
    extraWByBar[b] = adv − nat
    cursor += adv + outer
  越界闸门：cursor 超出行可用宽 ⇒ **整体放弃对齐**、退回自然宽（对齐是"尽量"、越界是硬约束）
```

- **三条一起成立才算对齐**：① 前 `k−1` 根小节线**精确重合**（≤0.05px）；② **末根线贴右内容界**
  （末根线组更宽时按**半个线宽差**让位——实测 `||`(4) 对 `|`(1) ⇒ 1.5px）；③ **逐小节宽 ≥ 上一行
  对应小节**（末根同样容②那半个线宽差）。
- **时值优先**同口径（`placeMusicRow`）：`line_b = x_b + BAR_PAD + w_b + barSpace_b/2 + E_b×NOTE_GAP`
  反解 `w_b`，多出的宽按"该拍在本小节的重叠量²"归一摊进 `perBeats`（整拍小节退化成按时值比例）。
  **这一路允许压缩**（它的自然每拍宽里带 `BPW_NATURAL`/`minNoteW` 的间距下限，旧 `adj199` 一直就是
  压着对齐的），压缩地板取该拍的**墨迹最小需求** `minNoteW/minDur`；空间优先那一路只加宽
  （自然宽 = 墨迹本体之和，压下去音符本体就会重叠）。
- **`adj211` 的豁免已删除**：旧口径「行末以 `||`（终止线）结束且 ≤3 小节 ⇒ 不参与对齐」与本条冲突
  （用户看到的"没对上"里就有一条是它造的）⇒ 现在**与行末是什么线无关**。
- **`align_min_bars` 的职责只有一件**：管"末行**撑不撑满**"（≥ 阈值 ⇒ 两端对齐撑满；< 阈值 ⇒ 自然宽
  + 本条对齐）。它**不管"对齐"**——对齐是默认行为。
- **实测**（空配置、用户谱 `壁上观.jps`，只读）：上一行 `218.50 / 398.60 / 544.80`；末行对齐后
  `218.50 / 398.60 / 543.30`（前两根 0px 重合；末根贴右内容界、差 1.5px = 半个线宽差）；
  逐小节宽 `168.50 / 180.10 / 144.70`（上一行 `168.50 / 180.10 / 146.20`）。
- **断言**：`scripts/smoke.mts` `[68f]`（15 条：空间优先 / 时值优先 / 多声部照旧 / 跨页，各带负对照）
  + `adj211`（`||` 与 `|` 两种结尾都逐根对上）+ `adj935 ②`（"自然"的判据从"行尾留白"改成"与上一行逐根重合"）。

### 1.2 放置（`curX = margin_left` 起）

每音符（adj285）：

```
# 段左 blockX（带附点时与附点三段留空分散；无附点音符块内容居中）
if (hasDot) {
  g      = max(0, (noteElW − noteBodyW − dotBodyW) / 3)
  blockX = curX + g
  dotCX  = curX + g + noteBodyW + g + dotBodyW/2       # 附点圆心，两侧各留 g
}
else {
  blockX = curX + max(0, (noteElW − noteBodyW) / 2)
}

# segments
[{ x: blockX,  el: 'note', ...}]
[{ x: dotCX,   el: 'dot', ...}]                       # 附点
# 增时线（el: 'aug'）逐根推 xCursor += augElW

# 数字 x = blockX + accW + leftExt                     # adj314：数字右移给角标/前倚音腾位
curX = xCursor + (独立标记按源码插位各自加宽，adj375: &hx/&zkh/&ykh 同通道)
```

小节线：

```
lineX = curX + gapL + barHalf                          # 中间小节线
if (atEnd) lineX = pageW − margin_right − barlineTotalW(bk.type)/2   # adj315 行末线贴右
curX += gapL + barlineTotalW(bk.type) + gapR
```

---

## 二、多声部 `placeVoiceBlock`（块级布局）

### 2.1 块级参数

```
blockStartX = margin_left + blockPad    # blockPad = labelPad+14（声部标签占位）
blockAvailW = availW − blockPad
numBars     = max(声部小节数)
barBeats[b] = ceil(max(声部 segBeats))   # adj250 各小节整数拍（向上取整）
totalBeats  = Σ barBeats
gapSpaces   = [barlinePad × (numBars−1)]
```

### 2.2 space 路径的 ⑥ 计算（adj316 / 317a-c / 318）

#### ① `bodyW[声部][b]`：每声部每小节带时值元素本体宽之和

```
bodyW0 = noteBodyW + accW + (dots ? dotBodyW : 0) + augCount·augBodyW
bodyW[声部][b] = Σ 声部 b 小节 bodyW0
```

#### ② `baseW[b]`：小节基准本体宽 = max(各声部 `bodyW[声部][b]`)

#### ③ `nonDurPad`（仅单声部路径在用）

单声部：`nonDurPad = pads + 独立标记（&zkh/&ykh 括号 + &hx 呼吸记号，adj375）`。
多声部块**不使用它**——标记改成拍级插位（见 ③b），`&hx` 的"占时值"是演奏概念，与排版宽度无关。

#### ③b `beatBodyW[b][k]`：每小节每拍最大本体占宽（跨声部取 max）

```
# adj479：拍宽 = 拍首前置占位(块级) + max(各声部 本体宽 + 拍中标记宽)
leadPad[abs] = max_p voiceLead[p][abs]        # 拍首标记（&zkh/&ykh/&hx 写在拍首）宽度之和
for each 声部 p:
  voiceBeats[k] = 0 (k = 0..bb−1)
  for each token t in p.segs[b]:
    if 带时值元素:
      headW  = noteBodyW + accW + (dots?dotBodyW:0) + slideExtraW(&shy/&xhy 墨迹)
      dur    = tokenDuration(t)
      # ★ adj316：拍区间半开 [startBeat, endBeat)，endBeat 用 ceil（跨拍/半拍正确）
      startBeat = floor(beatAcc + 1e−9)
      endBeat   = min(bb, ceil(beatAcc + dur − 1e−9))
      nSpan     = max(1, endBeat − startBeat)
      # ★ adj479：**逐拍归位**——本体宽记在真正画出它的那一拍（不再"总宽 ÷ 覆盖拍数"平摊）
      for i, k in [startBeat, endBeat):
        w = (i==0 ? headW : (i<=augCount ? augBodyW : 0)) + (i==nSpan−1 ? grTailW : 0)
        voiceBeats[k] += w
      beatAcc += dur
    if (bracket):
      拍首(frac≈0) → voiceLead[p][abs] += markBodyW   # 前置占位
      拍中(frac>0) → voiceBeats[k] += markBodyW        # 并进本体宽
  for k: perBeatMax[k] = max(perBeatMax[k], voiceBeats[k])    # 跨声部取最大
  beatBodyW[b][k] = perBeatMax[k] + leadPad[barStartBeat[b]+k]
```

#### ⑥ 段宽 = `beatBodyW[b][k]`（本体实际宽，不再拉伸段宽）

```
baseBarSum = Σ_b [Σ_k beatBodyW[b][k] + (barBeats[b]>0 ? (barBeats[b]−1)·NOTE_GAP : 0)]
totalSlots = totalBeats + numBars − 1
# ★ adj318：numBars < config.align_min_bars → 自然宽（不撑满、不钳制）
# ★ adj925（用户裁定）：**只有末行才看阈值** —— 非末行一律撑满；
#   isLastBlock = 本块就是整份谱最后一行（多声部一块即一行，块内不折行）
stretchBars = !isLastBlock || numBars >= config.align_min_bars
# ★ adj317c：末线钳制到 rightLimit − halfBarW（与单声部 atEnd 一致）
sumGapSpaces = gapSpaces.reduce((a, s) => a + s, 0)
halfBarW    = barlineTotalW('|') / 2
targetEndBarX = pageW − margin_right − halfBarW
targetBarSum  = stretchBars ? max(0, targetEndBarX − blockStartX − sumGapSpaces − BAR_PAD) : 0
avStretch  = stretchBars ? max(0, targetBarSum − baseBarSum) : 0
s          = totalSlots>0 ? avStretch/totalSlots : 0

for each b in 0..numBars−1:
  rel = (b==0) ? 0 : s         # ★ adj317a 首小节节头 = 0（行首贴左）
  for k in 0..barBeats[b]−1:
    idx = barStartBeat[b] + k
    wb  = beatBodyW[b][k]>0 ? beatBodyW[b][k] : BPW_NATURAL
    outPerBeat[idx] = wb
    mspSegX[idx]    = rel
    rel += wb + NOTE_GAP + s
  rel -= NOTE_GAP               # ★ adj317a 末拍后净间隙 = s（去 NOTE_GAP，对称）
  mspBarRelW[b] = rel
```

### 2.3 放置（`x` 推进 + 每音符段 x + `placeNoteAt`）

```
x = blockStartX
for each b:
  for each 声部 p:
    beatCursor = Map(拍 → 本体右缘)      # ★ adj479 拍内本体游标（相对拍内容起点）
    for each token t in p.segs[b]:
      if (note/rest/rhythm):
        dur = tokenDuration(t); beatAcc = 0; pos = beatAcc; rem = dur
        while rem>0:
          pp = round/floor(pos)
          blockBeat = barStartB + pp
          perBeat   = bodyPerBeat[blockBeat]                # = perBeats[blockBeat] − leadPad
          off       = max(beatCursor[blockBeat], (pos−pp)·perBeat)   # ★ adj479
          piece     = min(rem, ..)
          x: x + BAR_PAD + (useSpace ? mspSegX : beatStartX差分) + leadPad[blockBeat] + off
          beatCursor[blockBeat] = off + beatBodyOfNote(i)   # 逐拍本体宽（同 ③b）
        placeNoteAt(t, segments, ..., space)
      if (bracket):                     # ★ adj479 多声部块内独立标记的绘制（此前完全缺失）
        拍首 → cx = 拍起点 + leadCursor + w/2，leadCursor += w
        拍中 → right = max(beatCursor, frac·bodyPerBeat)，cx = 内容起点 + right − w/2
        page.brackets.push({ code, dir, x: cx, yTop: 行顶 + 0.7×字号, width: w })
  x += (useSpace ? mspBarRelW[b] : beatStartX差分) + (b<numBars−1 ? gapSpaces[b] : 0)
```

`placeNoteAt(t, segments, ..., space?)`**（adj317 修复）：

```
if (space) {
  nx          = first.x                                       # ★ adj314 锚段起点
  noteW       = space.noteBodyW                              # 含 accW（角标占位在 noteW 内）
  noteRightX  = first.x + space.noteBodyW
  # ★ adj317 附点：显式 push el='dot' 段，避免渲染回退公式 seg0.x+mainDur·perBeat 在 perBeat<本体宽时落在数字内
  if (space.hasDot) {
    dotGap   = noteSize·*0.2                                 # ★ 待规范化入 spacing.ts（adj317）
    dotCX    = first.x + space.noteBodyW + dotGap + space.dotBodyW/2
    segments.push({ x: r1(dotCX), perBeat: r1(space.dotBodyW/0.5), beats: 0.5, el: 'dot' })
  }
}
```

### 2.4 小节线

```
lineX0_b = xBar + BAR_PAD + mspBarRelW[b] + barToNextGap/2
#   末小节 barToNextGap = 0（gapSpaces 只有 numBars−1 项）；非末 = gapSpaces[b]
barX[b   = r1(min(max(lineX0_b, margin_left+halfW), pageW−margin_right−halfW))
xBar += mspBarRelW[b] + (b<numBars−1 ? gapSpaces[b] : 0)
```

`lineX0_末 = blockStartX + ΣmspBarRelW + sumGapSpaces + BAR`，`ΣmspBarRelW = baseBarSum + (totalSlots)·s`。
`stretchBars=true` 时 `s = (targetBarSum − baseBarSum)/totalSlots`，`ΣmspBarRelW = targetBarSum`，
`lineX0_末 = targetEndBarX = pageW − margin_right − halfBarW`（命中钳制上界）。`stretchBars=false` 时 `s=0`，
`ΣmspBarRelW = baseBarSum`，`lineX0_末 < rightEdge − halfW`（自然宽，留白）。

---

## 三、单声部 vs 多声部 space 差异表

| 维度 | 单声部 | 多声部 |
|---|---|---|
| 每拍宽 | `noteBodyW + (dur/totalDur)·W`（按总时值比例） | `beatBodyW[b][k]`（跨声部 max + 跨拍均分） |
| 拉伸分配 | `noteElDur/totalDur × W`（按总时值） | `avStretch = (targetBarSum − baseBarSum)`（按末线钳制反推，stretchBars 才生效） |
| 数字 x | `blockX + accW + leftExt`（**右移腾位**） | `first.x`（**锚段起点**，accW 在 noteW 内） |
| 附点段 | `dotCX = curX + g + noteBodyW + g + dotBodyW/2`（动态 g） | `first.x + noteBodyW + dotGap + dotBodyW/2`（adj317 修复） |
| 行末线 | `atEnd && stretch` 钳制 `pageW − margin_right − halfW`；否则自然（adj354，stretch=false 行尾留白） | lineX0 自然值（依赖 mspBarRelW）；stretchBars=true 时末线贴右 |
| 段间隙 | 拍后 `(noteElDur/totalDur)·W`（按 W 自然均分） | 拍后 `NOTE_GAP + s`（固定 + 均匀拉伸） |
| 行内撑满阈值 | adj925 起：**非末行恒撑满**；末行 `barCount >= config.align_min_bars`（默认 4）才撑满（`W = stretch ? 剩余宽 : 0`）。adj935 起"末行"= **整份谱最后一行**（不再把"本曲部只有一行"算末行；那一档只决定 `adj421` 预分槽，且需整份谱只有一个排版单元） | adj925 起：**非末行（非最后一块）恒撑满**；末块 `numBars >= config.align_min_bars` 才撑满（`avStretch` 分叉）。adj935 核过：多声部"一块即一行"，那处本来就没有"单行曲部"这一条 |

---

## 四、常量速查

```
BAR_PAD      = 6                            # 块起始内边距
NOTE_GAP     = 4                            # 拍间固定间距
BPW_NATURAL  = ?                            # beat width natural（自然拍宽下限）
barlinePad   = noteSize/4                   # 单声部线两侧净间距
barlineTotalW(type)                          # 线自身宽（'|'=1.1 / '||'=2.2 等）
halfBarW     = barlineTotalW('|')/2 = 0.55   # 钳制函数用（小线半宽）
```

---

## 五、已知问题 / 待清理

> 每条标 `[设计]`（有意选择）/ `[已知问题]`（确认的偏差或边界）/ `[待清理]`（计划修复）

### 5.1 `[设计]` 多声部数字不右移（`accW` / `leftExt`）——确认不右移

**取舍**：多声部 `nx = first.x`（锚段起点，adj314），`accW` 在 `noteW`（= `space.noteBodyW`）内；单声部 `nx = blockX + accW + leftExt`（数字右移腾位）。

**原因**：多声部**各声部同拍对齐**（`adj314` 注释"多声部各声部同拍时值段长短不一 → 数字视觉错位，故多声部统一数字=段起点"）。若 `nx` 加 `accW`，则同拍变音音符 x 与非变音音符 x 不同 → 破坏"同拍对齐"断言 `[62]`（容差 <0.6）；同时多声部声部标签占位（`blockPad`）已为变音预留横向空间。

**实例**（`V:1.0 P:4/4 / Q1: 1 2# 3 |`、`noteSpaceLayout:'space'`）：
```
Q1 第 2 音 2#（变音）：
  seg0.x  = first.x = 60.0
  nx      = first.x = 60.0          ← 不加 accW
  noteW   = noteBodyW(13) + accW = 8.06 + 1.0 ≈ 9.06
noteRightX = 60.0 + 9.06 = 69.06
```
- 数字左缘 = 60.0（与首音符 1 同拍 x 一致）
- 变音角标 ♯ 画在 `noteRightX − noteBodyW = 61.0`（数字左方）

**关联**：`[63]` 断言要求 `nx > segX`（数字右移腾位），与本设计直接矛盾——断言靠 `r1` 跨 `.5` 浮点巧合通过。

### 5.2 `[设计]` 多声部拍宽"跨声部 max + 跨拍均分"（按拍基本宽 + 时值比率分摊）

**设计意图**（按用户重述）：先按**该拍各声部最大本体占宽**作该拍基本宽（保证同拍基本不窄，跨声部音符不挤一起），再以**时值比率**把剩余空白分摊给各拍（达到占宽与时值尽可能接近、保证一行能放置更多音符）。

**计算**（③b 节）：
```
voiceBeats[k] = 0 (k = 0..bb−1)
for each token t in p.segs[b]:
  bodyW0 = noteBodyW + accW + (dots?dotBodyW:0) + augCount·augBodyW
  startBeat = floor(beatAcc)
  endBeat   = ceil(beatAcc + dur)         # 半开 [startBeat, endBeat)（adj316）
  nSpan     = max(1, endBeat − startBeat)
  perPiece  = bodyW0 / nSpan              # 跨拍均分本体宽
  for k in [startBeat, endBeat): voiceBeats[k] += perPiece
perBeatMax[k] = max_声部 voiceBeats[k]    # 跨声部取 max（基本宽）
```

**实例**（3 声部小节 `1 2# 3` / `1// 2#/` / `3`）：
```
声部1 (Q1): 1(整) 2#(整+acc) 3(整)
  voiceBeats[0]=bodyW0(1)=8.06, [1]=bodyW0(2#)=9.06, [2]=bodyW0(3)=8.06
声部2 (Q2): (空)
  voiceBeats = [0, 0, 0]
声部3 (Q3): 1//(半拍+减时线) 2#/(半拍+acc+减时线) 3(整)
  voiceBeats[0]=halfW1, [1]=halfW2, [2]=bodyW0(3)=8.06
perBeatMax = [max(8.06, halfW1), max(9.06, halfW2), 8.06]   ≈ [8.06, 9.06, 8.06]
```
- 拍0/拍2 各声部对齐（`max`=8.06）
- 拍1 变音 `2#`（Q1）撑宽到 9.06，决定该拍基本宽（Q2/Q3 自动跟着）
- 行内 `s`（拉伸）按 `ΣperBeat` vs `blockAvailW` 算后分摊到 `mspSegX`/`mspBarRelW`

**关联**：跨拍音符（`bodyW0` 均分到 `nSpan` 拍）所在拍段宽 < 本体宽——`smoke [62]` 同拍对齐断言靠 `r1` 容差 <0.6 通过。

### 5.3 `[撤销/不实施]` 多声部块不自动断行——超宽内容由谱师编排平衡

**单声部**：`breakRowsSpace(segs, availW, noteSize)`（`index.ts:456`）按小节累计本体 + `barlineSpace` 超 `availW − BAR×2` 时换行。

**多声部**：**没有 `breakVoiceBlock`**——整个多声部块一次性 `placeVoiceBlock`，不论小节数多少都单行渲染。

**不实施断行的原因**（2026 决策）：多声部行是「多声部同步编排」（同一拍多声部对齐），**一旦换行，第二声部看上去像「新一组二声部块」，破坏多声部视觉与语义**。这是编排层面的事——**超宽是谱师需要平衡的（删内容/缩字号/改行/调时值）**，不是引擎自动能解决的事。

**当前行为**：
- `ΣbaseBarSum ≤ blockAvailW − nonDurPad`：自然宽或撑满（adj925 起：**非最后一块恒撑满**，末块才按 `align_min_bars` 判定），末线按 `adj317c`/`adj318` 钳制
- `ΣbaseBarSum > blockAvailW − nonDurPad`（**内容物理已超**）：
  - `stretchBars=true`：末线钳到 `rightLimit − halfW`，但**音符仍溢出右 margin**（5.7 详述）
  - `stretchBars=false`：`s=0`、`lineX末 = blockStartX + baseBarSum + sumGapSpaces + BAR`，**可能超出右 margin**
- **不做任何强制**：留给谱师处理

**用户原话**："多声部块超过问题的小节就换行 这个规则实则不能应用...一旦换行就会两声部变四声部的感觉，不好，这个规则不要，超就超，这是需要谱师需要对谱的编排进行平衡考虑的事"

### 5.4 `[撤销/不实施]` `align_min_bars` 不触发多声部断行

配合 5.3（**不实施断行**），`align_min_bars` 只在 `s`/`avStretch` 分叉处生效——**不**触发块级断行。
adj925 起该阈值**只对末块生效**（非末块恒撑满）；`align_min_bars=100` 等极端值只让**末块**永远不撑满，
**不会让超宽内容自动换行**。

### 5.5 `[设计]` `mspSegX` 数组索引范围正确（不是"末拍+ 实际未用"）

**实测**：
- `mspSegX` 初始化 `new Array(totalBeats).fill(0)`（`index.ts:1712`），索引 `[0, totalBeats)` ✓
- 循环 `k=0..barBeats[b]−1` 设 `mspSegX[barStartBeat[b]+k]`，所有 `b` 累计覆盖 `[0, totalBeats)` ✓
- 放置循环 `mspSegX[blockBeat]`，`blockBeat = barStartB + pp ∈ [barStartB, barStartB + barBeats[b])`，**最大索引 = `barStartB + barBeats[b] − 1 = totalBeats − 1`** ✓

**结论**：原本怀疑的"`mspSegX[末拍+]` 未用"是误读——数组初始化已不含越界索引。**移除**。

### 5.6 `[已知问题]` `baseBarSum` 末拍间隙不对称（待 `&zkh/&ykh` 边界用例验证）

```
baseBarSum = Σ [Σ beatBodyW[b] + (barBeats[b]−1)·NOTE_GAP]    # 末拍去 NOTE_GAP
```
末拍后用 `s`（拉伸）代替 `NOTE_GAP`，**紧凑宽不含末拍 NOTE_GAP**。当 `beatBodyW` 含非时值括号（`&zkh/&ykh`）时，`ΣbracketBodyW` 在该拍累计到 `voiceBeats[k]`，但 `baseBarSum` 仍按"末拍去 NOTEGAP"算——**括号本身就有宽度，与是否去 NOTEGAP 无关，但当前公式对其无影响**。

**待验证**：未跑 `&zkh/&ykh` 多声部边界用例。

### 5.7 `[已知问题]` `stretchBars=false` 时多声部行尾留多少——内容物理已超可能溢出

```
stretchBars=false → targetBarSum=0, avStretch=0, s=0
ΣmspBarRelW = baseBarSum（紧凑内容宽，不拉伸）
lineX末 = blockStartX + baseBarSum + sumGapSpaces + BAR
        = blockStartX + Σ[ΣbeatBodyW + (bb−1)·NOTE_GAP] + sumGapSpaces + BAR
```

**问题**：当 `baseBarSum > blockAvailW − nonDurPad − sumGapSpaces − BAR`（**内容物理已超**）时：
- `lineX末 > rightLimit − halfW` → 触发钳制函数 `r1(min(max(lineX0, margin_left+halfW), pageW−margin_right−halfW))` → **小节线被钳到右边界** ✓
- 但**内容仍超**——`ΣmspBarRelW` 不变，音符实际 x 仍 > `blockStartX + blockAvailW` → 末音符超出右 margin

**实例**：5.3 例子（每小节 4×8.06=32.24，4 小节=128.96 + `ΣgapSpaces=9.75` + BAR=6 = **144.71** < blockAvailW=476.3，但 `ΣbaseBarSum=257.92` 远超 `blockAvailW − nonDurPad = 451.3`，`stretchBars=false` 末线自然 `lineX末 = 54 + 257.92 + 9.75 + 6 = 327.67 < 554.73`，但**实际内容总和 257.92 > 451.3 ⇒ 某拍段超出右 margin**。

**当前行为**：`stretchBars=false` 只保证**末线不主动撑满**（vs `true` 时强制贴右），但**未做溢出检查**。超宽由谱师编排平衡（5.3），引擎不强行断行。

### 5.8 `[设计]` `DOT_AFTER_DIGIT_GAP` 已入 `spacing.ts`（adj317 实现层固定）

```
// packages/ijipu-engine/src/engine/layout/spacing.ts
/** adj317：多声部 space 显式 dot 段位置；设计值 18 号字基准 × 主音符缩放因子。 */
export const DOT_AFTER_DIGIT_GAP = (noteSize: number) => 0.2 * noteScaleOf(noteSize) * 18
//  = noteSize · 0.2（与原硬编码值一致）；13 号 ≈ 2.6px，18 号 = 3.6px
```
渲染层 `dotX0` 回退（`seg0.x + mainDur·perBeat`）在 `perBeat ≈ noteBodyW` 时附点圆心 = 数字右缘（紧贴数字），**多声部必须显式 push dot 段**避坑。该常量调小/调大只需改 `spacing.ts`。

### 5.9 `[设计]` `targetEndBarX` 用 `barlineTotalW('|')/2 = 0.55`（不是 `barlinePad/2=1.625`）

`adj317c` 推导：钳制上界 = `pageW − margin_right − barlineTotalW/2 = 554.73`。`halfBarW = barlineTotalW('|')/2`（**线自身半宽**，小线），**不是** `barlinePad/2`（拍间固定间隙，用于节间 `gapSpaces`）。曾混用导致实测 `lineX末 = 553.65`（差 1.05）。**修后**：实测 `lineX末 = 554.73`（与钳制上界一致）。

---

## 六、变更历史

| adj    | 摘要 |
|--------|------|
| adj250 | 多声部块内每小节取整数拍（向上取整） |
| adj283 | 单声部空间优先布局 |
| adj314 | 多声部空间优先：拍宽=该拍最大本体占宽；末拍后去 NOTEGAP；数字锚段起点 |
| adj315 | 单声部小节线两侧间距：只朝向有音符的一侧 |
| adj316 | 多声部：拍区间半开 off-by-one 修复 + 拉伸空白均分到「小节头 + 各拍后」+ 首小节节头 = 0 |
| adj317a | 拍宽 = 该拍最大本体占宽；末拍后净间隙 = s（去 NOTEGAP，对称） |
| adj317b | `avStretch` 用 `baseBarSum`（拍级 ΣbeatBodyW）替代 `durBodySum`（声部级 baseW 和）—— 修多声部末音符溢出 |
| adj317c | 末线钳制到 `rightLimit − halfBarW`（与单声部 atEnd 一致），`avStretch` 反推 `ΣbarBar` |
| adj318 | 多声部读 `config.align_min_bars`：行小节数 < 该值不撑满（自然宽、行尾留白）；≥ 该值走 adj317c 末线钳制 |
| adj319 | 试听色块：多声部 `noteRightX` 累加附点圆右 + 增时线 + hx（防 dot 段 x > rightX → width=0 → 附点色块消失）；`DOT_AFTER_DIGIT_GAP` 入 `spacing.ts` 规范化常量 |
| adj320 | 试听色块按"时值元素"分块：附点并入主音符（1 块）、增时线独立（5--- 分 4 块）、纯音符跨拍各拍一块；色块右边界 = 下一时值元素左缘 或 小节线左缘（连续覆盖）；多声部段循环 `dur` 用主时值（去附点）防双重计入（`5.` 跨拍 segments.beats 总和 由 2 → 1.5） |
| adj321 | 连音线连接点规则：连音线至少 2 音符。`(X)`（一个音符被 `(`开+`)`关紧贴）且栈内还有更早未闭合连音时，X 是**连接点**——终止前一连音于 X，并以 X 为起点开启新连音。用例：`(1 (2) 3)` = 1→2 + 2→3（两条）；`(1(2 3))` = 1→3外层 + 2→3内层；`(1 (2 3) 4)` = 1→4 + 2→3（真嵌套 2 音符内层不触发连接点）。修跨行连音线：`(6,- | (6,)--- | 6)-` 的 `(6,)` 为连接点，上一行 6, → 下一行第一个 6,（终止）+ 该 6, → 下一行第二个 6,（起新连音） |
| adj321b | 连接点**不受 depth<2（adj91 渲染层数限制）约束**：连接点 X 是明确的连音语义，即使嵌套在深层括号内（depth≥2）也应终止前一连音 + 起新连音（depth 取被终止连音层级，保持可渲染）。修大段谱 `...(7,/6,//5,//) (6,- | 1 2 (6,)- | 6,)- ...` 的 `(6,)` 深嵌套连接点被 `depth<2` 阻断导致跳连音线的 bug |
| adj395 | **等时值连音组 `(y…)` 的时值与占宽**：`splitNoteDur` 认 `tupletDur`——组内音符总时值 = `tupletDur`，按原始构型（`/` 条数、`-` 条数、`.`）等比缩放，故空间优先下「元素可支配宽 = 元素时值 ÷ 行总时值 × W」自动按 1/3 拍分摊（组拿到 1 拍份额，不再按各自写的 `/` 时值算成 1.5 拍 → 越出小节）。同时 token 增 `tupletGroup`（解析期给出的稳定组号），`computeBeams` 分组键改为「有组号按组号、无组号按拍」→ 组内减时线连成一条（跨拍不断开）。**注：其"连音组不与同拍内组外音符共线"一句已被 adj397 取代** |
| adj397 | **减时线与同拍内的连音组相连**：`computeBeams` 的分组由「单键分桶」改为**相邻逐对判定** `linked(a,b)`——同组 → 相连（跨拍不断，保留 adj395）；**否则同拍 → 相连**。故 4/4 的 `2/. 3// 5/ (y5// 6// 5//) …` 里 `5/`（拍 2 起点）与组内三音（拍 2 内）共用第 1 条减时线，第 2 条仍只覆盖带 `//` 的组内三音；跨拍组仍整组一条且不并入相邻拍音符 |
| adj398 | **临时拍号分数计入行宽预算**：新增 `meterGapRight(comment, noteSize)`（分数整宽 + 起始 2×s + 末距 2px），空间优先的 `nonDurPad` 由 `lineW + barlinePad×2` 改为 `lineW + barlinePad + max(barlinePad, meterGapRight)`（**无分数时与原式等价**），放置处 `gapR` 复用同一函数 → 预算与放置同源；行末小节线右钳制再让出 `meterGapRight`（空间优先 pin 与时值优先 `Math.min` 各一处）。修复「带 `\|"p:2/4"` 的行内容整体右溢」（每个分数约 10.7px，用户谱越界 19.2px）与「行末小节线的分数越出右边距 12px」 |
| adj601 | **下一组多声部块以上一组的"小节宽"为下限**（用户要求："第二组多声部，当自然对齐时，应尽量与上一组的小节线对齐，除非第二组的小节宽度比上一级对应小节宽"）。只对**未撑满**的块（adj925 起 = **末块且** `numBars < align_min_bars`）生效：`W_b = max(自然宽, 上一组同序小节宽)`，多出的部分**均摊到该小节各拍**（`alignAdd`），故小节线逐根对齐（实测用户谱第二组 2 小节对上第一组前 2 根：`176.5 / 299.8`）。三个细节：① 上一组**末小节**没有"后间距/2"、内小节有 ⇒ 本块末小节对齐到上一组内小节时补 `barlinePad/2`（否则短 1.6px）；② 试算 `Σ max(自然宽, 下限)` 超 `blockAvailW` 就**整体放弃对齐**（对齐是"尽量"、越界是硬约束）；③ 换页清空、中间夹单声部行不清（"上一组"= 上一个多声部块），撑满的块（已按行宽拉伸）不参与 |
| adj925 | **`align_min_bars` 只对末行生效**（用户裁定「只针对末行有效，上面的其它还都还是两边分散对齐」）：非末行一律两端对齐撑满；末行才 `barCount >= align_min_bars`。末行 = 整份谱最后一个排版单元的最后一行，**或**本曲部只有一行（用户追加裁定「单行曲部本身也是末行呀」）⇒ `adj421` 的预分槽照旧生效。三处生效点：`placeMusicRow` / `placeMusicRowSpace` 的 `stretch`、`placeVoiceBlock` 的 `stretchBars`（⚠ 多声部的**时值优先**分支本来就没有这道门，恒摊满 ⇒ 那一支"末行 < 阈值也撑满"是既有缺口，本轮未改）。连带改动：① 单声部两条"对齐上一行"（`adj199` 时值优先 / `adj355` 空间优先）按 `adj601` 的先例补了**越界闸门**（试算超可用宽就整体放弃对齐、退回自然宽）—— 否则上一行被撑满后，下一行的逐小节对齐会把内容推出纸外（实测越界 132.72px）；② 文档示例值 3 → 2 |
| adj935 | **末行口径收窄成「整份谱的最后一行」**（用户裁定「**除了整份谱的最后一行，其它行一律撑满（两端对齐）**」）：`layout/index.ts` 两处 `isFinalRow = isLastRowOfScore \|\| singleRowGroup` ⇒ **去掉 `\|\| singleRowGroup`**（单声部时值优先 / 空间优先）。理由：整份谱只有一行时那一行天然就是最后一行，这条多余；而它在"**多行谱里某段只有一行**"时会把那一行**误判成末行**（小节数 < 阈值就不撑满，实测行尾留白 113~128px）。同时把 `adj421` 的生效范围**收窄成「整份谱只有一行」**（`placeGroup` 里 `singleRowOfScore = rows.length === 1 && unitCount === 1`；`adj421` 那段代码一个字没改，门 `singleRowOfScore && !stretch` 自动只在"整份谱单行且 < 阈值"时开）。多声部那处（`placeVoiceBlock` 的 `stretchBars`）**核过、未改**（一块即一行，本来就没有这一条）。实测：非末行（3 小节 < 4）`417.70 → 544.80`（空间优先）；整份谱单行 3 小节仍预分槽 `417.70` / `432.00`；末行 < 阈值仍自然宽（多单位谱的末段 3 小节：空间优先 `416.20`、时值优先 `433.50`）；`adj601` 多声部末块自然对齐照旧（`185.90 / 305.50` 与上一块逐根对齐）。连带修的三处**探针/用例口径**：① `adj905o` 的 `barLeft` 补"**限同一行**"（此前只筛声部与层，会取到别行的小节线 ⇒ 撑满后暴露 11 处假红）；② `adj667` 图5 用例把连音线挪到第 2 小节（旧写法两个起点落在包络左端之外 ⇒ 用例失去敏感性）；③ `adj651` "两条延续线锚点不同"由魔数 `>100` 改成直接判"各自锚在自己那根房子小节线上、且两根不同"（实测间距 123.8 → 60.1） |
| adj940 | **自然宽行（末行）的对齐基准从"上一行小节内容宽"改成"上一行小节线实位"**（用户裁定；详见 §1.1c）。`prevRowMeasW`（内容宽）→ `prevRowLineX`（**实测线位**，跨组/**跨页都不清空**，用户明确要求）。三条一起才算对齐：① 前 `k−1` 根精确重合（≤0.05px）；② 末根线贴右内容界（末根线组更宽时按半个线宽差让位——`\|\|`(4) 对 `\|`(1) ⇒ 1.5px）；③ 逐小节宽 ≥ 上一行对应小节。空间优先**只加宽**（自然宽 = 墨迹本体之和）；时值优先按线位公式反解 `w_b`、**允许压缩**（地板 = 该拍墨迹最小需求 `minNoteW/minDur`，旧 `adj199` 一直就压着对齐）。**`adj211` 的「`\|\|` 结尾 ≤3 小节不参与对齐」豁免删除**（与行末是什么线无关）。`align_min_bars` 从此**只管"末行撑不撑满"、不管"对齐"**——对齐是默认行为、不依赖任何 `# jps-config` 键。实测（空配置，用户谱 `壁上观.jps`）：上一行 `218.50 / 398.60 / 544.80` → 末行 `218.50 / 398.60 / 543.30`（前两根 0px 重合、末根差 1.5px），逐小节宽 `168.50 / 180.10 / 144.70`（上一行 `… / 146.20`）。连带按新口径改写：`adj211`（旧口径实测 `195.1 + ML_SHIFT` 自然宽 ⇒ 现在两种结尾都逐根对上 + 负对照）、`adj935 ②`（"自然"的判据从"行尾留白 > 8px"改成"前两根与上一行逐根重合"，撑满那档判"**不**重合"）、`adj929` 的两条负对照（末行变宽后旧口径的弧顶极差只剩 0.83px ⇒ 改成直接喂进判据谓词；判据②的极差容差由 1px **收紧**到 0.5px，实测 0.01px）。多声部一侧（`adj601`/`adj644`）**未改** |