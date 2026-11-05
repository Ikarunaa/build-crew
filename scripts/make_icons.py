"""Draws the toolbar icons (three coloured cursors on a dark tile) as PNGs.

Pure standard library, so it runs anywhere: python3 scripts/make_icons.py
"""
import os
import struct
import zlib

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, '..', 'extension', 'icons')

# Cursor arrow outline in a 24x24 box.
ARROW = [(3, 2), (3, 19), (8, 14.5), (11.5, 22), (14.6, 20.6), (11.2, 13.3), (18, 13.3)]
CURSORS = [  # (offset x, offset y, scale, colour)
    (0.06, 0.08, 0.040, (77, 212, 255)),
    (0.40, 0.22, 0.034, (255, 92, 122)),
    (0.22, 0.48, 0.030, (255, 224, 102)),
]
BG = (18, 18, 26)


def inside(px, py, poly):
    hit = False
    j = len(poly) - 1
    for i in range(len(poly)):
        xi, yi = poly[i]
        xj, yj = poly[j]
        if (yi > py) != (yj > py) and px < (xj - xi) * (py - yi) / (yj - yi) + xi:
            hit = not hit
        j = i
    return hit


def rounded(px, py, size, r):
    cx = min(max(px, r), size - r)
    cy = min(max(py, r), size - r)
    return (px - cx) ** 2 + (py - cy) ** 2 <= r * r


def render(size):
    ss = 4  # supersampling
    rows = []
    for y in range(size):
        row = bytearray([0])
        for x in range(size):
            acc = [0, 0, 0, 0]
            for sy in range(ss):
                for sx in range(ss):
                    px = x + (sx + 0.5) / ss
                    py = y + (sy + 0.5) / ss
                    if not rounded(px, py, size, size * 0.22):
                        continue
                    colour = BG
                    for ox, oy, sc, col in CURSORS:
                        u = (px - ox * size) / (sc * size)
                        v = (py - oy * size) / (sc * size)
                        if inside(u, v, ARROW):
                            colour = col
                    acc[0] += colour[0]
                    acc[1] += colour[1]
                    acc[2] += colour[2]
                    acc[3] += 255
            n = ss * ss
            a = acc[3] // n
            if a:
                row += bytes([acc[0] * 255 // acc[3], acc[1] * 255 // acc[3], acc[2] * 255 // acc[3], a])
            else:
                row += bytes([0, 0, 0, 0])
        rows.append(bytes(row))
    raw = b''.join(rows)

    def chunk(tag, data):
        c = struct.pack('>I', len(data)) + tag + data
        return c + struct.pack('>I', zlib.crc32(tag + data) & 0xFFFFFFFF)

    return (b'\x89PNG\r\n\x1a\n'
            + chunk(b'IHDR', struct.pack('>IIBBBBB', size, size, 8, 6, 0, 0, 0))
            + chunk(b'IDAT', zlib.compress(raw, 9))
            + chunk(b'IEND', b''))


if __name__ == '__main__':
    os.makedirs(OUT, exist_ok=True)
    for s in (16, 48, 128):
        with open(os.path.join(OUT, f'icon{s}.png'), 'wb') as f:
            f.write(render(s))
    print('icons written to', os.path.normpath(OUT))
