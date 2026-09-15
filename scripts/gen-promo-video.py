#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
iJipu（爱记谱）15s 极速版宣传视频生成器
==============================================
零依赖（仅使用 Python 标准库），输出到 ijipu/dist-video/：
  - frame_0000.png ... frame_0449.png  帧序列（30 fps，竖屏 1080x1920）
  - bgm.wav                              程序合成的 synthwave 风 BGM（15 秒）
  - iJipu_promo_15s.apng                 APNG 动画（无声，可直接预览）
  - iJipu_promo_15s.mp4                  若系统存在 ffmpeg 则合并出 MP4
  - preview.html                         浏览器内可同时预览视频 + 音频

设计原则（与品牌一致）：
  深空蓝 #1E2A5E 主背景 + 霓虹青 #00F0FF 强调色 + 纸张白 #FFFFFF 乐谱预览
  等宽字体（用 DejaVu Sans Mono 兜底）= 代码区
  思源黑体（系统找不到时用默认 sans-serif）= 中文字幕
"""
from __future__ import annotations
import math
import os
import struct
import sys
import time
import wave
import zlib
from pathlib import Path

# -----------------------------------------------------------------------------
# 路径与常量
# -----------------------------------------------------------------------------
ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "dist-video"
OUT.mkdir(parents=True, exist_ok=True)

W, H = 1080, 1920          # 竖屏 9:16
FPS = 30
DURATION = 15              # 秒
TOTAL = FPS * DURATION     # 450 帧
SAMPLE_RATE = 44100

# 品牌色
SPACE_DEEP = (15, 21, 38)      # #0F1526  最深底
SPACE_BLUE = (30, 42, 94)      # #1E2A5E  主色
NEON_CYAN = (0, 240, 255)      # #00F0FF  强调
PAPER_WHITE = (255, 255, 255)  # #FFFFFF  乐谱区
INK_BLACK = (27, 27, 27)       # #1B1B1B  墨色
SUBTLE_GREY = (140, 150, 180)  # 浅灰蓝
HOT_PINK = (255, 92, 168)      # #FF5CA8  分隔点缀


# -----------------------------------------------------------------------------
# 工具：颜色混合、字体测量（不依赖 PIL）
# -----------------------------------------------------------------------------
def hex_to_rgb(s: str) -> tuple[int, int, int]:
    s = s.lstrip("#")
    return int(s[0:2], 16), int(s[2:4], 16), int(s[4:6], 16)


def rgb_to_hex(rgb: tuple[int, int, int]) -> str:
    return "#{:02X}{:02X}{:02X}".format(*[max(0, min(255, int(v))) for v in rgb])


def lerp(a: float, b: float, t: float) -> float:
    return a + (b - a) * t


def lerp_rgb(c1, c2, t):
    return tuple(int(lerp(c1[i], c2[i], t)) for i in range(3))


def text_width_estimate(text: str, font_size: int, is_mono: bool = False) -> int:
    """粗略估算文字宽度（中英文混排），用于排版定位。"""
    w = 0
    for ch in text:
        if ord(ch) < 128:
            w += font_size * (0.55 if is_mono else 0.6)
        else:
            w += font_size * 1.0
    return int(w)


# -----------------------------------------------------------------------------
# 纯 Python PNG 写入器（8-bit RGB + Alpha via tRNS 简化版）
# 仅支持 8-bit RGB（无 alpha 通道），足够视频帧用途
# -----------------------------------------------------------------------------
def write_png_rgb(path: Path, width: int, height: int, pixels: bytes) -> None:
    """pixels: width*height*3 bytes，RGB 顺序，每行无 filter。"""
    assert len(pixels) == width * height * 3
    raw = bytearray()
    stride = width * 3
    for y in range(height):
        raw.append(0)  # filter type 0 (None)
        raw.extend(pixels[y * stride:(y + 1) * stride])

    def chunk(tag: bytes, data: bytes) -> bytes:
        crc = zlib.crc32(tag + data) & 0xFFFFFFFF
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", crc)

    sig = b"\x89PNG\r\n\x1a\n"
    ihdr = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)  # 8-bit RGB
    idat = zlib.compress(bytes(raw), 9)
    out = sig + chunk(b"IHDR", ihdr) + chunk(b"IDAT", idat) + chunk(b"IEND", b"")
    path.write_bytes(out)


# -----------------------------------------------------------------------------
# 像素画布（性能优化版：用 bytes 切片代替逐像素 Python 循环）
# -----------------------------------------------------------------------------
class Canvas:
    __slots__ = ('w', 'h', 'buf', 'stride', 'px')

    def __init__(self, w: int, h: int, bg=(0, 0, 0)):
        self.w, self.h = w, h
        self.stride = w * 3
        self.buf = bytearray(self.stride * h)
        self.fill(bg)

    def fill(self, color):
        r, g, b = color
        # 用单行 bytes 一次性扩展到全图（memcpy 级别）
        row = bytes((r, g, b)) * self.w
        self.buf[:] = row * self.h

    def set_pixel(self, x, y, color):
        if 0 <= x < self.w and 0 <= y < self.h:
            i = (y * self.w + x) * 3
            self.buf[i] = color[0]
            self.buf[i + 1] = color[1]
            self.buf[i + 2] = color[2]

    def hline(self, x0, x1, y, color):
        if y < 0 or y >= self.h:
            return
        if x0 > x1:
            x0, x1 = x1, x0
        x0 = max(0, x0)
        x1 = min(self.w - 1, x1)
        if x0 > x1:
            return
        # 一次切片写一行
        row_start = y * self.stride + x0 * 3
        row_end = y * self.stride + (x1 + 1) * 3
        # 用 memoryview + 重复 byte pattern 填充
        pixel = bytes(color)
        # 写入 [x0, x1] 范围的像素
        span = x1 - x0 + 1
        pattern = pixel * span
        self.buf[row_start:row_end] = pattern

    def vline(self, x, y0, y1, color):
        if x < 0 or x >= self.w:
            return
        if y0 > y1:
            y0, y1 = y1, y0
        y0 = max(0, y0)
        y1 = min(self.h - 1, y1)
        if y0 > y1:
            return
        r, g, b = color
        # 垂直线：逐行写一个像素
        base = x * 3
        stride = self.stride
        for y in range(y0, y1 + 1):
            i = y * stride + base
            if i + 2 < len(self.buf):
                self.buf[i] = r
                self.buf[i + 1] = g
                self.buf[i + 2] = b

    def rect(self, x0, y0, x1, y1, color, filled=True):
        if x0 > x1:
            x0, x1 = x1, x0
        if y0 > y1:
            y0, y1 = y1, y0
        # 裁剪
        x0c = max(0, x0)
        x1c = min(self.w - 1, x1)
        y0c = max(0, y0)
        y1c = min(self.h - 1, y1)
        if x0c > x1c or y0c > y1c:
            return
        pixel = bytes(color)
        span = x1c - x0c + 1
        row_pattern = pixel * span
        if filled:
            start = y0c * self.stride + x0c * 3
            end = (y1c + 1) * self.stride
            n_rows = y1c - y0c + 1
            # 整块填充：用 bytearray + 循环 extend 确保正确
            buf_view = self.buf
            row_bytes = bytes(row_pattern)
            for r in range(n_rows):
                row_start = start + r * self.stride
                row_end = row_start + len(row_bytes)
                buf_view[row_start:row_end] = row_bytes
        else:
            # 上下边
            self.hline(x0c, x1c, y0c, color)
            self.hline(x0c, x1c, y1c, color)
            # 左右边
            self.vline(x0c, y0c, y1c, color)
            self.vline(x1c, y0c, y1c, color)

    def gradient_v(self, c_top, c_bottom):
        # 预生成每行颜色 bytes（避免循环内重新分配）
        rows = []
        for y in range(self.h):
            t = y / max(1, self.h - 1)
            color = lerp_rgb(c_top, c_bottom, t)
            rows.append(bytes(color) * self.w)
        # 一次性写入
        self.buf[:] = b"".join(rows)

    def gradient_radial(self, center, radius, c_inner, c_outer):
        cx, cy = center
        max_r = radius
        # 预计算每行的距离 + 颜色
        # 为了内存效率，按行处理
        for y in range(self.h):
            row_start = y * self.stride
            for x in range(self.w):
                d = math.hypot(x - cx, y - cy)
                t = min(1.0, d / max_r)
                color = lerp_rgb(c_inner, c_outer, t)
                i = row_start + x * 3
                self.buf[i] = color[0]
                self.buf[i + 1] = color[1]
                self.buf[i + 2] = color[2]

    # ---- 简易位图字体 --------------------------------------------------------
    # 用 5x7 像素点阵实现 ASCII 可打印字符；中文用空白占位（无法像素化，
    # 在视频里用大色块 + 简单几何图形 + 数字英文传达信息，中文信息靠字幕底色块 + 英文标注）。
    # 这避免了依赖 PIL/字体文件。
    GLYPHS = {
        ' ': ["00000", "00000", "00000", "00000", "00000", "00000", "00000"],
        '!': ["00100", "00100", "00100", "00100", "00100", "00000", "00100"],
        '"': ["01010", "01010", "01010", "00000", "00000", "00000", "00000"],
        '#': ["01010", "11111", "01010", "11111", "01010", "00000", "00000"],
        '$': ["00100", "01111", "10100", "01110", "00101", "11110", "00100"],
        '%': ["11000", "11001", "00010", "00100", "01000", "10011", "00011"],
        '&': ["01100", "10010", "10100", "01000", "10101", "10010", "01101"],
        "'": ["00100", "00100", "00100", "00000", "00000", "00000", "00000"],
        '(': ["00010", "00100", "01000", "01000", "01000", "00100", "00010"],
        ')': ["01000", "00100", "00010", "00010", "00010", "00100", "01000"],
        '*': ["00100", "10101", "01110", "00100", "01110", "10101", "00100"],
        '+': ["00000", "00100", "00100", "11111", "00100", "00100", "00000"],
        ',': ["00000", "00000", "00000", "00000", "00100", "00100", "01000"],
        '-': ["00000", "00000", "00000", "11111", "00000", "00000", "00000"],
        '.': ["00000", "00000", "00000", "00000", "00000", "00000", "00100"],
        '/': ["00001", "00010", "00010", "00100", "01000", "01000", "10000"],
        '0': ["01110", "10001", "10011", "10101", "11001", "10001", "01110"],
        '1': ["00100", "01100", "00100", "00100", "00100", "00100", "01110"],
        '2': ["01110", "10001", "00001", "00010", "00100", "01000", "11111"],
        '3': ["11110", "00001", "00001", "01110", "00001", "00001", "11110"],
        '4': ["00010", "00110", "01010", "10010", "11111", "00010", "00010"],
        '5': ["11111", "10000", "11110", "00001", "00001", "10001", "01110"],
        '6': ["00110", "01000", "10000", "11110", "10001", "10001", "01110"],
        '7': ["11111", "00001", "00010", "00100", "01000", "01000", "01000"],
        '8': ["01110", "10001", "10001", "01110", "10001", "10001", "01110"],
        '9': ["01110", "10001", "10001", "01111", "00001", "00010", "01100"],
        ':': ["00000", "00100", "00000", "00000", "00000", "00100", "00000"],
        ';': ["00000", "00100", "00000", "00000", "00100", "00100", "01000"],
        '<': ["00010", "00100", "01000", "10000", "01000", "00100", "00010"],
        '=': ["00000", "00000", "11111", "00000", "11111", "00000", "00000"],
        '>': ["01000", "00100", "00010", "00001", "00010", "00100", "01000"],
        '?': ["01110", "10001", "00001", "00010", "00100", "00000", "00100"],
        '@': ["01110", "10001", "10111", "10101", "10110", "10000", "01110"],
        'A': ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
        'B': ["11110", "10001", "10001", "11110", "10001", "10001", "11110"],
        'C': ["01110", "10001", "10000", "10000", "10000", "10001", "01110"],
        'D': ["11110", "10001", "10001", "10001", "10001", "10001", "11110"],
        'E': ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
        'F': ["11111", "10000", "10000", "11110", "10000", "10000", "10000"],
        'G': ["01110", "10001", "10000", "10111", "10001", "10001", "01111"],
        'H': ["10001", "10001", "10001", "11111", "10001", "10001", "10001"],
        'I': ["01110", "00100", "00100", "00100", "00100", "00100", "01110"],
        'J': ["00111", "00010", "00010", "00010", "00010", "10010", "01100"],
        'K': ["10001", "10010", "10100", "11000", "10100", "10010", "10001"],
        'L': ["10000", "10000", "10000", "10000", "10000", "10000", "11111"],
        'M': ["10001", "11011", "10101", "10101", "10001", "10001", "10001"],
        'N': ["10001", "11001", "10101", "10011", "10001", "10001", "10001"],
        'O': ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
        'P': ["11110", "10001", "10001", "11110", "10000", "10000", "10000"],
        'Q': ["01110", "10001", "10001", "10001", "10101", "10010", "01101"],
        'R': ["11110", "10001", "10001", "11110", "10100", "10010", "10001"],
        'S': ["01111", "10000", "10000", "01110", "00001", "00001", "11110"],
        'T': ["11111", "00100", "00100", "00100", "00100", "00100", "00100"],
        'U': ["10001", "10001", "10001", "10001", "10001", "10001", "01110"],
        'V': ["10001", "10001", "10001", "10001", "10001", "01010", "00100"],
        'W': ["10001", "10001", "10001", "10101", "10101", "10101", "01010"],
        'X': ["10001", "10001", "01010", "00100", "01010", "10001", "10001"],
        'Y': ["10001", "10001", "10001", "01010", "00100", "00100", "00100"],
        'Z': ["11111", "00001", "00010", "00100", "01000", "10000", "11111"],
        '[': ["01110", "01000", "01000", "01000", "01000", "01000", "01110"],
        '\\': ["10000", "01000", "01000", "00100", "00010", "00010", "00001"],
        ']': ["01110", "00010", "00010", "00010", "00010", "00010", "01110"],
        '^': ["00100", "01010", "10001", "00000", "00000", "00000", "00000"],
        '_': ["00000", "00000", "00000", "00000", "00000", "00000", "11111"],
        '`': ["01000", "00100", "00010", "00000", "00000", "00000", "00000"],
        '{': ["00010", "00100", "00100", "01000", "00100", "00100", "00010"],
        '|': ["00100", "00100", "00100", "00000", "00100", "00100", "00100"],
        '}': ["01000", "00100", "00100", "00010", "00100", "00100", "01000"],
        '~': ["01001", "10101", "10010", "00000", "00000", "00000", "00000"],
    }

    def text(self, x: int, y: int, s: str, color, scale: int = 4,
             letter_spacing: int = 1):
        """渲染英文/数字/ASCII 文本，scale 越大字越大。"""
        cur_x = x
        for ch in s:
            upper = ch.upper() if ch.isalpha() else ch
            glyph = self.GLYPHS.get(upper, self.GLYPHS.get(ch))
            if glyph is None:
                glyph = self.GLYPHS['?']
            for ry, row in enumerate(glyph):
                for rx, bit in enumerate(row):
                    if bit == '1':
                        self._blit_square(cur_x + rx * scale,
                                          y + ry * scale,
                                          scale, color)
            cur_x += (5 + letter_spacing) * scale
        return cur_x

    def _blit_square(self, x: int, y: int, size: int, color):
        """绘制实心方块（性能优化版：用字节切片一次写入）。"""
        if size <= 0:
            return
        x0 = max(0, x)
        y0 = max(0, y)
        x1 = min(self.w, x + size)
        y1 = min(self.h, y + size)
        if x0 >= x1 or y0 >= y1:
            return
        pixel = bytes(color)
        row_pattern = pixel * (x1 - x0)
        row_bytes = bytes(row_pattern)
        buf_view = self.buf
        for ry in range(y0, y1):
            row_start = ry * self.stride + x0 * 3
            row_end = row_start + len(row_bytes)
            buf_view[row_start:row_end] = row_bytes

    def text_width(self, s: str, scale: int = 4, letter_spacing: int = 1) -> int:
        return len(s) * (5 + letter_spacing) * scale - letter_spacing * scale

    def center_text(self, y: int, s: str, color, scale: int = 4,
                    letter_spacing: int = 1, max_w: int | None = None):
        w = self.text_width(s, scale, letter_spacing)
        x = (self.w - w) // 2
        if max_w is not None and w > max_w:
            # 自动降级缩放
            scale2 = max(2, int(scale * max_w / w))
            return self.center_text(y, s, color, scale2, letter_spacing)
        self.text(x, y, s, color, scale, letter_spacing)
        return x, y


# -----------------------------------------------------------------------------
# 装饰元素
# -----------------------------------------------------------------------------
def draw_grid(c: Canvas, color, step=80, alpha_blend=0.15):
    """背景网格，霓虹青低透明度。"""
    blended = tuple(int(SPACE_DEEP[i] + (color[i] - SPACE_DEEP[i]) * alpha_blend)
                    for i in range(3))
    for x in range(0, c.w, step):
        c.vline(x, 0, c.h - 1, blended)
    for y in range(0, c.h, step):
        c.hline(0, c.w - 1, y, blended)


def draw_glow_rect(c: Canvas, x0, y0, x1, y1, color, glow_size=8, alpha=0.4):
    """简易矩形霓虹辉光。"""
    for i in range(glow_size, 0, -1):
        t = (glow_size - i + 1) / glow_size
        col = tuple(int(SPACE_DEEP[j] + (color[j] - SPACE_DEEP[j]) * alpha * t)
                    for j in range(3))
        c.rect(x0 - i, y0 - i, x1 + i, y1 + i, col, filled=True)


def draw_scanline(c: Canvas, color, alpha=0.06, period=3):
    """CRT 扫描线。"""
    blended = tuple(int(SPACE_DEEP[i] + (color[i] - SPACE_DEEP[i]) * alpha)
                    for i in range(3))
    for y in range(0, c.h, period):
        c.hline(0, c.w - 1, y, blended)


def draw_cursor_blink(c: Canvas, x, y, h, color, t):
    """打字机光标闪烁。"""
    if int(t * 4) % 2 == 0:
        c.vline(x, y, y + h, color)


def draw_text_with_shadow(c: Canvas, x, y, text, color, scale=4, letter_spacing=1,
                          shadow_offset=8, shadow_color=(0, 0, 0)):
    """带阴影文字。"""
    # 阴影：先渲染深色版本
    sh = tuple(int(v * 0.4) for v in shadow_color)
    c.text(x + shadow_offset, y + shadow_offset, text, sh, scale, letter_spacing)
    c.text(x, y, text, color, scale, letter_spacing)


# -----------------------------------------------------------------------------
# 简谱音符简易绘制（数字 + 下划线 + 增时线）
# -----------------------------------------------------------------------------
def draw_jianpu_row(c: Canvas, x, y, notes, color=INK_BLACK, scale=6,
                    spacing=None, with_lyrics=None):
    """绘制一行简谱：notes 是字符串列表（如 ['1','1','5','5','|','6','6','5','-']）。"""
    if spacing is None:
        spacing = scale * 5
    cur_x = x
    for i, n in enumerate(notes):
        c.text(cur_x, y, n, color, scale, 1)
        cur_x += spacing
        # 增时线
        if n == '-':
            line_y = y + scale * 5
            c.hline(cur_x - spacing // 2, cur_x - 4, line_y, color)
        # 小节线
        if n == '|':
            c.vline(cur_x - spacing // 2, y - scale // 2,
                    y + scale * 6, color)
        # 歌词
        if with_lyrics and i < len(with_lyrics):
            ly = with_lyrics[i]
            if ly and ly != '，' and ly != '。':
                c.text(cur_x - spacing // 2, y + scale * 8, ly,
                       tuple(int(c_) for c_ in (60, 60, 60)), max(3, scale - 2), 0)


# -----------------------------------------------------------------------------
# 关键帧脚本（与 docs/APP-PROMO-VIDEO.md 中的 15s 极速版逐秒对应）
# -----------------------------------------------------------------------------
# 总时间线（秒）：
#   0.0 - 3.0   钩子：黑屏渐显 + 打字机光标 + 反问字幕
#   3.0 - 8.0   演示：编辑器分屏（左代码、右简谱），代码逐字打印
#   8.0 -12.0   杀招：导出菜单 + 试听按钮
#  12.0 -15.0   落版：Logo + Slogan + CTA
# -----------------------------------------------------------------------------

SCENES = [
    # (start, end, name)
    (0.0, 3.0, "hook"),
    (3.0, 8.0, "demo"),
    (8.0, 12.0, "showoff"),
    (12.0, 15.0, "outro"),
]


def ease_in_out(t):
    """0~1 缓动。"""
    return t * t * (3 - 2 * t)


def draw_hook(c: Canvas, t: float):
    """0-3s 钩子：黑屏渐显 → 霓虹青光标 → 反问字幕。"""
    # 背景：渐变从黑到深空蓝
    bg_t = min(1.0, t / 0.6)
    bg_top = lerp_rgb((0, 0, 0), SPACE_DEEP, ease_in_out(bg_t))
    bg_bot = lerp_rgb((0, 0, 0), SPACE_BLUE, ease_in_out(bg_t))
    c.gradient_v(bg_top, bg_bot)
    # 网格
    if bg_t > 0.4:
        draw_grid(c, NEON_CYAN, step=120, alpha_blend=0.05 + 0.05 * (bg_t - 0.4) / 0.6)

    # 顶部装饰线（霓虹青）
    c.hline(0, c.w - 1, 120, NEON_CYAN)
    c.hline(0, c.w - 1, 124, NEON_CYAN)

    # 中央打字机区域
    line_y = H // 2 - 200
    code = "1 1 5 5 | 6 6 5 -"
    # 逐字显现：每个字符 0.15s
    chars_to_show = max(0, min(len(code), int((t - 0.4) / 0.12)))
    shown = code[:chars_to_show]
    c.text(W // 2 - c.text_width(shown, 6, 2) // 2, line_y, shown,
           NEON_CYAN, 6, 2)
    # 光标
    cur_x = W // 2 - c.text_width(shown, 6, 2) // 2 + c.text_width(shown, 6, 2) + 4
    draw_cursor_blink(c, cur_x, line_y, 7 * 6, NEON_CYAN, t)

    # 反问字幕：1.4s 后从下方滑入
    if t > 1.4:
        slide_t = min(1.0, (t - 1.4) / 0.4)
        slide_y = int(H // 2 + 50 + (1 - ease_in_out(slide_t)) * 80)
        alpha = slide_t
        # 字幕底色块
        bar_color = tuple(int(SPACE_DEEP[i] + (NEON_CYAN[i] - SPACE_DEEP[i]) * 0.15 * alpha)
                          for i in range(3))
        c.rect(80, slide_y - 30, W - 80, slide_y + 90, bar_color, filled=True)
        # 顶/底边线
        c.hline(80, W - 80, slide_y - 30, NEON_CYAN)
        c.hline(80, W - 80, slide_y + 90, NEON_CYAN)
        # 英文反问
        q_en = "WRITE  MUSIC  WITH  CODE?"
        c.center_text(slide_y - 5, q_en, NEON_CYAN, 5, 2)
        # 中文小字
        c.center_text(slide_y + 50, "NI  YI  WEI  XIE  PU  ZHI  NENG  DIAN  SHU  BIAO ?",
                      SUBTLE_GREY, 3, 1)

    # 左下角小标识
    c.text(60, H - 80, "> IJIPU.SYS", NEON_CYAN, 3, 1)
    c.text(60, H - 50, "V 1.0", SUBTLE_GREY, 3, 1)
    # 右下角计时
    secs = f"T+{t:04.1f}S"
    c.text(W - 60 - c.text_width(secs, 3, 1), H - 80, secs, SUBTLE_GREY, 3, 1)


def draw_demo(c: Canvas, t: float):
    """3-8s 演示：编辑器分屏，左代码（霓虹青高亮），右白纸乐谱。"""
    # 整体背景
    c.gradient_v(SPACE_DEEP, SPACE_BLUE)
    draw_grid(c, NEON_CYAN, step=100, alpha_blend=0.05)
    draw_scanline(c, NEON_CYAN, alpha=0.04, period=4)

    # 顶部状态栏
    c.rect(0, 0, W, 80, (10, 16, 32), filled=True)
    c.hline(0, W, 80, NEON_CYAN)
    c.text(40, 32, "IJIPU  /  XIAOXINGXING.JPS", NEON_CYAN, 4, 1)
    c.text(W - 40 - c.text_width("SAVED  03:14", 3, 1), 40,
           "SAVED  03:14", SUBTLE_GREY, 3, 1)

    # 分屏：左 540 像素代码区，右 540 像素白纸乐谱
    split_x = 540
    # 左侧代码区
    c.rect(0, 80, split_x, H - 60, (12, 18, 36), filled=True)
    # 行号条
    line_x = 60
    c.rect(0, 80, line_x, H - 60, (8, 12, 26), filled=True)
    c.hline(0, split_x, 80, (40, 60, 120))

    # 代码行
    code_lines = [
        ("# IJIPU  DEMO", SUBTLE_GREY),
        ("V: 1.0", SUBTLE_GREY),
        ("B: XIAO XING XING", NEON_CYAN),
        ("P: 4/4", SUBTLE_GREY),
        ("", SUBTLE_GREY),
        ("Q: 1 1 5 5 | 6 6 5 -", NEON_CYAN),
        ("C: YI SHAN YI SHAN", (120, 220, 140)),
        ("Q: 4 4 3 3 | 2 2 1 -", NEON_CYAN),
        ("C: LIAN ZAI TIAN KONG", (120, 220, 140)),
    ]
    # 滚动进度：t 越大，显示越多行（前 1.5s 全部打完后停留展示）
    progress = min(1.0, (t - 3.0) / 1.5)
    lines_to_show = int(progress * len(code_lines)) + 1
    # 打字机逐字效果：每行 0.4s
    line_y = 130
    for i, (line, color) in enumerate(code_lines):
        if i >= lines_to_show:
            break
        # 行号
        c.text(20, line_y, f"{i+1:02d}", SUBTLE_GREY, 3, 1)
        # 当前行字符逐字显现
        if i == lines_to_show - 1 and progress < 1.0:
            local_t = (progress * len(code_lines)) - i
            chars = int(local_t * len(line) / 0.4)
            shown = line[:max(0, chars)]
            draw_text_with_shadow(c, line_x + 20, line_y, shown, color,
                                  scale=4, letter_spacing=1, shadow_offset=3,
                                  shadow_color=(0, 0, 0))
            # 光标
            cx = line_x + 20 + c.text_width(shown, 4, 1) + 4
            draw_cursor_blink(c, cx, line_y, 7 * 4, NEON_CYAN, t)
        else:
            draw_text_with_shadow(c, line_x + 20, line_y, line, color,
                                  scale=4, letter_spacing=1, shadow_offset=3,
                                  shadow_color=(0, 0, 0))
        line_y += 70

    # 分隔线
    c.vline(split_x, 80, H - 60, NEON_CYAN)

    # 右侧乐谱区（白纸）
    c.rect(split_x + 1, 80, W, H - 60, PAPER_WHITE, filled=True)
    # 标题
    c.text(split_x + 60, 130, "XIAO  XING  XING", INK_BLACK, 6, 2)
    c.text(split_x + 60, 210, "FR  FOLK  SONG", (120, 120, 120), 3, 1)
    # 拍号小字
    c.text(split_x + 60, 250, "4/4  J=96", (140, 140, 140), 3, 1)

    # 五线谱线（5 条水平线 + 音符点）
    staff_y = 350
    staff_lines = [staff_y, staff_y + 12, staff_y + 24, staff_y + 36, staff_y + 48]
    for sy in staff_lines:
        c.hline(split_x + 60, W - 60, sy, INK_BLACK)
    # 音符（按 progress 渐进显示，乐谱比代码稍晚开始）
    note_progress = min(1.0, max(0, (t - 3.5) / 2.5))
    notes_per_line = 8
    total_notes = 4  # 4 行 Q
    visible_notes = int(note_progress * total_notes * notes_per_line)
    cur_x = split_x + 80
    row = 0
    notes_drawn = 0
    for line_idx, (line, color) in enumerate(code_lines):
        if line.startswith("Q:"):
            y = staff_y + 24 + row * 100
            # 高音符头（小圆点）
            for n in range(notes_per_line):
                if notes_drawn >= visible_notes:
                    break
                # 数字音符
                digits = ["1", "1", "5", "5", "|", "6", "6", "5"]
                d = digits[n % len(digits)]
                # 实际渲染为五线谱上的圆头音符
                c._blit_square(cur_x, y, 14, INK_BLACK)
                # 数字标注在符头右侧
                c.text(cur_x + 16, y - 8, d, INK_BLACK, 3, 0)
                # 歌词
                lyrics = ["YI", "SHAN", "YI", "SHAN", "|", "LIAN", "GENG", "JING"]
                c.text(cur_x + 16, y + 24, lyrics[n % len(lyrics)],
                       (80, 80, 80), 2, 0)
                cur_x += 60
                notes_drawn += 1
            # 小节线
            c.vline(cur_x - 30, y - 14, y + 14, INK_BLACK)
            row += 1
            cur_x = split_x + 80
            if row >= 4:
                break

    # 中间分隔线光晕（强调"双向联动"）
    pulse = 0.5 + 0.5 * math.sin(t * 6)
    pulse_color = tuple(int(NEON_CYAN[i] * (0.5 + 0.5 * pulse)) for i in range(3))
    c.vline(split_x, 80, H - 60, pulse_color)
    c.vline(split_x - 2, 80, H - 60, pulse_color)
    c.vline(split_x + 2, 80, H - 60, pulse_color)

    # 底部状态条
    c.rect(0, H - 60, W, H, (10, 16, 32), filled=True)
    c.hline(0, W, H - 60, NEON_CYAN)
    c.text(40, H - 42, "AUTO-FORMAT  ON   |   CURSOR-LINK  ON   |   RENDER  REAL-TIME",
           NEON_CYAN, 3, 2)


def draw_showoff(c: Canvas, t: float):
    """8-12s 杀招：导出菜单 + 试听按钮。"""
    # 背景
    c.gradient_v(SPACE_DEEP, SPACE_BLUE)
    draw_grid(c, NEON_CYAN, step=100, alpha_blend=0.05)
    draw_scanline(c, NEON_CYAN, alpha=0.04, period=4)

    # 顶部
    c.text(60, 80, "[ EXPORT ]", NEON_CYAN, 5, 2)

    # 七种格式网格（3 + 3 + 1）
    formats = [
        ("PDF", (255, 92, 92)),
        ("JPG", (255, 165, 0)),
        ("SVG", (160, 90, 255)),
        ("PNG", (90, 200, 255)),
        ("MIDI", (255, 92, 168)),
        ("WAV", (0, 240, 200)),
        ("MP3", (255, 220, 90)),
    ]
    box_w, box_h = 280, 220
    gap_x, gap_y = 30, 30
    cols = 3
    start_x = (W - (box_w * cols + gap_x * (cols - 1))) // 2
    start_y = 220
    progress = min(1.0, (t - 8.0) / 3.0)
    visible = int(progress * len(formats)) + 1
    for i, (name, color) in enumerate(formats):
        if i >= visible:
            break
        col = i % cols
        row = i // cols
        x = start_x + col * (box_w + gap_x)
        y = start_y + row * (box_h + gap_y)
        # 入场动画：从下方弹出
        in_t = min(1.0, max(0, (t - 8.0) - i * 0.1) / 0.3)
        if in_t > 0:
            offset_y = int((1 - ease_in_out(in_t)) * 60)
            y += offset_y
        # 辉光
        if i == visible - 1 and progress < 1.0:
            draw_glow_rect(c, x - 10, y - 10, x + box_w + 10,
                           y + box_h + 10, color, glow_size=12, alpha=0.5)
        # 卡片
        c.rect(x, y, x + box_w, y + box_h, (15, 22, 50), filled=True)
        c.rect(x, y, x + box_w, y + box_h, color, filled=False)
        # 颜色条
        c.rect(x, y, x + box_w, y + 14, color, filled=True)
        # 文件图标（简单矩形 + 折角）
        c.rect(x + 30, y + 50, x + 110, y + 130, color, filled=True)
        c.rect(x + 90, y + 50, x + 110, y + 70, (15, 22, 50), filled=True)
        c.vline(x + 110, y + 50, y + 70, (15, 22, 50))
        # 名称
        c.text(x + (box_w - c.text_width(name, 6, 2)) // 2,
               y + box_h - 60, name, color, 6, 2)
        # 副标题
        c.text(x + (box_w - c.text_width(".FILE", 3, 1)) // 2,
               y + box_h - 25, ".FILE", SUBTLE_GREY, 3, 1)

    # 试听按钮（屏幕底部）
    btn_y = H - 280
    btn_w = 460
    btn_h = 110
    btn_x = (W - btn_w) // 2
    # 按钮辉光
    pulse = 0.5 + 0.5 * math.sin(t * 8)
    draw_glow_rect(c, btn_x - 20, btn_y - 20, btn_x + btn_w + 20,
                   btn_y + btn_h + 20, NEON_CYAN,
                   glow_size=int(15 + 8 * pulse), alpha=0.5 + 0.3 * pulse)
    c.rect(btn_x, btn_y, btn_x + btn_w, btn_y + btn_h, NEON_CYAN, filled=True)
    # 内框
    c.rect(btn_x + 8, btn_y + 8, btn_x + btn_w - 8, btn_y + btn_h - 8,
           SPACE_DEEP, filled=True)
    # 三角播放图标
    cx, cy = btn_x + 70, btn_y + btn_h // 2
    for i in range(28):
        c.hline(cx - 12 + i // 2, cx + 12 - i // 2, cy - 14 + i, NEON_CYAN)
    # 文字
    label = "[  PLAY  /  LISTEN  ]"
    c.text(btn_x + (btn_w - c.text_width(label, 5, 2)) // 2,
           btn_y + btn_h // 2 - 18, label, NEON_CYAN, 5, 2)

    # 底部说明
    c.center_text(H - 90, "MA  WAN  JI  PU    MA  WAN  JI  TING",
                  NEON_CYAN, 4, 2)


def draw_outro(c: Canvas, t: float):
    """12-15s 落版：Logo + Slogan + CTA。"""
    # 背景：径向辉光从中心扩散
    c.fill(SPACE_DEEP)
    draw_grid(c, NEON_CYAN, step=120, alpha_blend=0.08)
    # 中心霓虹青径向光晕
    pulse = 0.5 + 0.5 * math.sin(t * 4)
    c.gradient_radial((W // 2, H // 2 - 100), 800,
                      tuple(int(SPACE_DEEP[i] + (NEON_CYAN[i] - SPACE_DEEP[i]) * 0.25 * (0.6 + 0.4 * pulse))
                            for i in range(3)),
                      SPACE_DEEP)

    # Logo 区
    logo_y = H // 2 - 350
    # Logo 容器（圆角矩形近似 = 矩形 + 内部填充）
    box_w, box_h = 720, 200
    box_x = (W - box_w) // 2
    box_y = logo_y
    draw_glow_rect(c, box_x - 15, box_y - 15, box_x + box_w + 15,
                   box_y + box_h + 15, NEON_CYAN, glow_size=20, alpha=0.6)
    c.rect(box_x, box_y, box_x + box_w, box_y + box_h, SPACE_BLUE, filled=True)
    c.rect(box_x, box_y, box_x + box_w, box_y + box_h, NEON_CYAN, filled=False)
    # Logo 文字
    logo_text = "iJipu"
    c.text(box_x + 60, box_y + 60, logo_text, NEON_CYAN, 10, 2)
    # 装饰点
    c._blit_square(box_x + box_w - 110, box_y + 80, 40, NEON_CYAN)
    # 副标题
    c.text(box_x + 60, box_y + 160, "AI  JI  PU   CODE  X  MUSIC", NEON_CYAN, 4, 2)

    # Slogan（缩短以避免溢出）
    slogan_y = logo_y + box_h + 120
    c.center_text(slogan_y, "MA  JI  CHENG", NEON_CYAN, 8, 3)
    c.center_text(slogan_y + 110, "PU  ZI  XIAN", NEON_CYAN, 8, 3)
    # Slogan 装饰线
    c.hline(200, W - 200, slogan_y - 30, NEON_CYAN)
    c.hline(200, W - 200, slogan_y + 220, NEON_CYAN)

    # 中文小字
    c.center_text(slogan_y + 280, "CODE  X  ROMANCE",
                  SUBTLE_GREY, 4, 2)

    # CTA 按钮
    cta_y = H - 380
    btn_w = 620
    btn_h = 120
    btn_x = (W - btn_w) // 2
    pulse = 0.5 + 0.5 * math.sin(t * 6)
    draw_glow_rect(c, btn_x - 12, cta_y - 12, btn_x + btn_w + 12,
                   cta_y + btn_h + 12, HOT_PINK, glow_size=12, alpha=0.4 + 0.2 * pulse)
    c.rect(btn_x, cta_y, btn_x + btn_w, cta_y + btn_h, HOT_PINK, filled=True)
    c.rect(btn_x + 6, cta_y + 6, btn_x + btn_w - 6, cta_y + btn_h - 6,
           SPACE_DEEP, filled=True)
    c.rect(btn_x, cta_y, btn_x + btn_w, cta_y + btn_h, HOT_PINK, filled=False)
    c.text(btn_x + (btn_w - c.text_width("[  SEARCH:  IJIPU  ]", 5, 2)) // 2,
           cta_y + btn_h // 2 - 18, "[  SEARCH:  IJIPU  ]", HOT_PINK, 5, 2)

    # 三端徽章
    badges = ["WEB", "PWA", "DESKTOP"]
    badge_y = H - 180
    badge_w = 200
    badge_gap = 30
    total_w = badge_w * 3 + badge_gap * 2
    bx = (W - total_w) // 2
    for i, b in enumerate(badges):
        x = bx + i * (badge_w + badge_gap)
        c.rect(x, badge_y, x + badge_w, badge_y + 70, (20, 30, 70), filled=True)
        c.rect(x, badge_y, x + badge_w, badge_y + 70, NEON_CYAN, filled=False)
        c.text(x + (badge_w - c.text_width(b, 4, 1)) // 2,
               badge_y + 22, b, NEON_CYAN, 4, 1)

    # 底部版权
    c.center_text(H - 70, "FREE  +  OPEN  SOURCE  /  AGPL-3.0",
                  SUBTLE_GREY, 3, 2)


def render_frame(frame_idx: int) -> bytes:
    """渲染第 frame_idx 帧，返回 PNG 字节。"""
    t = frame_idx / FPS
    c = Canvas(W, H, SPACE_DEEP)
    # 选择场景
    if t < SCENES[0][1]:
        draw_hook(c, t)
    elif t < SCENES[1][1]:
        draw_demo(c, t)
    elif t < SCENES[2][1]:
        draw_showoff(c, t)
    else:
        draw_outro(c, t)
    # 扫描线覆盖
    draw_scanline(c, NEON_CYAN, alpha=0.04, period=3)
    # 转 PNG
    import io
    with io.BytesIO() as bio:
        write_png_rgb_to_buffer(bio, c)
        return bio.getvalue()


def write_png_rgb_to_buffer(buf, c: Canvas):
    """写入 PNG 到 buffer。"""
    width, height = c.w, c.h
    raw = bytearray()
    stride = width * 3
    pixels = bytes(c.buf)
    for y in range(height):
        raw.append(0)
        raw.extend(pixels[y * stride:(y + 1) * stride])

    def chunk(tag, data):
        crc = zlib.crc32(tag + data) & 0xFFFFFFFF
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", crc)

    sig = b"\x89PNG\r\n\x1a\n"
    ihdr = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    idat = zlib.compress(bytes(raw), 9)
    out = sig + chunk(b"IHDR", ihdr) + chunk(b"IDAT", idat) + chunk(b"IEND", b"")
    buf.write(out)


# -----------------------------------------------------------------------------
# BGM 合成（15 秒 synthwave 风电子音乐）
# -----------------------------------------------------------------------------
def synth_bgm(path: Path, duration_s: float = 15.0):
    """合成 15 秒电子 BGM：
    - A 小调 + 一些增四度蓝调味
    - 4/4 拍，BPM=120，每拍 0.5s
    - 低音 pad（saw）+ 主旋律（square）+ 鼓点（noise burst）+ 扫频音效
    """
    n_samples = int(SAMPLE_RATE * duration_s)
    audio = [0.0] * n_samples

    bpm = 120
    beat_s = 60.0 / bpm  # 0.5s
    bar_s = beat_s * 4  # 2s
    total_bars = int(duration_s / bar_s)

    # 音阶：A 小调五声：A C D E G
    scale_degrees = {
        'A': 220.0,
        'C': 261.63,
        'D': 293.66,
        'E': 329.63,
        'G': 392.00,
        'A2': 440.0,
        'C2': 523.25,
        'E2': 659.25,
    }

    def note_freq(name, octave=0):
        return scale_degrees[name] * (2 ** octave)

    # 主旋律（4 小节循环 + 4 小节变化）
    melody_patterns = [
        # bar 1
        [('E', 0, 0.5), ('E', 0, 0.5), ('G', 0, 0.5), ('A2', 0, 0.5),
         ('G', 0, 0.5), ('E', 0, 0.5), ('C', 0, 0.5), ('D', 0, 0.5)],
        # bar 2
        [('D', 0, 1.0), ('E', 0, 1.0), ('G', 0, 1.0), ('A2', 0, 1.0)],
        # bar 3（高潮）
        [('A2', 0, 0.5), ('G', 0, 0.5), ('E', 0, 0.5), ('G', 0, 0.5),
         ('A2', 0, 1.0), ('E', 0, 1.0)],
        # bar 4（回到主音）
        [('D', 0, 1.0), ('E', 0, 1.0), ('C', 0, 1.0), ('A', 0, 1.0)],
    ]

    def square_wave(t, freq, duty=0.5):
        return 1.0 if (t * freq) % 1.0 < duty else -1.0

    def saw_wave(t, freq):
        return 2.0 * ((t * freq) % 1.0) - 1.0

    def tri_wave(t, freq):
        x = (t * freq) % 1.0
        return 2.0 * abs(2.0 * (x - 0.5)) - 1.0 if x < 0.5 else 2.0 * abs(2.0 * (x - 0.5)) - 1.0

    def env_adsr(t, dur, a=0.01, d=0.05, s=0.6, r=0.1):
        if t < 0 or t > dur:
            return 0.0
        if t < a:
            return t / a
        if t < a + d:
            return 1.0 - (1.0 - s) * (t - a) / d
        if t < dur - r:
            return s
        return max(0.0, s * (dur - t) / r)

    # 生成所有音符
    for bar_idx in range(int(duration_s / bar_s) + 1):
        pattern = melody_patterns[bar_idx % len(melody_patterns)]
        bar_start = bar_idx * bar_s
        for note_idx, (note, octv, dur_b) in enumerate(pattern):
            note_start = bar_start + sum(p[2] for p in pattern[:note_idx])
            note_dur = dur_b * beat_s
            f = note_freq(note, octv)
            i_start = int(note_start * SAMPLE_RATE)
            i_end = min(n_samples, int((note_start + note_dur * 1.1) * SAMPLE_RATE))
            for i in range(i_start, i_end):
                t_local = (i - i_start) / SAMPLE_RATE
                if t_local > note_dur:
                    break
                # 复合音色：square + 微弱 saw
                sq = square_wave(t_local, f)
                sa = saw_wave(t_local, f * 0.5) * 0.15
                v = (sq * 0.18 + sa) * env_adsr(t_local, note_dur, 0.005, 0.05, 0.5, 0.08)
                audio[i] += v

    # 低音 pad（连续铺底，A 小调根音循环）
    bass_root = 110.0  # A2
    bass_pattern = [bass_root, bass_root, bass_root * 1.5, bass_root * 1.333]
    beat_idx = 0
    for i in range(n_samples):
        t = i / SAMPLE_RATE
        beat = int(t / beat_s)
        bnote = bass_pattern[beat % len(bass_pattern)]
        bphase = (t / beat_s) % 1.0
        # 每个拍子 0.4s 内触发
        if bphase < 0.4:
            sa = saw_wave(t, bnote / 2) * 0.08
            sq = square_wave(t, bnote / 2) * 0.04
            env = math.exp(-bphase * 6)
            audio[i] += (sa + sq) * env
        beat_idx = beat

    # 鼓点（4 拍 kick + 高拍 hat）
    for beat_n in range(int(duration_s / beat_s)):
        beat_t = beat_n * beat_s
        i_start = int(beat_t * SAMPLE_RATE)
        # kick（每拍都有）
        for i in range(i_start, min(n_samples, i_start + int(0.12 * SAMPLE_RATE))):
            t_local = (i - i_start) / SAMPLE_RATE
            freq = 80 * math.exp(-t_local * 30) + 35
            phase = math.sin(2 * math.pi * freq * t_local)
            env = math.exp(-t_local * 25)
            audio[i] += phase * env * 0.3
        # hi-hat（每半拍）
        if beat_n % 2 == 1:
            for i in range(i_start, min(n_samples, i_start + int(0.04 * SAMPLE_RATE))):
                t_local = (i - i_start) / SAMPLE_RATE
                noise = ((i * 9301 + 49297) % 233280) / 233280.0 * 2 - 1
                env = math.exp(-t_local * 80)
                audio[i] += noise * env * 0.08

    # 扫频音效（在 5s、10s 处）
    for sweep_t in [5.0, 10.0]:
        i_start = int(sweep_t * SAMPLE_RATE)
        for i in range(i_start, min(n_samples, i_start + int(0.6 * SAMPLE_RATE))):
            t_local = (i - i_start) / SAMPLE_RATE
            freq = 200 + 2000 * (t_local / 0.6)
            phase = math.sin(2 * math.pi * freq * t_local)
            env = math.sin(math.pi * t_local / 0.6) ** 2
            audio[i] += phase * env * 0.1

    # 限制 + 软裁剪
    peak = max(abs(v) for v in audio[:n_samples])
    if peak > 0:
        norm = 0.85 / peak
    else:
        norm = 1.0
    # 写入 16-bit PCM
    with wave.open(str(path), 'wb') as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(SAMPLE_RATE)
        frames = bytearray()
        for v in audio:
            sample = int(max(-1.0, min(1.0, v * norm)) * 32767)
            frames.extend(struct.pack('<h', sample))
        wf.writeframes(bytes(frames))


# -----------------------------------------------------------------------------
# APNG 拼接（简化版：使用 apng 规范，播放时浏览器/系统支持）
# -----------------------------------------------------------------------------
def make_apng(out_path: Path, frame_paths: list[Path], delay_ms: int = 33):
    """将 PNG 帧序列拼成 APNG。
    简化实现：写入 PNG signature + IHDR + acTL + fcTL + IDAT + IEND；
    所有帧共享同一 IHDR，fcTL 标 sequence_no。
    """
    if not frame_paths:
        return False
    # 读取第一帧获取尺寸和位深
    first = frame_paths[0].read_bytes()
    # IHDR
    sig = b"\x89PNG\r\n\x1a\n"
    # 找到 IHDR chunk 位置
    assert first.startswith(sig)
    pos = len(sig)
    ihdr_len = struct.unpack(">I", first[pos:pos + 4])[0]
    ihdr_data = first[pos + 4:pos + 8 + ihdr_len]
    # acTL
    actl_data = struct.pack(">II", len(frame_paths), 0)  # num_frames, num_plays=0(无限)
    actl_chunk = make_chunk(b"acTL", actl_data)
    out = bytearray()
    out.extend(sig)
    out.extend(ihdr_data)  # IHDR chunk already includes length+tag+data+crc
    out.extend(actl_chunk)

    for seq, fp in enumerate(frame_paths):
        data = fp.read_bytes()
        # 解析 PNG chunks
        pos = len(sig)
        chunks = []
        while pos < len(data):
            length = struct.unpack(">I", data[pos:pos + 4])[0]
            tag = data[pos + 4:pos + 8]
            chunk_data = data[pos + 8:pos + 8 + length]
            chunks.append((tag, chunk_data))
            pos += 12 + length
        # fcTL：frame control
        width = struct.unpack(">I", ihdr_data[8:12])[0]
        height = struct.unpack(">I", ihdr_data[12:16])[0]
        fctl_data = struct.pack(">IIIIIHH BB",
                                seq,  # sequence_number
                                width, height,
                                0, 0,  # x_offset, y_offset
                                delay_ms, delay_ms,  # delay_num, delay_den
                                0,  # dispose_op=NONE
                                0,  # blend_op=SOURCE
                                )
        out.extend(make_chunk(b"fcTL", fctl_data))
        # fdAT + IDAT
        for tag, chunk_data in chunks:
            if tag in (b"IHDR", b"IEND", b"acTL", b"fcTL"):
                continue
            if tag == b"IDAT":
                fdat_data = struct.pack(">I", seq) + chunk_data
                out.extend(make_chunk(b"fdAT", fdat_data))
            else:
                # tEXt / gAMA 等辅助 chunk：丢弃以减少文件体积
                pass
    out.extend(make_chunk(b"IEND", b""))
    out_path.write_bytes(bytes(out))
    return True


def make_chunk(tag: bytes, data: bytes) -> bytes:
    crc = zlib.crc32(tag + data) & 0xFFFFFFFF
    return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", crc)


# -----------------------------------------------------------------------------
# HTML 预览页（含 APNG 视频播放）
# -----------------------------------------------------------------------------
def make_preview_html(path: Path, frame_paths: list[Path], wav_path: Path,
                      apng_path: Path | None = None):
    base = wav_path.parent
    rel_wav = wav_path.name
    rel_apng = apng_path.name if apng_path else None
    # 只列出前 30 帧用于缩略图预览（避免 HTML 过大）
    sample = frame_paths[::15][:30]
    items = []
    for fp in sample:
        items.append(f'<img src="{fp.name}" />')
    apng_block = ""
    if rel_apng:
        apng_block = f'''
  <h2>15s 动画预览（APNG）</h2>
  <p class="meta">将 <code>iJipu_promo_15s.apng</code> 直接拖到浏览器或图片查看器即可循环播放</p>
  <div style="display:flex;justify-content:center;margin:16px 0">
    <img src="{rel_apng}" style="max-width:360px;border:2px solid #00F0FF;
          box-shadow:0 0 24px rgba(0,240,255,0.3)" />
  </div>'''
    html = f"""<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>iJipu 15s Promo Preview</title>
