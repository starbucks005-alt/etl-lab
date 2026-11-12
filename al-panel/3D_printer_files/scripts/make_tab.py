import numpy as np, trimesh
from shapely.geometry import Point, box
def extrude(poly, h, z0=0.0):
    m = trimesh.creation.extrude_polygon(poly, h); m.apply_translation([0,0,z0]); return m
L, W, T = 32.0, 16.0, 7.0          # tab size, thickness (front face z=0 sits on wall + panel)
HOLE_R = 5.2                       # 10 mm magnet + 0.4 clearance
SKIN = 0.8                         # back skin over the keeper magnet
HOLE_X = -7.0                      # hole center, panel side (kerf at x=+0..+3 from the panel edge is at plate x=+5..+8)
outline = box(-L/2, -W/2, L/2, W/2).buffer(-3).buffer(3, 24)
tab = extrude(outline, T)
hole = extrude(Point(HOLE_X, 0).buffer(HOLE_R, 64), T-SKIN+0.01, -0.01)
tab = trimesh.boolean.difference([tab, hole], engine='manifold')
tab.export('/tmp/out/magnet_tab.stl')
print('single', tab.is_watertight, np.round(tab.bounds,1).tolist(), 'vol cm3 %.2f' % (tab.volume/1000))
ms = []
for i in range(8):
    t = tab.copy(); t.apply_translation([(i%2)*40 - 20, (i//2)*22 - 33, 0]); ms.append(t)
allt = trimesh.util.concatenate(ms); allt.export('/tmp/out/magnet_tabs_x8.stl')
print('x8 bounds', np.round(allt.bounds,1).tolist())
