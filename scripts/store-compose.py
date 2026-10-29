"""Composes the App Store screenshots: each raw capture from store-shots.mjs set in a
phone with a heavy bezel, tilted a few degrees, over a slab of one of the icon's four
compartment colors on the app's ground color, under a short headline, at 1320x2868 (the
6.9-inch slot; App Store Connect scales it for smaller phones). The first three are drawn
as one wide scene and cut into three, because search results show them side by side.
Fonts are the app's own, checked in under store/ (Familjen Grotesk and Karla, both under
the SIL Open Font License, from Google Fonts). Run by scripts/store-shots.mjs."""
from PIL import Image, ImageDraw, ImageFont, ImageFilter
import os

OUT = 'store/screenshots'
W, H = 1320, 2868
GROUND = (0xE9, 0xEE, 0xE6)          # the page color, the canvas
INK = (0x16, 0x24, 0x1E)             # the headline and the bezel
INK2 = (0x3E, 0x4D, 0x45)            # the line under the headline
# The icon's four compartment colors (HANDBOOK.md, The brand): main, side, fruit, sweet.
BACKS = [(0x2A, 0x51, 0x41), (0x6A, 0x40, 0x07), (0x84, 0x27, 0x3E), (0x50, 0x3E, 0x7E)]
BAND = 3            # the first three run as one scene: search results show them side by side
HEAD_FONT = 'store/FamiljenGrotesk-Bold.ttf'
SUB = ImageFont.truetype('store/Karla-Medium.ttf', 54)

# (raw capture, output name, headline, one line under it). The headline is two lines at most:
# the first three screenshots sit side by side in search results at a third of this width.
SHOTS = [
    ('week',    '01-week',    'A week of lunches\nin a minute.',    'Five boxes, matched so they go together.'),
    ('pack',    '02-pack',    'Mornings:\none box, one check.',     'Today’s box, and the week coming up.'),
    ('kidpick', '03-kidpick', 'Hand them\nthe phone.',              'They pick. It’s already on the shopping list.'),
    ('shop',    '04-shop',    'The list\nwrites itself.',           'Grouped by aisle. Send it to Notes or as a text.'),
    ('recipes', '05-recipes', 'Keep every recipe\nyou find.',        'Paste a link, or the words under a reel.'),
    ('cook',    '06-cook',    'Cook it one step\nat a time.',       'Check off each ingredient as it goes in.'),
    ('setup',   '07-rules',   'Your school’s rules,\nrespected.',   'Nut free, no microwave, a short lunch. Flagged, never dropped.'),
    ('foods',   '08-foods',   'Foods they’ll\nactually eat.',       'Start from what parents pack.'),
]

SCREEN_W = 960      # the screen inside the bezel; every phone is the same size, and runs just off the bottom
BEZEL = 26
TILT = 5            # degrees; alternates sign down the set so three in a row read as a set, not a wall
MARGIN = 90
PHONE_TOP = 700     # where the bezel's top lands; the headline block ends above it

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

def caption(canvas, x, head, sub):
    d = ImageDraw.Draw(canvas)
    font, lines, size = headline(d, head, W - 2 * MARGIN)
    y = 140
    for line in lines:
        d.text((x + MARGIN, y), line, font=font, fill=INK); y += int(size * 1.08)
    y += 30
    for line in wrap(d, sub, SUB, W - 2 * MARGIN):
        d.text((x + MARGIN, y), line, font=SUB, fill=INK2); y += 68

def rounded(im, r):
    mask = Image.new('L', im.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, im.width - 1, im.height - 1], r, fill=255)
    out = Image.new('RGBA', im.size, (0, 0, 0, 0)); out.paste(im, (0, 0), mask); return out

PAD = 160           # room around the phone for the shadow's blur