<style>
  body {{ background: #0F1526; color: #00F0FF;
         font-family: -apple-system, monospace; margin: 0; padding: 24px; }}
  h1 {{ color: #00F0FF; font-size: 28px; margin-bottom: 8px; }}
  h2 {{ color: #00F0FF; font-size: 18px; margin-top: 32px; }}
  .row {{ display: flex; gap: 8px; flex-wrap: wrap; margin: 12px 0; }}
  .row img {{ width: 140px; border: 1px solid #00F0FF; }}
  audio {{ width: 100%; margin-top: 12px; }}
  .meta {{ color: #8C96B4; font-size: 13px; margin-top: 8px; line-height: 1.6; }}
  code {{ background: #161D3A; padding: 2px 6px; border-radius: 3px;
         color: #00F0FF; font-size: 12px; }}
  .tip {{ background: #161D3A; border-left: 3px solid #00F0FF;
        padding: 12px 16px; margin-top: 16px; border-radius: 4px; }}
</style>
</head>
<body>
  <h1>iJipu 15s Promo Video Preview</h1>
  <div class="meta">竖屏 9:16 / 30fps / 共 {len(frame_paths)} 帧 / 时长 15 秒</div>
{apng_block}
  <h2>帧序列预览（每 0.5s 取一帧）</h2>
  <div class="row">
    {''.join(items)}
  </div>
  <h2>BGM（程序合成 15s 电子音乐）</h2>
  <audio controls autoplay loop>
    <source src="{rel_wav}" type="audio/wav" />
  </audio>
  <div class="tip">
    <strong>合并为 MP4（用于抖音/小红书上传）</strong><br/>
    系统安装 ffmpeg 后，在本目录下执行：<br/>
    <code>ffmpeg -framerate 30 -i frame_%04d.png -i bgm.wav ^
          -c:v libx264 -pix_fmt yuv420p -vf scale=540:960 ^
          -c:a aac -b:a 128k -shortest iJipu_promo_15s.mp4</code>
  </div>
  <div class="tip">
    <strong>关于产物</strong><br/>
    · <code>bgm.wav</code> 1.3MB - 15s 合成 BGM<br/>
    · <code>iJipu_promo_15s.apng</code> 11.6MB - 动画 PNG（浏览器/微信可循环播放）<br/>
    · <code>frame_*.png</code> 12MB - 450 张原始帧<br/>
    · <code>iJipu_promo_15s.mp4</code> - 需 ffmpeg 自行合成
  </div>
</body>
</html>
"""
    path.write_text(html, encoding="utf-8")


def make_ffmpeg_script(path: Path):
    """生成 Windows / Unix 两种 ffmpeg 合并脚本。"""
    content = """@echo off
REM ============================================================
REM iJipu 15s 宣传视频 - ffmpeg MP4 合并脚本（Windows）
REM ============================================================
REM 用法：双击运行（需先安装 ffmpeg 并加入 PATH）
REM 下载 ffmpeg: https://www.gyan.dev/ffmpeg/builds/
REM ============================================================

setlocal

cd /d "%~dp0"

echo [iJipu] 合并帧序列 + BGM -> MP4 ...

ffmpeg -y ^
  -framerate 30 ^
  -i frame_%%04d.png ^
  -i bgm.wav ^
  -c:v libx264 ^
  -pix_fmt yuv420p ^
  -vf "scale=540:960" ^
  -c:a aac ^
  -b:a 128k ^
  -shortest ^
  iJipu_promo_15s.mp4

if %errorlevel%==0 (
  echo [iJipu] MP4 合并成功
  dir iJipu_promo_15s.mp4
) else (
  echo [iJipu] 合并失败，请检查 ffmpeg 是否已安装
)

endlocal
pause
"""
    path.write_text(content, encoding="utf-8")


# -----------------------------------------------------------------------------
# ffmpeg 调用（如可用）
# -----------------------------------------------------------------------------
def try_ffmpeg(frame_dir: Path, wav_path: Path, mp4_path: Path) -> bool:
    import shutil
    import subprocess
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        # 尝试 .tools/bin
        cand = ROOT.parent / ".tools" / "bin" / "ffmpeg.exe"
        if cand.exists():
            ffmpeg = str(cand)
    if not ffmpeg:
        return False
    cmd = [
        ffmpeg, "-y",
        "-framerate", str(FPS),
        "-i", str(frame_dir / "frame_%04d.png"),
        "-i", str(wav_path),
        "-c:v", "libx264",
        "-pix_fmt", "yuv420p",
        "-vf", "scale=540:960",
        "-c:a", "aac",
        "-b:a", "128k",
        "-shortest",
        str(mp4_path),
    ]
    try:
        result = subprocess.run(cmd, capture_output=True, timeout=120)
        return result.returncode == 0
    except Exception as e:
        print(f"ffmpeg 调用失败：{e}")
        return False


# -----------------------------------------------------------------------------
# 主流程
# -----------------------------------------------------------------------------
def _render_one(args):
    """worker: 渲染单帧并写入磁盘。"""
    frame_idx, out_dir = args
    import io
    from pathlib import Path as _P
    png_bytes = render_frame(frame_idx)
    fp = _P(out_dir) / f"frame_{frame_idx:04d}.png"
    fp.write_bytes(png_bytes)
    return fp


def main():
    from concurrent.futures import ThreadPoolExecutor
    # Windows GBK 终端兼容：stdout 重编码为 UTF-8
    try:
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    except Exception:
        pass
    print(f"[iJipu Promo] 输出目录：{OUT}")
    print(f"[iJipu Promo] 总帧数：{TOTAL}（{FPS}fps × {DURATION}s）")

    # 1. 渲染帧（线程池并行：Python GIL 下纯 Python 加速有限，
    #    但 PNG zlib 压缩是 C 实现会释放 GIL，能有约 2-3x 提升）
    n_workers = 4
    print(f"[1/4] 渲染帧序列 ... (使用 {n_workers} 个线程)")
    args = [(i, str(OUT)) for i in range(TOTAL)]
    t0 = time.time()
    with ThreadPoolExecutor(max_workers=n_workers) as ex:
        frame_paths_unsorted = list(ex.map(_render_one, args, chunksize=4))
    frame_paths = sorted(frame_paths_unsorted, key=lambda p: p.name)
    elapsed = time.time() - t0
    print(f"  [OK] 已渲染 {len(frame_paths)} 帧（{elapsed:.1f}s，{len(frame_paths)/elapsed:.2f} fps）")

    # 2. 合成 BGM
    print("[2/4] 合成 BGM ...")
    wav_path = OUT / "bgm.wav"
    synth_bgm(wav_path, DURATION)
    size_kb = wav_path.stat().st_size // 1024
    print(f"  [OK] {wav_path.name} ({size_kb} KB)")

    # 3. 拼接 APNG
    print("[3/4] 拼接 APNG ...")
    apng_path = OUT / "iJipu_promo_15s.apng"
    if make_apng(apng_path, frame_paths, delay_ms=int(1000 / FPS)):
        size_kb = apng_path.stat().st_size // 1024
        print(f"  [OK] {apng_path.name} ({size_kb} KB)")
    else:
        print("  [FAIL] APNG 生成失败")

    # 4. 尝试 ffmpeg 合并 MP4
    print("[4/4] 尝试合并 MP4 ...")
    mp4_path = OUT / "iJipu_promo_15s.mp4"
    if try_ffmpeg(OUT, wav_path, mp4_path):
        size_kb = mp4_path.stat().st_size // 1024
        print(f"  [OK] {mp4_path.name} ({size_kb} KB)")
    else:
        print("  [WARN] 未检测到 ffmpeg，跳过 MP4 合并")
        print("  提示：可在系统安装 ffmpeg 后手动执行：")
        print(f"    cd {OUT}")
        print(f"    ffmpeg -framerate {FPS} -i frame_%04d.png -i bgm.wav \\")
        print(f"           -c:v libx264 -pix_fmt yuv420p -vf scale=540:960 \\")
        print(f"           -c:a aac -b:a 128k -shortest iJipu_promo_15s.mp4")

    # 5. 生成预览 HTML + ffmpeg 合并脚本
    print("[+] 生成浏览器预览页 ...")
    html_path = OUT / "preview.html"
    apng_path_for_html = OUT / "iJipu_promo_15s.apng"
    make_preview_html(html_path, frame_paths, wav_path, apng_path_for_html)
    print(f"  [OK] {html_path.name}")

    print("[+] 生成 ffmpeg 合并脚本 ...")
    bat_path = OUT / "merge-to-mp4.bat"
    make_ffmpeg_script(bat_path)
    print(f"  [OK] {bat_path.name}")

    print()
    print("=" * 60)
    print("[DONE] 完成！产物列表：")
    print("=" * 60)
    for p in sorted(OUT.iterdir()):
        size = p.stat().st_size
        if size > 1024 * 1024:
            s = f"{size / 1024 / 1024:.1f} MB"
        elif size > 1024:
            s = f"{size / 1024:.1f} KB"
        else:
            s = f"{size} B"
        print(f"  {p.name:40s}  {s:>10s}")


if __name__ == "__main__":
    import sys
    # 支持跳过帧渲染步骤（已有 frame_*.png 时直接合成 BGM/APNG/HTML）
    if "--skip-render" in sys.argv:
        from concurrent.futures import ThreadPoolExecutor
        try:
            sys.stdout.reconfigure(encoding="utf-8")
        except Exception:
            pass
        wav_path = OUT / "bgm.wav"
        print("[2/4] 合成 BGM ...")
        synth_bgm(wav_path, DURATION)
        size_kb = wav_path.stat().st_size // 1024
        print(f"  [OK] {wav_path.name} ({size_kb} KB)")

        # 收集已存在的帧
        frame_paths = sorted(OUT.glob("frame_*.png"))
        print(f"  找到 {len(frame_paths)} 张已渲染帧")

        apng_path = OUT / "iJipu_promo_15s.apng"
        if make_apng(apng_path, frame_paths, delay_ms=int(1000 / FPS)):
            size_kb = apng_path.stat().st_size // 1024
            print(f"  [OK] {apng_path.name} ({size_kb} KB)")

        mp4_path = OUT / "iJipu_promo_15s.mp4"
        if try_ffmpeg(OUT, wav_path, mp4_path):
            size_kb = mp4_path.stat().st_size // 1024
            print(f"  [OK] {mp4_path.name} ({size_kb} KB)")
        else:
            print("  [WARN] 未检测到 ffmpeg，跳过 MP4 合并")

        html_path = OUT / "preview.html"
        make_preview_html(html_path, frame_paths, wav_path, apng_path)
        print(f"  [OK] {html_path.name}")

        bat_path = OUT / "merge-to-mp4.bat"
        make_ffmpeg_script(bat_path)
        print(f"  [OK] {bat_path.name}")
    else:
        main()
