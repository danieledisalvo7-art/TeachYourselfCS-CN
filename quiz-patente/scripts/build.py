"""Costruisce dist/: pagine con CSS e JS inline (l'artifact non garantisce fogli di stile esterni), più dati e immagini."""
import pathlib, re, shutil

ROOT = pathlib.Path(__file__).resolve().parent.parent
DIST = ROOT / 'dist'

def inline(html, base):
    def css(m):
        return '<style>\n' + (base / m.group(1)).resolve().read_text(encoding='utf-8') + '</style>'
    def js(m):
        return '<script>\n' + (base / m.group(1)).resolve().read_text(encoding='utf-8') + '</script>'
    html = re.sub(r'<link rel="stylesheet" href="((?:\.\./)?assets/[^"]+\.css)">', css, html)
    return re.sub(r'<script src="((?:\.\./)?assets/[^"]+\.js)"></script>', js, html)

if DIST.exists():
    shutil.rmtree(DIST)
DIST.mkdir()
(DIST / 'index.html').write_text(inline((ROOT / 'index.src.html').read_text(encoding='utf-8'), ROOT), encoding='utf-8')
for folder in ('lessons', 'reference'):
    (DIST / folder).mkdir()
    for f in sorted((ROOT / folder).glob('*.html')):
        (DIST / folder / f.name).write_text(inline(f.read_text(encoding='utf-8'), f.parent), encoding='utf-8')
shutil.copytree(ROOT / 'data', DIST / 'data', ignore=shutil.ignore_patterns('LICENSE*'))
shutil.copytree(ROOT / 'img', DIST / 'img')
print('ok', sum(1 for _ in DIST.rglob('*') if _.is_file()), 'file')
