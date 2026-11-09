"""Export metre-scale examples of the map meshes and generate the material test sheet."""
import io
import json
import math
import struct
import subprocess
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'models'
SAMPLES = json.loads(subprocess.check_output(['node', str(Path(__file__).with_name('sample_building_models.cjs'))]))
TEXTURES = {k: Image.frombytes('RGBA', (32, 32), bytes(v)) for k, v in SAMPLES['textures'].items()}


def rectangle(x, y, w, d):
    return [(x,y),(x+w,y),(x+w,y+d),(x,y+d)]


def shape(rings, base, top):
    """Extrude every boundary and fill the roof by slicing at polygon vertex heights."""
    vertices, uv = [], []

    def quad(points, coords):
        for i in (0,1,2,0,2,3):
            vertices.append(points[i])
            uv.append(coords[i])

    edges = [(a,b) for ring in rings for a,b in zip(ring, ring[1:]+ring[:1])]
    for (x,y),(u,v) in edges:
        reach = math.hypot(u-x,v-y)/6
        quad([(x,y,base),(u,v,base),(u,v,top),(x,y,top)],
             [(0,0),(reach,0),(reach,(top-base)/6),(0,(top-base)/6)])
    levels = sorted({p[1] for ring in rings for p in ring})
    for low, high in zip(levels,levels[1:]):
        mid = (low+high)/2
        crossings = []
        for (x,y),(u,v) in edges:
            if min(y,v)<mid<max(y,v):
                crossings.append(tuple(x+(t-y)*(u-x)/(v-y) for t in (mid,low,high)))
        crossings.sort()
        for left,right in zip(crossings[::2], crossings[1::2]):
            corners = [(left[1],low),(right[1],low),(right[2],high),(left[2],high)]
            for z in (base,top):
                quad([(x,y,z) for x,y in corners],[(0,1.5)]*4)
    return vertices, uv


def asset(name, positions, colors=None, uv=None, texture=None):
    positions = np.array(positions, dtype='<f4')[:,[0,2,1]]
    # In the renderer x points east and y points south. glTF uses Y up, Z south.
    blob = bytearray()
    views, accessors = [], []

    def put(data, target=None):
        blob.extend(bytes((-len(blob))%4))
        index = len(views)
        views.append(dict(buffer=0,byteOffset=len(blob),byteLength=len(data)))
        if target:
            views[-1]['target'] = target
        blob.extend(data)
        return index

    def attrib(data):
        data = np.asarray(data,dtype='<f4')
        accessors.append(dict(bufferView=put(data.tobytes(),34962),componentType=5126,
                              count=len(data),type='VEC'+str(data.shape[1]),
                              min=data.min(axis=0).tolist(),max=data.max(axis=0).tolist()))
        return len(accessors)-1

    attrs = {'POSITION':attrib(positions)}
    mat = {'doubleSided':True,'pbrMetallicRoughness':{'metallicFactor':0,'roughnessFactor':1},
           'extensions':{'KHR_materials_unlit':{}}}
    doc = dict(asset={'version':'2.0'},extensionsUsed=['KHR_materials_unlit'],scene=0,
               scenes=[{'nodes':[0]}],nodes=[dict(mesh=0,name=name)],
               meshes=[dict(name=name,primitives=[dict(attributes=attrs,material=0)])],
               materials=[mat],accessors=accessors,bufferViews=views)
    if colors is not None:
        attrs['COLOR_0'] = attrib(np.clip(colors,0,1)**2.2)
    if uv is not None:
        caps = np.array([tuple(coord)==(0,1.5) for coord in uv]).reshape(-1,3).all(axis=1).repeat(3)
        attrs['POSITION'] = attrib(positions[~caps])
        attrs['TEXCOORD_0'] = attrib(np.array(uv)[~caps])
        roof_rgb = [(c/255)**2.2 for c in (168,157,142)]
        doc['materials'].append(dict(doubleSided=True,extensions={'KHR_materials_unlit':{}},
                                     pbrMetallicRoughness={'baseColorFactor':roof_rgb+[1]}))
        doc['meshes'][0]['primitives'].append(dict(attributes={'POSITION':attrib(positions[caps])},material=1))
        png = io.BytesIO()
        TEXTURES[texture].save(png,format='PNG')
        doc.update(images=[dict(bufferView=put(png.getvalue()),mimeType='image/png')],
                   textures=[dict(source=0)])
        mat['pbrMetallicRoughness']['baseColorTexture']={'index':0}
    doc['buffers']=[dict(byteLength=len(blob))]
    blob.extend(bytes((-len(blob))%4))
    meta = json.dumps(doc,separators=(',',':')).encode()
    meta += b' '*((-len(meta))%4)
    file = OUT/(name.lower().replace(' ','-')+'.glb')
    file.write_bytes(struct.pack('<4sII',b'glTF',2,28+len(meta)+len(blob))+
                     struct.pack('<I4s',len(meta),b'JSON')+meta+
                     struct.pack('<I4s',len(blob),b'BIN\0')+blob)
    return file


