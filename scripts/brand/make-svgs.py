# Every Dukan brand SVG, generated from the asset pack's vector paths with the repositories' design tokens
# (erp-mobile lib/design/colors.ts; erp-control-web src/theme/tokens.css). The three layers keep their names.
import os
OUT = os.path.dirname(os.path.abspath(__file__)) + os.sep + 'svg'
os.makedirs(OUT, exist_ok=True)

T = {
    'navy': '#172033',        # text / org
    'indigo': '#5146D9',      # brand 600
    'indigo700': '#4238B8',   # brand 700
    'indigo400': '#8B82EF',   # brand 400 (the dark-mode right ledger)
    'lavender': '#A29BEA',    # brand 300
    'light': '#F7F8FB',       # neutral 50
    'lightText': '#F1F3F6',   # neutral 100 (dark-mode text)
    'darkCanvas': '#0B0F17',  # dark canvas
}

LEFT = 'M120 176c0-39 40-65 76-50l278 117c37 16 62 52 62 93v66l83 68c21 17 21 49 0 66l-83 68v193L196 654c-46-19-76-64-76-114V176z'
RIGHT = 'M904 176c0-39-40-65-76-50L550 243c-37 16-62 52-62 93v66l-83 68c-21 17-21 49 0 66l83 68v193l340-143c46-19 76-64 76-114V176z'
LCUT = '<rect x="176" y="314" width="230" height="54" rx="27" transform="rotate(23 176 314)" fill="black"/><rect x="176" y="468" width="188" height="54" rx="27" transform="rotate(23 176 468)" fill="black"/>'
RCUT = '<rect x="660" y="314" width="188" height="54" rx="27" transform="rotate(-23 660 314)" fill="black"/><rect x="660" y="468" width="188" height="54" rx="27" transform="rotate(-23 660 468)" fill="black"/>'
HL = 'M467 451l45 37 45-37'

def masks(p):
    return (f'<mask id="{p}l" maskUnits="userSpaceOnUse" x="0" y="0" width="1024" height="1024"><rect width="1024" height="1024" fill="white"/>{LCUT}</mask>'
            f'<mask id="{p}r" maskUnits="userSpaceOnUse" x="0" y="0" width="1024" height="1024"><rect width="1024" height="1024" fill="white"/>{RCUT}</mask>')

def layers(p, left, right, hl, hl_opacity=None):
    op = f' opacity="{hl_opacity}"' if hl_opacity else ''
    return (f'<g id="ledger-left" fill="{left}" mask="url(#{p}l)"><path d="{LEFT}"/></g>'
            f'<g id="ledger-right" fill="{right}" mask="url(#{p}r)"><path d="{RIGHT}"/></g>'
            f'<g id="interlock-highlight" fill="none" stroke="{hl}" stroke-width="18" stroke-linecap="round"{op}><path d="{HL}"/></g>')

# The mark's ink box inside the 1024 grid, so a mark-only file crops to it with clear space.
MARK_BOX = '96 96 832 832'

def mark(name, left, right, hl, title):
    svg = (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{MARK_BOX}" role="img" aria-labelledby="t"><title id="t">{title}</title>'
           f'<defs>{masks("m")}</defs>{layers("m", left, right, hl)}</svg>\n')
    open(os.path.join(OUT, name), 'w', encoding='utf-8', newline='\n').write(svg)

mark('dukan-mark.svg', T['navy'], T['indigo'], T['lavender'], 'Dukan ERP')
mark('dukan-mark-dark.svg', T['lightText'], T['indigo400'], T['lavender'], 'Dukan ERP')
mark('dukan-mark-mono.svg', 'currentColor', 'currentColor', 'currentColor', 'Dukan ERP')

def lockup(name, ink, accent, left, right, hl, title):
    font = "Inter, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif"
    svg = (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1280 420" role="img" aria-labelledby="t"><title id="t">{title}</title>'
           f'<defs>{masks("k")}</defs><g id="mark" transform="translate(16 -10) scale(.43)">{layers("k", left, right, hl)}</g>'
           f'<g id="wordmark"><text x="465" y="255" fill="{ink}" font-family="{font}" font-size="172" font-weight="760" letter-spacing="-7">Dukan</text>'
           f'<text x="475" y="330" fill="{accent}" font-family="{font}" font-size="48" font-weight="650" letter-spacing="8">ERP</text></g></svg>\n')
    open(os.path.join(OUT, name), 'w', encoding='utf-8', newline='\n').write(svg)

lockup('dukan-lockup-light.svg', T['navy'], T['indigo'], T['navy'], T['indigo'], T['lavender'], 'Dukan ERP')
lockup('dukan-lockup-dark.svg', T['lightText'], T['lavender'], T['lightText'], T['indigo400'], T['lavender'], 'Dukan ERP')

# The iOS icon: opaque, mark only, no text; the pack's indigo field (brand 700 → 600) and light ledgers.
icon = (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024">'
        f'<defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="{T["indigo700"]}"/><stop offset="1" stop-color="{T["indigo"]}"/></linearGradient>{masks("i")}</defs>'
        f'<rect width="1024" height="1024" fill="url(#bg)"/>'
        f'<g transform="translate(96 110) scale(.8125)">{layers("i", T["light"], T["lavender"], T["light"])}</g></svg>\n')
open(os.path.join(OUT, 'dukan-app-icon.svg'), 'w', encoding='utf-8', newline='\n').write(icon)

# Android adaptive icon foreground (mark in the 66 % safe zone, transparent) and monochrome.
def adaptive(name, left, right, hl):
    svg = (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024"><defs>{masks("a")}</defs>'
           f'<g transform="translate(232 246) scale(.547)">{layers("a", left, right, hl)}</g></svg>\n')
    open(os.path.join(OUT, name), 'w', encoding='utf-8', newline='\n').write(svg)
adaptive('android-foreground.svg', T['light'], T['lavender'], T['light'])
adaptive('android-monochrome.svg', '#000000', '#000000', '#000000')

# The splash image: the mark alone, transparent; the native screen supplies the colour (light and dark).
def splash(name, left, right, hl):
    svg = (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{MARK_BOX}" width="1024" height="1024"><defs>{masks("s")}</defs>'
           f'{layers("s", left, right, hl)}</svg>\n')
    open(os.path.join(OUT, name), 'w', encoding='utf-8', newline='\n').write(svg)
splash('splash-light.svg', T['navy'], T['indigo'], T['lavender'])
splash('splash-dark.svg', T['lightText'], T['indigo400'], T['lavender'])
print('\n'.join(sorted(os.listdir(OUT))))
