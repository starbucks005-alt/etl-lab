#!/usr/bin/env python3
"""A.L.I.C.E. eye holder, first draft (v1), for the Tech-Optics "Doll and Mannequin Eyes 27mm" (glass ball, short neck and stem on the back).
Made 2026-10-30 for Dr. O. NOT PRINTED OR TRIED. Every number below is a guess to be settled by the fit test.

Axes, in millimetres: the eye looks along +Z, up is +Y, +X is to the eye's right. The eye's centre is the origin.
Parts:
  cup        holds the rear of the glass ball (glued in). Two pins at the sides (the tilt axis, along X) and a tab at the bottom rear for a tilt rod.
  yoke       a frame around the cup. Two holes take the cup's pins. A bar over the top has a hole for an M3 bolt (the turn axis, along Y)
             and an arm to the rear with a hole for a turn rod.
  mount      a small plate that sits above the yoke; the M3 bolt goes through both, with a nylon lock nut.
  fit test   three cups with different inner sizes, one, two and three notches on the rim, to find the one the real eye drops into with a little play.
Run:  python3 make_alice_eye_holder_v1.py        (needs numpy, trimesh and manifold3d)
"""
import numpy as np
import trimesh as tm
from trimesh import transformations as T

EYE_D = 27.0                       # the listing says 27 mm; measure the real one
IDS = (27.4, 27.8, 28.2)           # inner sizes in the fit test
WALL = 2.0                         # cup wall
FRONT = 3.0                        # the cup covers the ball from the back up to this far in front of its centre
REAR_HOLE = 18.0                   # opening at the back for the neck and stem (diameter)
PIN_D, PIN_L = 3.0, 4.0            # cup pins
HOLE_D = 3.4                       # holes for pins and the M3 bolt
GAP = 0.5                          # space between cup and yoke arm
ARM_T = 3.0                        # yoke thickness
LEVER_HOLE = 1.8                   # hole for a 1.5 mm rod end


def ball(r, n=5):
    return tm.creation.icosphere(subdivisions=n, radius=r)


def cyl(r, h, axis="z", center=(0, 0, 0)):
    c = tm.creation.cylinder(radius=r, height=h, sections=64)
    if axis == "x":
        c.apply_transform(T.rotation_matrix(np.pi / 2, [0, 1, 0]))
    elif axis == "y":
        c.apply_transform(T.rotation_matrix(np.pi / 2, [1, 0, 0]))
    c.apply_translation(center)
    return c