def thumbnail(file):
    # Read the exported GLB back and rasterize its triangles, UVs and material.
    raw = file.read_bytes()
    magic, version, total, size = struct.unpack_from('<4sIII', raw)
    assert (magic,version,total)==(b'glTF',2,len(raw))
    doc = json.loads(raw[20:20+size])
    binary = raw[28+size:]
    def view(index):
        entry=doc['bufferViews'][index]
        start=entry['byteOffset']
        return binary[start:start+entry['byteLength']]
    attrs=doc['meshes'][0]['primitives'][0]['attributes']
    def read(key):
        item=doc['accessors'][attrs[key]]
        return np.frombuffer(view(item['bufferView']),'<f4').reshape(item['count'],-1)
    p=read('POSITION')
    walls=len(p)
    if len(doc['meshes'][0]['primitives'])>1:
        roof_attr=doc['meshes'][0]['primitives'][1]['attributes']['POSITION']
        roof=np.frombuffer(view(doc['accessors'][roof_attr]['bufferView']),'<f4').reshape(-1,3)
        p=np.concatenate((p,roof))
    px=p[:,0]*0.84-p[:,2]*0.54
    py=(p[:,0]*0.54+p[:,2]*0.84)*0.43-p[:,1]*0.90
    depth=(p[:,0]*0.54+p[:,2]*0.84)*0.90+p[:,1]*0.43
    scale=min(222/max(1,np.ptp(px)),135/max(1,np.ptp(py)))
    screen=np.stack(((px-(px.max()+px.min())/2)*scale+120,
                     (py-(py.max()+py.min())/2)*scale+78),axis=1)
    pixels=np.full((156,240,3),245,np.uint8)
    zbuf=np.full((156,240),-np.inf)
    if 'images' in doc:
        tile=np.asarray(Image.open(io.BytesIO(view(doc['images'][0]['bufferView']))))[:,:,:3]
        uv=read('TEXCOORD_0')
    else:
        colors=read('COLOR_0')**(1/2.2)*255
    for i in range(0,len(p),3):
        a,b,c=screen[i:i+3]
        lo=np.maximum(np.floor(np.minimum(np.minimum(a,b),c)).astype(int),0)
        hi=np.minimum(np.ceil(np.maximum(np.maximum(a,b),c)).astype(int),[239,155])
        x,y=np.meshgrid(np.arange(lo[0],hi[0]+1),np.arange(lo[1],hi[1]+1))
        u,v=b-a,c-a
        det=u[0]*v[1]-u[1]*v[0]
        if abs(det)<1e-5: continue
        s=((x-a[0])*v[1]-(y-a[1])*v[0])/det
        t=(u[0]*(y-a[1])-u[1]*(x-a[0]))/det
        weights=np.stack((1-s-t,s,t),axis=-1)
        z=weights@depth[i:i+3]
        mask=(weights.min(axis=-1)>=0)&(z>zbuf[y,x])
        if not mask.any(): continue
        yy,xx=y[mask],x[mask]
        if i>=walls:
            rgb=np.array([168,157,142])
        elif 'images' in doc:
            tex=(weights[mask]@uv[i:i+3]*32).astype(int)%32
            normal=np.cross(p[i+1]-p[i],p[i+2]-p[i])
            shade=0.72+0.28*abs(normal@np.array([0.4,0.83,0.39]))/max(1e-9,np.linalg.norm(normal))
            rgb=tile[tex[:,1],tex[:,0]]*shade
        else: rgb=weights[mask]@colors[i:i+3]
        pixels[yy,xx]=np.clip(rgb,0,255)
        zbuf[yy,xx]=z[mask]
    assert np.isfinite(zbuf).sum()>300, file
    return Image.fromarray(pixels)


def main():
    catalog=[]
    for item in SAMPLES['models']:
        data=np.array(item['vertices']).reshape(-1,6)
        name=item['name']
        file=asset(('House ' if not item['tier'] else '')+name,data[:,:3],colors=data[:,3:])
        catalog.append((name,file))
    outer=rectangle(0,0,60,42)
    circle=[(12*math.cos(i*math.tau/32),12*math.sin(i*math.tau/32)) for i in range(32)]
    entries=[
        ('Small masonry building','green',[([rectangle(0,0,14,9)],0,6)]),
        ('Tall tower','blue',[([rectangle(0,0,17,15)],0,52)]),
        ('Wide hall','purple',[([rectangle(0,0,54,17)],0,12)]),
        ('Monument','gold',[([rectangle(-14,-14,28,28)],0,5),([circle],5,18)]),
        ('Courtyard ring','purple',[([outer,rectangle(10,9,40,24)[::-1]],0,16)]),
        ('L-shaped wing','green',[([[(0,0),(35,0),(35,10),(11,10),(11,32),(0,32)]],0,12)]),
        ('U-shaped wing','purple',[([[(0,0),(52,0),(52,35),(41,35),(41,11),(11,11),(11,35),(0,35)]],0,15)]),
        ('Rounded footprint','green',[([circle],0,11)]),
        ('Irregular polygon','green',[([[(0,4),(16,0),(31,6),(26,18),(15,15),(6,24)]],0,9)]),
        ('Multipart complex','blue',[([rectangle(0,0,38,23)],0,10),([rectangle(2,3,14,15)],10,34)]),
        ('Elevated section','purple',[([rectangle(0,0,50,15)],12,14)])]
    for name,texture,parts in entries:
        vertices,uv=[],[]
        for rings,base,top in parts:
            points,coords=shape(rings,base,top)
            vertices.extend(points)
            uv.extend(coords)
        catalog.append((name,asset(name,vertices,uv=uv,texture=texture)))
    sheet=Image.new('RGB',(240*4,190*math.ceil(len(catalog)/4)),(245,245,245))
    draw=ImageDraw.Draw(sheet)
    for i,(name,file) in enumerate(catalog):
        x,y=(i%4)*240,(i//4)*190
        sheet.paste(thumbnail(file),(x,y))
        draw.text((x+120,y+160),name,fill='#23282e',anchor='mt',font=ImageFont.load_default(size=15))
    sheet.save(OUT/'building-model-tests.png')
    print(f'{len(catalog)} GLBs validated and rendered')

if __name__=='__main__':
    main()
