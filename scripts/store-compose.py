"""Composes the App Store screenshots: each raw capture from store-shots.mjs set in a
phone with a heavy bezel, tilted a few degrees, on one of the brand's compartment
colors, under a short headline, at 1320x2868 (the 6.9-inch slot; App Store Connect
scales it for smaller phones). Fonts are the app's own, checked in under store/
(Familjen Grotesk and Karla, both under the SIL Open Font License, from Google Fonts).
Run by scripts/store-shots.mjs."""
from PIL import Image, ImageDraw, ImageFont, ImageFilter
import os

OUT = 'store/screenshots'
W, H = 1320, 2868
GROUND = (0xE9, 0xEE, 0xE6)          # the page color, the canvas
INK = (0x16, 0x24, 0x1E)             # the headline and the bezel
INK2 = (0x3E, 0x4D, 0x45)            # the line under the headline
# The compartment colors (HANDBOOK.md, The brand): main, side, fruit, sweet, snack, drink.
BACKS = [(0x2A, 0x51, 0x41), (0x6A, 0x40, 0x07), (0x84, 0x27, 0x3E), (0x50, 0x3E, 0x7E), (0x44, 0x4E, 0x14), (0x20, 0x4E, 0x62)]
HEAD_FONT = 'store/FamiljenGrotesk-Bold.ttf'
SUB = ImageFont.truetype('store/Karla-Medium.ttf', 54)

# (raw capture, output name, headline, one line under it). The headline is two lines at most:
# the first three screenshots sit side by side in search results at a third of this width.
SHOTS = [
    ('week',    '01-week',    'A week of lunches\nin a minute.',    'Five boxes, matched so they go together.'),
    ('pack',    '02-pack',    'Mornings:\none box, one check.',     'Today’s box, and the week coming up.'),
    ('kidpick', '03-kidpick', 'Hand them\nthe phone.',              'They pick. It’s already on the shopping list.'),
    ('shop',    '04-shop',    'The list\nwrites itself.',           'Grouped by aisle. Send it to Notes or as a text.'),
    ('recipes', '05-recipes', 'Recipes that make\nsix lunches.',     'Two come free. Paste in your own.'),
    ('cook',    '06-cook',    'Cook it one step\nat a time.',       'Check off each ingredient as it goes in.'),
    ('setup',   '07-rules',   'Your school’s rules,\nrespected.',   'Nut free, no microwave, a short lunch. Flagged, never dropped.'),
    ('foods',   '08-foods',   'Foods they’ll\nactually eat.',       'Start from what parents pack.'),
]
CROP_BOT = {}                 # (name: raw pixels off the bottom); the cook sheet's empty ground reads as screen inside the bezel
CROP_TOP = {'kidpick': 320}   # (name: raw pixels off the top) the kid's pick fills its screen exactly

SCREEN_W = 880      # the screen inside the bezel; the phone then fits the canvas whole, tilted
BEZEL = 26
TILT = 5            # degrees; alternates sign down the set so three in a row read as a set, not a wall
MARGIN = 90

def wrap(draw, text, font, width):
    lines = []
    for para in text.split('\n'):
        words, line = para.split(' '), ''
        for w in words:
            t = (line + ' ' + w).strip()
            if draw.textlength(t, font=font) <= width: line = t
            else: lines.append(line); line = w
        lines.append(line)
    return lines

def headline(draw, text, width):
    """The biggest size at which the headline is two lines or fewer."""
    for size in range(150, 100, -4):
        font = ImageFont.truetype(HEAD_FONT, size)
        lines = wrap(draw, text, font, width)
        if len(lines) <= 2: return font, lines, size
    return font, lines, size

def rounded(im, r):
    mask = Image.new('L', im.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, im.width - 1, im.height - 1], r, fill=255)
    out = Image.new('RGBA', im.size, (0, 0, 0, 0)); out.paste(im, (0, 0), mask); return out

def phone(shot):
    """The capture in a bezel, with its shadow, as one RGBA layer."""
    sw = SCREEN_W; sh = int(shot.height * sw / shot.width)
    screen = rounded(shot.resize((sw, sh), Image.LANCZOS), 88)
    fw, fh = sw + 2 * BEZEL, sh + 2 * BEZEL
    pad = 160                                           # room for the shadow's blur
    layer = Image.new('RGBA', (fw + 2 * pad, fh + 2 * pad), (0, 0, 0, 0))
    shadow = Image.new('RGBA', layer.size, (0, 0, 0, 0))
    ImageDraw.Draw(shadow).rounded_rectangle([pad, pad + 50, pad + fw, pad + fh + 50], 112, fill=(0, 0, 0, 120))
    shadow = shadow.filter(ImageFilter.GaussianBlur(44))
    layer.alpha_composite(shadow)
    ImageDraw.Draw(layer).rounded_rectangle([pad, pad, pad + fw, pad + fh], 112, fill=INK + (255,))
    layer.alpha_composite(screen, (pad + BEZEL, pad + BEZEL))
    return layer

def slab(canvas, color, sign):
    """A compartment-colored slab behind the lower part of the phone, tilted the phone's way
    and running off the sides and the bottom: color behind the phone, not all over the page."""
    layer = Image.new('RGBA', (int(W * 1.6), int(H * 0.8)), (0, 0, 0, 0))
    ImageDraw.Draw(layer).rounded_rectangle([0, 0, layer.width - 1, layer.height - 1], 140, fill=color + (255,))
    layer = layer.rotate(sign * 9, resample=Image.BICUBIC, expand=True)
    canvas.paste(layer, ((W - layer.width) // 2, int(H * 0.46)), layer)

for i, (raw, name, head, sub) in enumerate(SHOTS):
    src = os.path.join(OUT, 'raw-' + raw + '.png')
    if not os.path.exists(src): print('missing', src); continue
    shot = Image.open(src).convert('RGB')
    if raw in CROP_TOP: shot = shot.crop((0, CROP_TOP[raw], shot.width, shot.height))
    if raw in CROP_BOT: shot = shot.crop((0, 0, shot.width, shot.height - CROP_BOT[raw]))
    canvas = Image.new('RGB', (W, H), GROUND); d = ImageDraw.Draw(canvas)
    font, lines, size = headline(d, head, W - 2 * MARGIN)
    y = 140
    for line in lines:
        d.text((MARGIN, y), line, font=font, fill=INK); y += int(size * 1.08)
    y += 30
    for line in wrap(d, sub, SUB, W - 2 * MARGIN):
        d.text((MARGIN, y), line, font=SUB, fill=INK2); y += 68
    sign = 1 if i % 2 == 0 else -1
    slab(canvas, BACKS[i % len(BACKS)], sign)
    layer = phone(shot).rotate(sign * TILT, resample=Image.BICUBIC, expand=True)
    top = max(y + 60, 700)
    canvas.paste(layer, ((W - layer.width) // 2, top - 160), layer)
    canvas.save(os.path.join(OUT, name + '.png'), optimize=True)
    print('composed', name, size)
