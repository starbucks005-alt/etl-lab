import numpy as np, trimesh
from shapely.geometry import Point, box
from shapely.ops import unary_union

def extrude(poly, h, z0=0.0):
    m = trimesh.creation.extrude_polygon(poly, h); m.apply_translation([0, 0, z0]); return m
def union(ms): return trimesh.boolean.union(ms, engine='manifold')
def diff(a, bs): return trimesh.boolean.difference([a] + bs, engine='manifold')
def hexpoly(cx, cy, af, rot=0.0):
    R = af/np.sqrt(3)
    return type(Point(0,0).buffer(1))([(cx+R*np.cos(np.radians(60*i+rot)), cy+R*np.sin(np.radians(60*i+rot))) for i in range(6)]) if False else \
        __import__('shapely.geometry', fromlist=['Polygon']).Polygon([(cx+R*np.cos(np.radians(60*i+rot)), cy+R*np.sin(np.radians(60*i+rot))) for i in range(6)])
def circ(cx, cy, r): return Point(cx, cy).buffer(r, 48)

# ================= DECK (print with swivel face DOWN on the bed, collar pointing up) =================
DECK_R, DECK_T = 36.75, 7.0          # 73.5 mm disc
COL_H, COL_W = 8.0, 2.5              # glue collar (points down into the torso once installed)
CENTER_R = 8.0                       # 16 mm clearance hole for the post + fillet
R_BC = 40.0*np.sqrt(2)/2             # swivel screws, 40 mm square
NUT6_AF, NUT_D = 8.3, 3.0            # #6-32 hex nut pocket
HANG = [(8.0, 27.0), (8.0, -27.0)]   # suspension bolt positions

deck = extrude(circ(0, 0, DECK_R), DECK_T)
collar = extrude(circ(0,0,DECK_R).difference(circ(0,0,DECK_R-COL_W)), COL_H, DECK_T)
deck = union([deck, collar])
cuts = [extrude(circ(0,0,CENTER_R), DECK_T+2, -1)]
for i in range(4):
    a = np.radians(45+90*i); x, y = R_BC*np.cos(a), R_BC*np.sin(a)
    cuts.append(extrude(circ(x, y, 2.1), DECK_T+2, -1))                                   # #6 clearance
    cuts.append(extrude(hexpoly(x, y, NUT6_AF, 0), NUT_D+0.01, DECK_T-NUT_D))             # nut pocket (underside)
for (x, y) in HANG:
    cuts.append(extrude(hexpoly(x, y, NUT6_AF, 0), NUT_D+0.01, DECK_T-NUT_D))             # blind nut pocket
deck = diff(deck, cuts)

# ================= SERVO PLATE (print with ear-rest face DOWN) =================
PL_T = 5.0
bar   = box(-19, -15, 42, 15)
wing  = box(-1, -33, 17, 33)
outline = unary_union([bar, wing]).buffer(2.0, 24).buffer(-0.0)
cut_case = box(-10.3, -10.35, 32.0, 10.35)
plate = extrude(outline, PL_T)
pc = [extrude(cut_case, PL_T+2, -1)]
for (x, y) in [(-13.1, 5), (-13.1, -5), (36.4, 5), (36.4, -5)]:
    pc.append(extrude(circ(x, y, 1.3), PL_T-0.6, -0.01+0.0))                             # 2.6 mm pilot, blind (screw tip hidden)
for (x, y) in HANG:
    pc.append(extrude(circ(x, y, 2.15), PL_T+2, -1))                                      # #6 bolt passes through
plate = diff(plate, pc)

deck.export('/tmp/out/deck.stl'); plate.export('/tmp/out/servo_plate.stl')
for n, m in (('deck', deck), ('servo_plate', plate)):
    print(n, 'watertight', m.is_watertight, 'vol cm3 %.1f' % (m.volume/1000), 'bounds', np.round(m.bounds,1).tolist(), 'bodies', len(m.split()))

# ================= ASSEMBLY CHECK (z = mm above servo bottom) =================
def box3(x0,x1,y0,y1,z0,z1):
    m = trimesh.creation.box(extents=[x1-x0,y1-y0,z1-z0]); m.apply_translation([(x0+x1)/2,(y0+y1)/2,(z0+z1)/2]); return m
servo = union([box3(-9.5,31.2,-9.85,9.85,0,39), box3(-15.5,38.8,-9.85,9.85,28,30.5)])
boss  = trimesh.creation.cylinder(radius=6, height=8); boss.apply_translation([0,0,39+4])
servo = union([servo, boss])
Z_ear_under = 28.0
GAP = 25.5                                           # plate top -> deck underside (adjustable)
plate_asm = plate.copy(); plate_asm.apply_transform(trimesh.transformations.reflection_matrix([0,0,0],[0,0,1]))  # flip: ear face up
plate_asm.apply_translation([0,0,Z_ear_under])
deck_bottom = Z_ear_under + GAP
deck_asm = deck.copy(); deck_asm.apply_transform(trimesh.transformations.rotation_matrix(np.pi,[1,0,0]))
deck_asm.apply_translation([0,0,deck_bottom+DECK_T])
sp = trimesh.load('/tmp/out/spinner.stl'); sp.apply_translation([0,0,45.0])
def inter(a,b):
    try: return trimesh.boolean.intersection([a,b], engine='manifold').volume
    except Exception as e: return -1
print('plate vs servo overlap mm3: %.2f' % inter(plate_asm, servo))
print('spinner vs deck overlap mm3: %.2f' % inter(sp, deck_asm))
print('spinner vs plate overlap mm3: %.2f' % inter(sp, plate_asm))
print('servo vs deck overlap mm3: %.2f' % inter(servo, deck_asm))
print('spinner z-range', np.round(sp.bounds[:,2],1).tolist(), 'deck z-range', np.round(deck_asm.bounds[:,2],1).tolist())
print('bolt min length ~ %.0f mm (gap + plate + nut + engagement)' % (GAP+PL_T+3+3))
