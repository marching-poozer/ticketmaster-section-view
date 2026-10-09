#!/usr/bin/env python3
"""
generate-icons.py
Generates the extension's PNG icons (16, 48, 128px) with no dependencies.
Run: python3 generate-icons.py

The icon is a blue rounded square showing a page with a white side panel
(three "section" rows) docked on its right.
"""
import struct
import zlib

BLUE = (2, 108, 223)
WHITE = (255, 255, 255)
PALE = (140, 190, 240)
SS = 8  # supersampling factor for anti-aliasing


def in_round_rect(x, y, x0, y0, x1, y1, r):
    if not (x0 <= x <= x1 and y0 <= y <= y1):
        return False
    cx = min(max(x, x0 + r), x1 - r)
    cy = min(max(y, y0 + r), y1 - r)
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r


def shade(x, y):
    """Colour at unit-square point (x, y), or None for transparent."""
    if not in_round_rect(x, y, 0.0, 0.0, 1.0, 1.0, 0.22):
        return None
    # side panel
    if in_round_rect(x, y, 0.50, 0.14, 0.88, 0.86, 0.06):
        for top in (0.24, 0.43, 0.62):
            if in_round_rect(x, y, 0.56, top, 0.82, top + 0.12, 0.03):
                return BLUE
        return WHITE
    # faded "page" content on the left
    for top in (0.24, 0.43, 0.62):
        if in_round_rect(x, y, 0.14, top, 0.42, top + 0.12, 0.03):
            return PALE
    return BLUE


def render(size):
    rows = []
    for py in range(size):
        row = bytearray([0])  # PNG filter type 0
        for px in range(size):
            r = g = b = a = 0
            for sy in range(SS):
                for sx in range(SS):
                    c = shade((px + (sx + 0.5) / SS) / size, (py + (sy + 0.5) / SS) / size)
                    if c:
                        r += c[0]; g += c[1]; b += c[2]; a += 1
            n = SS * SS
            if a:
                row += bytes((r // a, g // a, b // a, a * 255 // n))
            else:
                row += bytes((0, 0, 0, 0))
        rows.append(bytes(row))
    return b"".join(rows)


def png(size):
    def chunk(tag, data):
        body = tag + data
        return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body) & 0xFFFFFFFF)

    ihdr = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)
    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", ihdr)
        + chunk(b"IDAT", zlib.compress(render(size), 9))
        + chunk(b"IEND", b"")
    )


for s in (16, 48, 128):
    with open(f"icons/icon{s}.png", "wb") as f:
        f.write(png(s))
    print(f"icons/icon{s}.png")
