# Simula el script de Drive para probar la app en local: sirve la app y responde a POST /script.
import base64, json, os, sys, time
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
APP, VIDEOS = sys.argv[1], sys.argv[2]
CLAVE = 'a' * 64
caps = []
for i, f in enumerate(sorted(x for x in os.listdir(VIDEOS) if x.endswith('.mp4'))):
    caps.append({'n': i + 1, 'titulo': f, 'video': 'video%010d' % (i + 1), 'bytes': os.path.getsize(os.path.join(VIDEOS, f)), 'caratula': None, '_f': os.path.join(VIDEOS, f)})
SERIE = 'serieLasTresMellizas'
ESTADO = {}
BLOQ = {'b': False}
LOG = []
class H(SimpleHTTPRequestHandler):
    def __init__(s, *a, **k): super().__init__(*a, directory=APP, **k)
    def log_message(s, *a): pass
    def responder(s, txt):
        b = txt.encode(); s.send_response(200); s.send_header('Content-Type', 'text/plain'); s.send_header('Content-Length', str(len(b))); s.end_headers(); s.wfile.write(b)
    def do_POST(s):
        p = json.loads(s.rfile.read(int(s.headers['Content-Length'])))
        if p.get('k') != CLAVE: return s.responder('no')
        a = p.get('a'); LOG.append((time.time(), a, p.get('d'), p.get('h'), p.get('n'), p.get('t')))
        if a == 'catalogo': return s.responder(json.dumps({'series': [{'id': SERIE, 'nombre': 'LasTresMellizas', 'portada': None, 'capitulos': [{k: v for k, v in c.items() if k != '_f'} for c in caps]}]}))
        if a == 'caratulas': return s.responder('{}')
        if a == 'estado': return s.responder(json.dumps(dict(ESTADO.get(p.get('s'), {}), b=BLOQ['b'])))
        if a == 'bloquear': BLOQ['b'] = True; return s.responder('ok')
        if a == 'pin':
            if p.get('p') == '12345678': BLOQ['b'] = False; return s.responder('ok')
            return s.responder('mal')
        if a == 'guardar': ESTADO[p['s']] = {'n': p['n'], 't': p['t'], 'ts': int(time.time() * 1000)}; return s.responder('ok')
        if a == 'trozo':
            c = next((c for c in caps if c['video'] == p.get('v')), None); d, h = p['d'], p['h']
            if not c or d < 0 or h < d or h >= c['bytes'] or h - d + 1 > 4 * 1024 * 1024: return s.responder('no')
            time.sleep(0.8)   # latencia parecida a la de Apps Script
            with open(c['_f'], 'rb') as f: f.seek(d); return s.responder(base64.b64encode(f.read(h - d + 1)).decode())
        s.responder('no')
    def do_GET(s):
        if s.path.startswith('/_estado'):
            if '?' in s.path:
                q = dict(x.split('=') for x in s.path.split('?')[1].split('&')); ESTADO[SERIE] = {'n': int(q['n']), 't': float(q['t']), 'ts': int(time.time() * 1000) + 10**7}
            return s.responder(json.dumps({'estado': ESTADO, 'log': LOG[-15:]}))
        super().do_GET()
ThreadingHTTPServer(('127.0.0.1', 8765), H).serve_forever()