def box(x0, x1, y0, y1, z0, z1):
    b = tm.creation.box(extents=[x1 - x0, y1 - y0, z1 - z0])
    b.apply_translation([(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2])
    return b


def U(*parts):
    return tm.boolean.union(list(parts), engine="manifold")


def D(a, *parts):
    return tm.boolean.difference([a] + list(parts), engine="manifold")


def I(a, b):
    return tm.boolean.intersection([a, b], engine="manifold")


def shell(inner_d, with_fittings=True):
    ri, ro = inner_d / 2, inner_d / 2 + WALL
    s = D(ball(ro), ball(ri))
    s = I(s, box(-ro - 1, ro + 1, -ro - 1, ro + 1, -ro - 1, FRONT))        # keep the back part only
    s = D(s, cyl(REAR_HOLE / 2, ro + 2, "z", (0, 0, -ro / 2 - 0.5)))        # the opening at the back
    if not with_fittings:
        return s
    pins = U(cyl(PIN_D / 2, PIN_L + 1, "x", (ro + PIN_L / 2 - 0.5, 0, 0)),
             cyl(PIN_D / 2, PIN_L + 1, "x", (-(ro + PIN_L / 2 - 0.5), 0, 0)))
    zt0, zt1 = -10.0, -7.0                                                  # tilt tab, bottom and rear
    yt = -(np.sqrt(ro ** 2 - zt1 ** 2) - 0.8)
    tab = box(-2.5, 2.5, -(ro + 9), yt, zt0, zt1)
    tab = D(tab, cyl(LEVER_HOLE / 2, 8, "x", (0, -(ro + 6), (zt0 + zt1) / 2)))
    return U(s, pins, tab)


def yoke(inner_d):
    ro = inner_d / 2 + WALL
    xi, xo = ro + GAP, ro + GAP + ARM_T
    ytop0, ytop1 = ro + 1.5, ro + 1.5 + ARM_T
    arms = U(box(xi, xo, -8, ytop1, -6, 6), box(-xo, -xi, -8, ytop1, -6, 6))
    bar = box(-xo, xo, ytop0, ytop1, -6, 6)
    rear = box(-3, 3, ytop0, ytop1, -26, -6)                               # arm to the rear for the turn rod
    y = U(arms, bar, rear)
    y = D(y, cyl(HOLE_D / 2, 2 * xo + 2, "x", (0, 0, 0)))                    # pin holes
    y = D(y, cyl(HOLE_D / 2, 10, "y", (0, ytop0 + ARM_T / 2, 0)))            # M3 bolt hole
    y = D(y, cyl(LEVER_HOLE / 2, 10, "y", (0, ytop0 + ARM_T / 2, -22)))      # hole for the turn rod
    return y


def mount(inner_d):
    ro = inner_d / 2 + WALL
    y0 = ro + 1.5 + ARM_T + 1.0                                             # 1 mm above the yoke
    m = box(-16, 16, y0, y0 + 4, -7, 7)
    m = D(m, cyl(HOLE_D / 2, 10, "y", (0, y0 + 2, 0)))
    for x in (-12, 12):
        m = D(m, cyl(1.3, 10, "y", (x, y0 + 2, 0)))                          # two small holes to fasten the plate
    return m


def notched(c, n):
    ro = c.bounds[1][0]
    for i in range(n):
        x = (i - (n - 1) / 2) * 5
        c = D(c, box(x - 0.6, x + 0.6, ro - 3.5, ro + 1, FRONT - 3, FRONT + 1))   # small notch at the top of the rim
    return c


def main():
    # the three fit-test cups side by side
    cups = []
    for i, d in enumerate(IDS):
        c = notched(shell(d, with_fittings=False), i + 1)
        c.apply_translation([i * 40 - 40, 0, 0])
        cups.append(c)
    test = U(*cups)
    test.apply_transform(T.rotation_matrix(np.pi, [0, 1, 0]))                # print with the opening up
    test.apply_translation([0, 0, -test.bounds[0][2]])
    parts = {"fit_test_3cups": test}
    d = IDS[1]
    parts["cup_ID%.1f" % d] = shell(d)
    parts["yoke_for_cup_ID%.1f" % d] = yoke(d)
    parts["mount_plate_for_cup_ID%.1f" % d] = mount(d)
    for name, m in parts.items():
        assert m.is_watertight, name
        m.export("alice_eye_holder_v1_%s.stl" % name)
        print("%-34s watertight %s  size %s mm  volume %.1f cm3" % (name, m.is_watertight, np.round(m.extents, 1), m.volume / 1000))

    # does it move without parts hitting each other? cup against yoke over a range of tilts and turns
    cup, yk = parts["cup_ID%.1f" % d], parts["yoke_for_cup_ID%.1f" % d]
    worst = 0.0
    for yaw in (-30, 0, 30):
        for tilt in (-25, 0, 25):
            c2 = cup.copy()
            c2.apply_transform(T.rotation_matrix(np.radians(tilt), [1, 0, 0]))   # the cup tilts inside the yoke
            y2 = yk.copy()
            both = [c2, y2]
            for m in both:
                m.apply_transform(T.rotation_matrix(np.radians(yaw), [0, 1, 0]))  # the whole thing turns about the bolt
            inter = tm.boolean.intersection(both, engine="manifold")
            v = inter.volume if len(inter.faces) else 0.0
            worst = max(worst, v)
            print("  turn %+3d  tilt %+3d  overlap %.3f mm3" % (yaw, tilt, v))
    print("worst overlap between the cup and the yoke: %.3f mm3 (the pins sit in their holes; 0 means nothing touches)" % worst)


if __name__ == "__main__":
    main()
