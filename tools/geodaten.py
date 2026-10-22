# Holt Gebäudeumrisse (OpenStreetMap) und ein Satellitenbild (Esri) rund um das Werk,
# damit der Lageplan exakt auf die Karte gelegt werden kann. Läuft in GitHub Actions.
import json, math, io, urllib.request, urllib.parse
from PIL import Image

S, W, N, E = 49.508, 11.300, 49.526, 11.326
UA = {"User-Agent": "WoKran-Lageplan/1.0 (github.com/Ralletfg/WoKran)"}

def get(url, data=None):
    req = urllib.request.Request(url, data=data, headers=UA)
    with urllib.request.urlopen(req, timeout=120) as r:
        return r.read()

q = f"""[out:json][timeout:90];
(way["building"]({S},{W},{N},{E}); way["landuse"]({S},{W},{N},{E}); way["highway"]({S},{W},{N},{E}); way["railway"]({S},{W},{N},{E}););
out tags geom;"""
osm = get("https://overpass-api.de/api/interpreter", urllib.parse.urlencode({"data": q}).encode())
open("geodata/osm.json", "wb").write(osm)

Z = 18
def tile(lat, lon):
    n = 2 ** Z
    return (lon + 180) / 360 * n, (1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n
x0, y0 = tile(N, W); x1, y1 = tile(S, E)
tx0, ty0, tx1, ty1 = int(x0), int(y0), int(x1), int(y1)
img = Image.new("RGB", ((tx1 - tx0 + 1) * 256, (ty1 - ty0 + 1) * 256))
for tx in range(tx0, tx1 + 1):
    for ty in range(ty0, ty1 + 1):
        b = get(f"https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{Z}/{ty}/{tx}")
        img.paste(Image.open(io.BytesIO(b)).convert("RGB"), ((tx - tx0) * 256, (ty - ty0) * 256))
img.save("geodata/satellit_z18.jpg", quality=85)
json.dump({"zoom": Z, "tile_x0": tx0, "tile_y0": ty0, "size": img.size}, open("geodata/satellit_z18.json", "w"))
print("ok", img.size)
