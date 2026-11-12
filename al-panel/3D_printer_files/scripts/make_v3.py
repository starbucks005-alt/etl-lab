import numpy as np, trimesh
from shapely.geometry import Point, box, LineString

def extrude(poly, h, z0=0.0):
    m = trimesh.creation.extrude_polygon(poly, h)
    m.apply_translation([0, 0, z0])
    return m

def Dshape(radius, flat):
    # circle with a flat on the +x side
    return Point(0, 0).buffer(radius, 64).intersection(box(-radius-1, -radius-1, flat, radius+1))

def union(ms): return trimesh.boolean.union(ms, engine='manifold')
def diff(a, bs): return trimesh.boolean.difference([a] + bs, engine='manifold')

# ---------- Spinner (servo horn plate + D post) ----------
PLATE_R, PLATE_H = 22.0, 9.0
POCKET_R, POCKET_D = 6.3, 6.0
POST_R, POST_FLAT, POST_L = 4.0, 3.2, 38.0
SLOT_W, SLOT_IN, SLOT_OUT = 2.4, 8.3, 18.7

plate = extrude(Point(0, 0).buffer(PLATE_R, 96), PLATE_H)
fillet = trimesh.creation.revolve(np.array([[0,0],[7.5,0],[POST_R+0.2,5],[0,5]]), sections=64)
fillet.apply_translation([0, 0, PLATE_H])
post = extrude(Dshape(POST_R, POST_FLAT), POST_L, PLATE_H)
body = union([plate, fillet, post])

cuts = []
cuts.append(extrude(Point(0, 0).buffer(POCKET_R, 64), POCKET_D + 0.01, -0.01))                 # horn hub relief
cuts.append(extrude(Point(0, 0).buffer(1.3, 32), PLATE_H + 5 + POST_L + 2, -1))               # 2.6 mm screw bore, full length
for s in (1, -1):
    slot = LineString([(s*SLOT_IN, 0), (s*SLOT_OUT, 0)]).buffer(SLOT_W/2, 16)
    cuts.append(extrude(slot, PLATE_H + 2, -1))                                              # screw slots for horn
spinner = diff(body, cuts)

# ---------- Head disc ----------
DISC_R, DISC_H = 34.0, 6.0
disc = extrude(Point(0, 0).buffer(DISC_R, 128), DISC_H)
dcuts = [extrude(Dshape(POST_R + 0.25, POST_FLAT + 0.25), DISC_H + 2, -1)]
for i in range(6):
    a = np.radians(60*i + 30)
    dcuts.append(extrude(Point(26*np.cos(a), 26*np.sin(a)).buffer(2.5, 32), DISC_H + 2, -1))
head_disc = diff(disc, dcuts)

for name, m in (("spinner", spinner), ("head_disc", head_disc)):
    m.export(f"/tmp/out/{name}_v3.stl")
    print(name, "watertight:", m.is_watertight, "volume mm3: %.0f" % m.volume, "bounds:", np.round(m.bounds, 1).tolist())
