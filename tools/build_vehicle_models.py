"""Build the three metre-scale glTF vehicle assets using the standard library."""
import json
import math
import struct
from collections import defaultdict
from pathlib import Path

OUT = Path(__file__).resolve().parents[1] / "models"
COLORS = dict(body='eeeeee', glass='747474', rubber='565656', trim='bcbcbc')


class Mesh:
    def __init__(self):
        self.faces = defaultdict(list)

    def face(self, color, points, normals=None):
        if normals is None:
            a, b, c = points[:3]
            u, v = [[p[i]-a[i] for i in range(3)] for p in (b,c)]
            n = [u[1]*v[2]-u[2]*v[1], u[2]*v[0]-u[0]*v[2], u[0]*v[1]-u[1]*v[0]]
            normals = [tuple(k/math.hypot(*n) for k in n)] * len(points)
        for j in range(1, len(points)-1):
            for i in (0, j, j+1):
                self.faces[color].append(tuple(points[i]) + normals[i])

    def prism(self, color, lower, upper, radial=None):
        self.face(color, lower[::-1])
        self.face(color, upper)
        for i in range(len(lower)):
            j = (i+1) % len(lower)
            normals = None if radial is None else [radial[i], radial[j], radial[j], radial[i]]
            self.face(color, [lower[i], lower[j], upper[j], upper[i]], normals)

    def body(self, color, z, length, width, bottom, top, bevel=.13):
        x, h = width/2, length/2
        d = min(bevel, x/2, h/2)
        corners = []
        for cx, cz, start in ((1,1,-90),(1,-1,0),(-1,-1,90),(-1,1,180)):
            for step in range(7):
                angle = math.radians(start + step * 15)
                corners.append((cx*(x-d), z+cz*(h-d), math.cos(angle), -math.sin(angle)))

        lip = min(d*.65,(top-bottom)*.22)
        rings = []
        for y, inset, vertical in ((bottom, lip, -1), (bottom+lip, 0, 0),
                                   (top-lip, 0, 0), (top, lip, 1)):
            points = [(cx+(d-inset)*nx, y, cz+(d-inset)*nz) for cx, cz, nx, nz in corners]
            normals = [(0, vertical, 0) if vertical else (nx, 0, nz) for _, _, nx, nz in corners]
            rings.append((points, normals))
        self.face(color, rings[0][0][::-1])
        self.face(color, rings[-1][0])
        for (low, low_normals), (high, high_normals) in zip(rings,rings[1:]):
            for i in range(len(low)):
                j = (i+1)%len(low)
                self.face(color, [low[i],low[j],high[j],high[i]],
                          [low_normals[i],low_normals[j],high_normals[j],high_normals[i]])
    def box(self, color, x,y,z,w,h,l):
        ring = [(x-w/2,z+l/2),(x+w/2,z+l/2),(x+w/2,z-l/2),(x-w/2,z-l/2)]
        self.prism(color, *[[(a,b,c) for a,c in ring] for b in (y,y+h)])

    def rod(self, color, a,b,r, sides=8):
        axis = [q-p for p,q in zip(a,b)]
        def cross(u,v):
            return (u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0])
        def unit(v):
            return [k/math.hypot(*v) for k in v]
        direction = unit(axis)
        u = unit(cross(direction,(0,1,0) if abs(direction[1]) < .9 else (1,0,0)))
        v = cross(direction,u)
        angles = [i*math.tau/sides for i in range(sides)]
        radial = [tuple(u[j]*math.cos(t) + v[j]*math.sin(t) for j in range(3)) for t in angles]
        lower, upper = [[tuple(p[j]+r*n[j] for j in range(3)) for n in radial] for p in (a,b)]
        self.prism(color, lower, upper, radial)

    def save(self,name):
        blob = bytearray()
        views, accessors, primitives, materials = [], [], [], []
        for color, vertices in self.faces.items():
            attrs = {}
            for offset, key in ((0,"POSITION"),(3,"NORMAL")):
                values = [v[offset:offset+3] for v in vertices]
                views.append(dict(buffer=0,byteOffset=len(blob),byteLength=len(values)*12,target=34962))
                blob.extend(b"".join(struct.pack("<3f",*p) for p in values))
                attrs[key] = len(accessors)
                accessors.append(dict(bufferView=len(views)-1,componentType=5126,count=len(values),type="VEC3",
                                      min=list(map(min,zip(*values))),max=list(map(max,zip(*values)))))
            rgb = [int(COLORS[color][i:i+2],16)/255 for i in (0,2,4)]
            materials.append(dict(name=color,pbrMetallicRoughness=dict(baseColorFactor=[
                ((v+.055)/1.055)**2.4 if v>.04045 else v/12.92 for v in rgb]+[1],metallicFactor=.18,roughnessFactor=.16 if color=="glass" else .48)))
            primitives.append(dict(attributes=attrs,material=len(materials)-1))
        doc = dict(asset=dict(version="2.0"),scene=0,scenes=[dict(nodes=[0])],nodes=[dict(mesh=0,name=name)],
                   meshes=[dict(primitives=primitives)],materials=materials,accessors=accessors,bufferViews=views,
                   buffers=[dict(byteLength=len(blob))])
        data = json.dumps(doc,separators=(",",":")).encode()
        data += b" "*(-len(data)%4)
        (OUT/(name+".glb")).write_bytes(struct.pack("<4sIIII",b"glTF",2,28+len(data)+len(blob),len(data),0x4e4f534a)
                                       +data+struct.pack("<I4s",len(blob),b"BIN\0")+blob)


