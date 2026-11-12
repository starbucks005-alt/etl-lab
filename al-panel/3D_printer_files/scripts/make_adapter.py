import numpy as np, trimesh
from shapely.geometry import Point, LineString, Polygon

def extrude(poly, h, z0=0.0):
    m = trimesh.creation.extrude_polygon(poly, h); m.apply_translation([0, 0, z0]); return m
def union(ms): return trimesh.boolean.union(ms, engine='manifold')
def diff(a, bs): return trimesh.boolean.difference([a] + bs, engine='manifold')
def hexpoly(af):
    R = af/np.sqrt(3)
    return Polygon([(R*np.cos(np.radians(60*i)), R*np.sin(np.radians(60*i))) for i in range(6)])

PLATE_R, PLATE_H = 22.0, 7.0
POCKET_R, POCKET_D = 8.5, 3.0
SLOT_W, SLOT_IN, SLOT_OUT = 2.4, 13.8, 18.8
H_BOSS = 12.0

def adapter(name, boss_r, af, depth):
    plate = extrude(Point(0,0).buffer(PLATE_R, 96), PLATE_H)
    boss  = extrude(Point(0,0).buffer(boss_r, 96), H_BOSS, PLATE_H)
    fil = trimesh.creation.revolve(np.array([[0,0],[boss_r+3,0],[boss_r,3],[0,3]]), sections=64); fil.apply_translation([0,0,PLATE_H])
    body = union([plate, boss, fil])
    top = PLATE_H + H_BOSS
    cuts = [extrude(Point(0,0).buffer(POCKET_R, 64), POCKET_D+0.01, -0.01),
            extrude(hexpoly(af), depth+1, top-depth)]
    for s in (1,-1):
        cuts.append(extrude(LineString([(s*SLOT_IN,0),(s*SLOT_OUT,0)]).buffer(SLOT_W/2,16), PLATE_H+2, -1))
    m = diff(body, cuts)
    m.export(f'/tmp/out/{name}.stl')
    print(name, m.is_watertight, 'bodies', len(m.split()), np.round(m.bounds,1).tolist(), 'vol cm3 %.1f' % (m.volume/1000))
adapter('ted_adapter',   10.0, 11.5, 4.8)   # 1/4" hex bolt: 7/16" AF, 11/64" head
adapter('astra_adapter', 11.0, 14.7, 6.4)   # 3/8" hex bolt: 9/16" AF, 15/64" head
