"""Composes the App Store screenshots: each raw capture from store-shots.mjs on
the app's ground colour with a headline above it, at 1320x2868 (the 6.9-inch
slot; App Store Connect scales it for smaller phones). Fonts are the app's
own, checked in under store/ (Familjen Grotesk and Karla, both under the SIL Open Font
License, from Google Fonts). Run by scripts/store-shots.mjs."""
from PIL import Image, ImageDraw, ImageFont
import os

OUT = 'store/screenshots'
W, H = 1320, 2868
GROUND, INK, INK2, LINE = (0xE9, 0xEE, 0xE6), (0x16, 0x24, 0x1E), (0x4A, 0x5C, 0x53), (0x1E, 0x33, 0x29)
HEAD = ImageFont.truetype('store/FamiljenGrotesk-Bold.ttf', 96)
SUB = ImageFont.truetype('store/Karla-Medium.ttf', 46)

SHOTS = [
    ('week',    '01-week',    'A week of lunches\nin about a minute.', 'A main, a side, a fruit and a sweet for every school day, matched so each box goes together: crunchy against soft, tangy against salty.'),
    ('pack',    '02-pack',    'Mornings: one box,\none check.',            'Today’s box, an ice-pack flag when it needs one, and the rest of the week coming up.'),
    ('kidpick', '03-kidpick', 'Hand them the phone.\nThey pick.',       'Tomorrow’s box, chosen from the week you already shopped for. A lunch they chose comes home emptier.'),
    ('shop',    '04-shop',    'The shopping list\nwrites itself.',      'Everything planned, grouped by aisle. Check off what the pantry already has.'),
    ('setup',   '05-rules',   'Your school’s rules,\nrespected.',       'Nut-free, cold-only, no ice pack, a short eating window. Foods are flagged, never silently dropped.'),
    ('foods',   '06-foods',   'Foods they’ll\nactually eat.',           'Start from what parents pack, add your own, and tell it what came home. Next week’s draw learns.'),
]
CROP_TOP = {}   # (name: pixels) to lift a screen that centres itself; none needed today

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

def rounded(im, r):
    mask = Image.new('L', im.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, im.width - 1, im.height - 1], r, fill=255)
    out = Image.new('RGBA', im.size, (0, 0, 0, 0)); out.paste(im, (0, 0), mask); return out

for raw, name, head, sub in SHOTS:
    src = os.path.join(OUT, 'raw-' + raw + '.png')
    if not os.path.exists(src): print('missing', src); continue
    shot = Image.open(src).convert('RGB')
    if raw in CROP_TOP: shot = shot.crop((0, CROP_TOP[raw], shot.width, shot.height))
    canvas = Image.new('RGB', (W, H), GROUND); d = ImageDraw.Draw(canvas)
    y = 150
    for line in wrap(d, head, HEAD, W - 200):
        d.text((100, y), line, font=HEAD, fill=INK); y += 106
    y += 18
    for line in wrap(d, sub, SUB, W - 220):
        d.text((100, y), line, font=SUB, fill=INK2); y += 60
    top = y + 70
    sw = W - 200; sh = int(shot.height * sw / shot.width)
    phone = rounded(shot.resize((sw, sh), Image.LANCZOS), 72)
    frame = Image.new('RGBA', (sw + 8, sh + 8), (0, 0, 0, 0))
    ImageDraw.Draw(frame).rounded_rectangle([0, 0, sw + 7, sh + 7], 76, fill=LINE)
    canvas.paste(frame, (96, top - 4), frame)
    canvas.paste(phone, (100, top), phone)
    canvas.save(os.path.join(OUT, name + '.png'), optimize=True)
    print('composed', name)
