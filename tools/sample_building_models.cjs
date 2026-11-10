// Export the app's house vertex streams and one 32 px bay of the façade style behind each catalog material.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = path.join(__dirname, '../src/features/view3d');
const origin = {x: 0.012345, y: 0.023456, unit: 1e-7};
const context = vm.createContext({
  ImageData: class { constructor(w,h) { this.width = w; this.height = h; this.data = new Uint8ClampedArray(w*h*4); } },
  maplibregl: { MercatorCoordinate: { fromLngLat: ([x,y]) => ({
    x: origin.x + x * origin.unit, y: origin.y + y * origin.unit,
    meterInMercatorCoordinateUnits: () => origin.unit
  }) } }
});
vm.runInContext(fs.readFileSync(path.join(source,'bulgarian-houses.js'),'utf8'),context);
vm.runInContext(fs.readFileSync(path.join(source,'facade-styles.js'),'utf8'),context);
const textures = {};
const map = {getTerrain: () => false};
const models = [];
for (const [tier, designs] of [context.houseDesigns, context.apartmentDesigns].entries()) {
  for (const [index, design] of designs.entries()) {
    let id = 1;
    while (context.houseDesignIndex(id, designs) !== index) id++;
    const [w,d,h] = tier ? [32,16,16] : [15,10,7];
    const feature = {id, properties:{render_height:h,render_min_height:0},
      geometry:{type:'Polygon',coordinates:[[[0,0],[w,0],[w,d],[0,d],[0,0]]]}};
    const vertices = [];
    if (!context.bulgarianHouse(feature, vertices, origin, map)) throw Error(design.name);
    models.push({name:design.name, tier, vertices});
  }
}
const catalog = {green:['plaster',0], blue:['glass',0], purple:['panel',1], gold:['stone',0],
  facade:['plaster',1], ivory:['plaster',8], clay:['plaster',9]};
for (const [name, [style, tint]] of Object.entries(catalog)) {
  const tints = context.facadeStyles.styles[context.facadeStyles.names.indexOf(style)].tints;
  textures[name] = Array.from(context.facadeStyles.swatch(style, tints[tint], 32).data);
}
process.stdout.write(JSON.stringify({models,textures}));
