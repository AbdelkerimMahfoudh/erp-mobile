# Every Dukan brand SVG, generated from the owner's Offset Spiral pack (Concept B, 2026-11-03: two arcs around a "D")
# with the mark tokens it defines (erp-mobile lib/design/colors.ts `identity`). The three layers keep their names, which
# the launch animation moves: `spiral-first`, `spiral-second`, `spiral-letter`.
import os
OUT = os.path.dirname(os.path.abspath(__file__)) + os.sep + 'svg'
os.makedirs(OUT, exist_ok=True)

T = {
    'navy': '#1E1B4B',      # identity.navy: light mode's first arc and letter
    'violet': '#7C3AED',    # identity.violet: light mode's second arc, dark mode's first
    'lavender': '#A78BFA',  # identity.lavender: dark mode's second arc
    'white': '#FFFFFF',     # identity.white: dark mode's letter; the light icon's field
    'midnight': '#181735',  # identity.midnight: the dark icon's field
}

# The pack's paths, in its 512 grid.
FIRST = 'M 256,40 A 216,216 0 0,1 472,256 A 216,216 0 0,1 426.6,396.4 L 380,352 A 152,152 0 0,0 408,256 A 152,152 0 0,0 256,104 Z'
SECOND = 'M 256,472 A 216,216 0 0,1 40,256 A 216,216 0 0,1 85.4,115.6 L 132,160 A 152,152 0 0,0 104,256 A 152,152 0 0,0 256,408 Z'
LETTER = 'M 190,160 L 260,160 C 310,160 350,195 350,256 C 350,317 310,352 260,352 L 190,352 Z M 230,195 L 230,317 L 258,317 C 288,317 310,295 310,256 C 310,217 288,195 258,195 Z'

def layers(first, second, letter):
    return (f'<g id="spiral-first" fill="{first}"><path d="{FIRST}"/></g>'
            f'<g id="spiral-second" fill="{second}"><path d="{SECOND}"/></g>'
            f'<g id="spiral-letter" fill="{letter}" fill-rule="evenodd"><path d="{LETTER}"/></g>')

# The mark's ink (40..472) with a little clear space, centred on the pack's centre (256, 256).
MARK_BOX = '24 24 464 464'

def write(name, svg):
    open(os.path.join(OUT, name), 'w', encoding='utf-8', newline='\n').write(svg + '\n')

def mark(name, first, second, letter):
    write(name, f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{MARK_BOX}" role="img" aria-labelledby="t"><title id="t">Dukan ERP</title>{layers(first, second, letter)}</svg>')

mark('dukan-mark.svg', T['navy'], T['violet'], T['navy'])
mark('dukan-mark-dark.svg', T['violet'], T['lavender'], T['white'])
mark('dukan-mark-mono.svg', 'currentColor', 'currentColor', 'currentColor')

def lockup(name, first, second, letter, ink, accent):
    font = "Inter, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif"
    write(name, f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1280 420" role="img" aria-labelledby="t"><title id="t">Dukan ERP</title>'
                f'<g id="mark" transform="translate(10 10) scale(.78)">{layers(first, second, letter)}</g>'
                f'<g id="wordmark"><text x="465" y="255" fill="{ink}" font-family="{font}" font-size="172" font-weight="700" letter-spacing="-3">Dukan</text>'
                f'<text x="475" y="330" fill="{accent}" font-family="{font}" font-size="48" font-weight="650" letter-spacing="8">ERP</text></g></svg>')

lockup('dukan-lockup-light.svg', T['navy'], T['violet'], T['navy'], T['navy'], T['violet'])
lockup('dukan-lockup-dark.svg', T['violet'], T['lavender'], T['white'], T['white'], T['lavender'])

# The iOS icon: opaque, mark only, no text: the pack's light app icon on a full square (iOS rounds the corners itself).
write('dukan-app-icon.svg', f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="1024" height="1024">'
                            f'<rect width="512" height="512" fill="{T["white"]}"/>'
                            f'<g transform="translate(70 70) scale(.726)">{layers(T["navy"], T["violet"], T["navy"])}</g></svg>')

# Android adaptive icon: the mark in the 66 % safe zone on a transparent foreground; the field is the background image.
def adaptive(name, first, second, letter):
    write(name, f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="1024" height="1024">'
                f'<g transform="translate(104 104) scale(.594)">{layers(first, second, letter)}</g></svg>')
adaptive('android-foreground.svg', T['navy'], T['violet'], T['navy'])
adaptive('android-monochrome.svg', '#000000', '#000000', '#000000')

# The splash image: the mark alone, transparent; the native screen supplies the colour (light and dark).
def splash(name, first, second, letter):
    write(name, f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{MARK_BOX}" width="1024" height="1024">{layers(first, second, letter)}</svg>')
splash('splash-light.svg', T['navy'], T['violet'], T['navy'])
splash('splash-dark.svg', T['violet'], T['lavender'], T['white'])
print('\n'.join(sorted(os.listdir(OUT))))
