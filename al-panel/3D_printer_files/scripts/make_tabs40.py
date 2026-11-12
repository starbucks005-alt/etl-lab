import numpy as np, trimesh
tab = trimesh.load('/tmp/out/magnet_tab.stl')
ms = []
cols, rows, dx, dy = 5, 8, 36.0, 20.0
for i in range(40):
    c, r = i % cols, i // cols
    t = tab.copy(); t.apply_translation([(c-(cols-1)/2)*dx, (r-(rows-1)/2)*dy, 0]); ms.append(t)
allt = trimesh.util.concatenate(ms); allt.export('/tmp/out/magnet_tabs_x40.stl')
print(len(ms), np.round(allt.bounds,1).tolist())