def phone(raw, sign):
    """The capture in a bezel, with its shadow, tilted, as one RGBA layer."""
    shot = Image.open(os.path.join(OUT, 'raw-' + raw + '.png')).convert('RGB')
    sw = SCREEN_W; sh = int(shot.height * sw / shot.width)
    screen = rounded(shot.resize((sw, sh), Image.LANCZOS), 88)
    fw, fh = sw + 2 * BEZEL, sh + 2 * BEZEL
    layer = Image.new('RGBA', (fw + 2 * PAD, fh + 2 * PAD), (0, 0, 0, 0))
    shadow = Image.new('RGBA', layer.size, (0, 0, 0, 0))
    ImageDraw.Draw(shadow).rounded_rectangle([PAD, PAD + 50, PAD + fw, PAD + fh + 50], 112, fill=(0, 0, 0, 120))
    layer.alpha_composite(shadow.filter(ImageFilter.GaussianBlur(44)))
    ImageDraw.Draw(layer).rounded_rectangle([PAD, PAD, PAD + fw, PAD + fh], 112, fill=INK + (255,))
    layer.alpha_composite(screen, (PAD + BEZEL, PAD + BEZEL))
    return layer.rotate(sign * TILT, resample=Image.BICUBIC, expand=True)

def place(canvas, layer, cx):
    """The phone centered on cx, its bezel's top near PHONE_TOP."""
    canvas.paste(layer, (cx - layer.width // 2, PHONE_TOP - PAD), layer)

def slab(canvas, color, angle, cy, width):
    """A compartment-colored slab, tilted, running off the sides and the bottom: color behind
    the phone, not all over the page."""
    layer = Image.new('RGBA', (width, int(H * 0.75)), (0, 0, 0, 0))
    ImageDraw.Draw(layer).rounded_rectangle([0, 0, layer.width - 1, layer.height - 1], 140, fill=color + (255,))
    layer = layer.rotate(angle, resample=Image.BICUBIC, expand=True)
    canvas.paste(layer, ((canvas.width - layer.width) // 2, cy - layer.height // 2), layer)

missing = [r for r, *_ in SHOTS if not os.path.exists(os.path.join(OUT, 'raw-' + r + '.png'))]
if missing: raise SystemExit('missing raw captures: ' + ', '.join(missing))

# The first three: one scene, BAND frames wide. The phones lean in and cross the cuts a little,
# the middle one on top, so the row in search results reads as one picture.
wide = Image.new('RGB', (W * BAND, H), GROUND)
slab(wide, BACKS[0], 6, int(H * 0.8), int(W * BAND * 1.3))
for i in range(BAND): caption(wide, i * W, SHOTS[i][2], SHOTS[i][3])
centers = [int(W * 0.65), int(W * 1.5), int(W * 2.45)]   # the first leans into the second frame; the third stays whole, its screen reads from the left edge
layers = [phone(SHOTS[i][0], 1 if i % 2 == 0 else -1) for i in range(BAND)]
for i in (0, 2, 1): place(wide, layers[i], centers[i])
for i in range(BAND):
    wide.crop((i * W, 0, (i + 1) * W, H)).save(os.path.join(OUT, SHOTS[i][1] + '.png'), optimize=True)
    print('composed', SHOTS[i][1])
wide.resize((W * BAND // 3, H // 3)).save('/private/tmp/claude-501/-Users-lizkronzek-lunch-sorted/5ba8f9d4-3a70-4bef-bc17-eafc058fa828/scratchpad/wide.png') if os.environ.get('WIDE_PREVIEW') else None

# The rest: one frame each, the slab's color and tilt alternating.
for i in range(BAND, len(SHOTS)):
    raw, name, head, sub = SHOTS[i]
    sign = 1 if i % 2 == 0 else -1
    canvas = Image.new('RGB', (W, H), GROUND)
    slab(canvas, BACKS[(i - BAND + 1) % len(BACKS)], sign * 9, int(H * 0.86), int(W * 1.6))
    caption(canvas, 0, head, sub)
    place(canvas, phone(raw, sign), W // 2)
    canvas.save(os.path.join(OUT, name + '.png'), optimize=True)
    print('composed', name)
