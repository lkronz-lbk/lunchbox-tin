"""Composes the App Store screenshots at 1320x2868 (the 6.9-inch slot; App Store Connect
scales it for smaller phones): each raw capture from store-shots.mjs in a phone with a heavy
bezel, at a real angle and large enough that the screen reads, running off the frame, on the
app's ground color with a slab of one of the icon's four compartment colors behind. The first
three are one scene three frames wide, cut in three, because search results show them side by
side: the phones cross the cuts and overlap, the way one picture does. Fonts are the app's own,
checked in under store/ (Familjen Grotesk and Karla, SIL Open Font License). Run by
scripts/store-shots.mjs."""
from PIL import Image, ImageDraw, ImageFont, ImageFilter
import os

OUT = 'store/screenshots'
W, H = 1320, 2868
GROUND = (0xE9, 0xEE, 0xE6)          # the page color, the canvas
INK = (0x16, 0x24, 0x1E)             # the headline's second line and the bezel
INK2 = (0x3E, 0x4D, 0x45)            # the line under the headline
# The icon's four compartment colors (HANDBOOK.md, The brand): main, side, fruit, sweet.
BACKS = [(0x2A, 0x51, 0x41), (0x6A, 0x40, 0x07), (0x84, 0x27, 0x3E), (0x50, 0x3E, 0x7E)]
BAND = 3            # the first three run as one scene
HEAD_FONT = 'store/FamiljenGrotesk-Bold.ttf'
SUB = ImageFont.truetype('store/Karla-Medium.ttf', 54)

# (raw capture, output name, headline, one line under it). The headline is two lines at most;
# its first line takes the frame's color, the second the ink.
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
CROP_TOP = {'kidpick': 320}   # raw pixels off the top: the pick starts at its question, the phone runs off the bottom anyway

BEZEL = 28
MARGIN = 90
PAD = 200                     # room around a phone for its shadow's blur

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
    for size in range(156, 100, -4):
        font = ImageFont.truetype(HEAD_FONT, size)
        lines = wrap(draw, text, font, width)
        if len(lines) <= 2: return font, lines, size
    return font, lines, size

def caption(canvas, x, head, sub, color):
    d = ImageDraw.Draw(canvas)
    font, lines, size = headline(d, head, W - 2 * MARGIN)
    y = 150
    for n, line in enumerate(lines):
        d.text((x + MARGIN, y), line, font=font, fill=color if n == 0 else INK); y += int(size * 1.06)
    y += 34
    for line in wrap(d, sub, SUB, W - 2 * MARGIN):
        d.text((x + MARGIN, y), line, font=SUB, fill=INK2); y += 68

def rounded(im, r):
    mask = Image.new('L', im.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, im.width - 1, im.height - 1], r, fill=255)
    out = Image.new('RGBA', im.size, (0, 0, 0, 0)); out.paste(im, (0, 0), mask); return out

def phone(raw, screen_w, angle):
    """The capture in a bezel, with its shadow, turned by angle (counterclockwise), one RGBA layer."""
    shot = Image.open(os.path.join(OUT, 'raw-' + raw + '.png')).convert('RGB')
    if raw in CROP_TOP: shot = shot.crop((0, CROP_TOP[raw], shot.width, shot.height))
    sw = screen_w; sh = int(shot.height * sw / shot.width)
    screen = rounded(shot.resize((sw, sh), Image.LANCZOS), int(sw * 0.095))
    fw, fh = sw + 2 * BEZEL, sh + 2 * BEZEL
    layer = Image.new('RGBA', (fw + 2 * PAD, fh + 2 * PAD), (0, 0, 0, 0))
    shadow = Image.new('RGBA', layer.size, (0, 0, 0, 0))
    ImageDraw.Draw(shadow).rounded_rectangle([PAD, PAD + 60, PAD + fw, PAD + fh + 60], int(sw * 0.12), fill=(0, 0, 0, 130))
    layer.alpha_composite(shadow.filter(ImageFilter.GaussianBlur(50)))
    ImageDraw.Draw(layer).rounded_rectangle([PAD, PAD, PAD + fw, PAD + fh], int(sw * 0.12), fill=INK + (255,))
    layer.alpha_composite(screen, (PAD + BEZEL, PAD + BEZEL))
    return layer.rotate(angle, resample=Image.BICUBIC, expand=True)

def place(canvas, layer, cx, top):
    """The phone's bounding box centered on cx, its top edge (before the shadow's room) at top."""
    canvas.paste(layer, (cx - layer.width // 2, top - PAD), layer)

def slab(canvas, color, angle, cy, width, height):
    """A compartment-colored slab, tilted, running off the sides and the bottom."""
    layer = Image.new('RGBA', (width, height), (0, 0, 0, 0))
    ImageDraw.Draw(layer).rounded_rectangle([0, 0, width - 1, height - 1], 160, fill=color + (255,))
    layer = layer.rotate(angle, resample=Image.BICUBIC, expand=True)
    canvas.paste(layer, ((canvas.width - layer.width) // 2, cy - layer.height // 2), layer)

missing = [r for r, *_ in SHOTS if not os.path.exists(os.path.join(OUT, 'raw-' + r + '.png'))]
if missing: raise SystemExit('missing raw captures: ' + ', '.join(missing))

# The first three: one scene. Three big phones at fourteen degrees, each leaning into the next
# frame and running off the bottom, the later one on top of the earlier; one green slab under all
# three. Each frame keeps its own headline at the top, where nothing crosses.
wide = Image.new('RGB', (W * BAND, H), GROUND)
slab(wide, BACKS[0], 7, int(H * 1.02), int(W * BAND * 1.3), int(H * 0.5))
for i in range(BAND): caption(wide, i * W, SHOTS[i][2], SHOTS[i][3], BACKS[0])
scene = [  # (frame, screen width, angle, center x, top y)
    (0, 1180, -13, int(W * 0.56), 760),
    (1, 1180,  13, int(W * 1.50), 820),
    (2, 1180, -13, int(W * 2.46), 760),
]
for i, sw, angle, cx, top in scene:
    place(wide, phone(SHOTS[i][0], sw, angle), cx, top)
for i in range(BAND):
    wide.crop((i * W, 0, (i + 1) * W, H)).save(os.path.join(OUT, SHOTS[i][1] + '.png'), optimize=True)
    print('composed', SHOTS[i][1])
if os.environ.get('WIDE_PREVIEW'):
    wide.resize((W * BAND // 3, H // 3)).save(os.environ['WIDE_PREVIEW'])

# The rest: one frame each, the same angle and size, the slab's color and lean alternating.
for i in range(BAND, len(SHOTS)):
    raw, name, head, sub = SHOTS[i]
    sign = 1 if i % 2 == 0 else -1
    color = BACKS[(i - BAND + 1) % len(BACKS)]
    canvas = Image.new('RGB', (W, H), GROUND)
    slab(canvas, color, sign * 9, int(H * 0.9), int(W * 1.8), int(H * 0.75))
    caption(canvas, 0, head, sub, color)
    place(canvas, phone(raw, 980, sign * 10), W // 2, 780)   # the bezel runs off the sides, the screen does not
    canvas.save(os.path.join(OUT, name + '.png'), optimize=True)
    print('composed', name)