def build(kind):
    m = Mesh()
    rail = kind == "tram"
    # A low-floor city bus and a three-section light rail vehicle, in metres.
    length = 6.6 if rail else 12.0
    centers = [-7.2, 0, 7.2] if rail else [0]
    width = 2.45 if rail else 2.55
    for z in centers:
        m.body("body", z, length, width, .38, 1.25, .23)
        m.body("glass", z, length-.08, width-.08, 1.18, 2.78, .25)
        m.body("body", z, length-.22, width, 2.70, 3.04, .28)
        # Glazing wraps around the cab. Narrow pillars divide the side bays.
        bays = 4 if rail else 7
        for i in range(bays+1):
            station = z+(length-.8)*(i/bays-.5)
            for side in (-1, 1):
                m.box("body", side*(width/2-.045), 1.2, station, .08, 1.53, .09)
        for door in ([z+.9] if rail else [z-3.7, z+.3, z+4.5]):
            for offset in (-.32,.32):
                m.box("glass", width/2, .46, door+offset, .04, 2.16, .60)
                m.box("body", width/2+.025, .51, door+offset, .035, .58, .52)
        if rail:
            m.body("body", z, length-.03, width-.04, 0, .48, .18)
        else:
            for axle in (z-length*.30, z+length*.28):
                for side in (-1, 1):
                    radius = .52
                    m.rod("rubber",(side*(width/2-.20),radius,axle),(side*(width/2+.03),radius,axle),radius,16)
                    m.rod("trim",(side*(width/2+.03),radius,axle),(side*(width/2+.06),radius,axle),radius*.53,12)
        m.body("trim",z-.6,1.9,1.38,3.03,3.27,.12)
        for i in range(6):
            m.box("glass",0,3.27,z-1.33+i*.26,1.02,.025,.09)
    nose = centers[-1]+length/2
    m.box("glass",0,2.44,nose-.035,1.84,.24,.09)
    for x in (-.86,.86):
        m.box("trim",x,.78,nose-.035,.39,.16,.14)
    if rail:
        for joint in (-3.6,3.6):
            m.body("rubber",joint,.78,2.17,.5,2.85,.13)
            for i in range(5):
                m.box("glass",0,.52,joint-.26+i*.13,2.24,2.34,.07)
        for x in (-.34,.34):
            for elbow in (5.6,7.8):
                m.rod("trim",(x,3.05,6.7),(x,3.8,elbow),.065)
                m.rod("trim",(x,3.8,elbow),(x,4.45,6.7),.055)
        m.box("trim",0,4.45,6.7,1.65,.08,.16)
    if kind == "trolley":
        for x in (-.43,.43):
            m.rod("trim",(x,3.16,1.2),(x,4.44,-5.2),.082)
            m.box("rubber",x,4.4,-5.2,.19,.14,.42)
    m.save("trolleybus" if kind=="trolley" else kind)


if __name__ == "__main__":
    OUT.mkdir(exist_ok=True)
    for vehicle in ("bus","tram","trolley"):
        build(vehicle)
