"""Composes the App Store screenshots at 1320x2868 (the 6.9-inch slot; App Store Connect
scales it for smaller phones): each raw capture from store-shots.mjs in an upright phone with a
heavy bezel, centered under a centered two-line headline, on the app's ground color. Behind the
phones one organic band in the brand's green runs across the whole set, drawn once on a canvas
eight frames wide and cut per frame, so every frame carries a different slice of the same shape
and the set reads as one. Fonts are the app's own, checked in under store/ (Familjen Grotesk
and Karla, SIL Open Font License). Run by scripts/store-shots.mjs."""
from PIL import Image, ImageDraw, ImageFont, ImageFilter
import os, math

OUT = 'store/screenshots'
W, H = 1320, 2868
GROUND = (0xE9, 0xEE, 0xE6)          # the page color, the canvas
INK = (0x16, 0x24, 0x1E)             # the headline's second line and the bezel
INK2 = (0x3E, 0x4D, 0x45)            # the line under the headline
MAIN = (0x2A, 0x51, 0x41)            # the band, and the headline's first line
MINT = (0x81, 0xCB, 0xA8)            # the dark theme's accent green: a second, lighter wave behind the band
                                     # (accent-soft was tried and vanished into the ground)
HEAD_FONT = 'store/FamiljenGrotesk-Bold.ttf'
SUB = ImageFont.truetype('store/Karla-Medium.ttf', 54)

# (raw capture, output name, headline, one line under it). Two lines at most.
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
CROP_TOP = {}                 # (raw: pixels off the top); none, so every phone is the same height

SCREEN_W = 900
BEZEL = 26
PAD = 160                     # room around the phone for its shadow's blur
PHONE_TOP = 760

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
    for size in range(140, 100, -4):
        font = ImageFont.truetype(HEAD_FONT, size)
        lines = wrap(draw, text, font, width)
        if len(lines) <= 2: return font, lines, size
    return font, lines, size

def caption(canvas, x0, head, sub):
    """Centered in the frame that starts at x0."""
    d = ImageDraw.Draw(canvas)
    font, lines, size = headline(d, head, W - 160)
    y = 170
    for n, line in enumerate(lines):
        d.text((x0 + (W - d.textlength(line, font=font)) // 2, y), line, font=font, fill=MAIN if n == 0 else INK); y += int(size * 1.06)
    y += 30
    for line in wrap(d, sub, SUB, W - 160):
        d.text((x0 + (W - d.textlength(line, font=SUB)) // 2, y), line, font=SUB, fill=INK2); y += 68

def rounded(im, r):
    mask = Image.new('L', im.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, im.width - 1, im.height - 1], r, fill=255)
    out = Image.new('RGBA', im.size, (0, 0, 0, 0)); out.paste(im, (0, 0), mask); return out

def phone(raw):
    shot = Image.open(os.path.join(OUT, 'raw-' + raw + '.png')).convert('RGB')
    if raw in CROP_TOP: shot = shot.crop((0, CROP_TOP[raw], shot.width, shot.height))
    sw = SCREEN_W; sh = int(shot.height * sw / shot.width)
    screen = rounded(shot.resize((sw, sh), Image.LANCZOS), 84)
    fw, fh = sw + 2 * BEZEL, sh + 2 * BEZEL
    layer = Image.new('RGBA', (fw + 2 * PAD, fh + 2 * PAD), (0, 0, 0, 0))
    shadow = Image.new('RGBA', layer.size, (0, 0, 0, 0))
    ImageDraw.Draw(shadow).rounded_rectangle([PAD, PAD + 44, PAD + fw, PAD + fh + 44], 108, fill=(0, 0, 0, 95))
    layer.alpha_composite(shadow.filter(ImageFilter.GaussianBlur(44)))
    ImageDraw.Draw(layer).rounded_rectangle([PAD, PAD, PAD + fw, PAD + fh], 108, fill=INK + (255,))
    layer.alpha_composite(screen, (PAD + BEZEL, PAD + BEZEL))
    return layer

def wave(canvas, color, base, amp, period, phase):
    """A band whose top edge undulates across the whole strip, filled to the bottom."""
    pts = [(x, base + amp * math.sin(2 * math.pi * x / period + phase)) for x in range(0, canvas.width + 1, 8)]
    ImageDraw.Draw(canvas).polygon(pts + [(canvas.width, H + 10), (0, H + 10)], fill=color)

missing = [r for r, *_ in SHOTS if not os.path.exists(os.path.join(OUT, 'raw-' + r + '.png'))]
if missing: raise SystemExit('missing raw captures: ' + ', '.join(missing))

N = len(SHOTS)
strip = Image.new('RGB', (W * N, H), GROUND)
wave(strip, MINT, H * 0.64, 280, W * 2.9, 1.1)      # the lighter wave, higher
wave(strip, MAIN, H * 0.76, 300, W * 2.3, 0.0)      # the green band
for i, (raw, name, head, sub) in enumerate(SHOTS):
    caption(strip, i * W, head, sub)
    layer = phone(raw)
    strip.paste(layer, (i * W + (W - layer.width) // 2, PHONE_TOP - PAD), layer)
for i, (raw, name, head, sub) in enumerate(SHOTS):
    strip.crop((i * W, 0, (i + 1) * W, H)).save(os.path.join(OUT, name + '.png'), optimize=True)
    print('composed', name)
if os.environ.get('STRIP_PREVIEW'):
    strip.resize((W * N // 6, H // 6)).save(os.environ['STRIP_PREVIEW'])
