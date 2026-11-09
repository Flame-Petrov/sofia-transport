// Paired eaves from OSM metro roof outlines (west to east), ODbL.
  var metroRoofSections = [
    [[23.3513761,42.6708286,23.3514619,42.670868],[23.3515477,42.6706116,23.3516389,42.6706511],[23.3516443,42.6704775,23.3517408,42.670513],[23.3517516,42.6703158,23.3518481,42.6703474],[23.3518481,42.6701541,23.35195,42.6701857],[23.351934,42.6699924,23.3520359,42.67002],[23.3519876,42.6698583,23.3520949,42.669882],[23.3520627,42.6696847,23.35217,42.6697084],[23.3523134,42.6690694,23.3524238,42.6690939],[23.3524349,42.6687773,23.3525506,42.6688049],[23.3524404,42.6687641,23.3525559,42.6687917],[23.3525266,42.668558,23.3526385,42.6685862],[23.3526347,42.6682993,23.3527423,42.6683282],[23.3526367,42.6682945,23.3527442,42.6683234],[23.3526473,42.6682688,23.3527545,42.6682978],[23.3526556,42.6682488,23.3527626,42.6682779],[23.3527846,42.667937,23.3528878,42.6679673],[23.3527877,42.6679302,23.3528906,42.6679604],[23.3529503,42.6675731,23.3530468,42.6676042],[23.3529524,42.6675686,23.3530491,42.6675997],[23.3530404,42.6673995,23.3531364,42.6674316],[23.3530435,42.667394,23.3531393,42.6674261],[23.3530582,42.6673683,23.3531544,42.6674007],[23.353149,42.6672089,23.3532478,42.6672432],[23.35315,42.6672072,23.3532488,42.6672415],[23.3532683,42.6670174,23.353366,42.6670527],[23.3532696,42.6670157,23.3533671,42.6670509],[23.3534475,42.666773,23.3535402,42.6668082],[23.3534509,42.6667683,23.3535437,42.6668036],[23.3536261,42.6665399,23.3537184,42.6665768],[23.3536562,42.6665087,23.3537439,42.6665437],[23.3538905,42.6662659,23.3539782,42.666303],[23.3538919,42.6662644,23.3539797,42.6663016],[23.354143,42.6660393,23.3542301,42.6660783],[23.3542405,42.665952,23.3543272,42.6659916],[23.3542469,42.6659462,23.3543337,42.6659859],[23.3547112,42.6655372,23.354799,42.6655816],[23.3547769,42.6654793,23.3548644,42.6655242],[23.3551889,42.6651199,23.3552722,42.6651659],[23.3551926,42.6651167,23.3552759,42.6651626],[23.3557205,42.6646459,23.3558018,42.6646953]],
    [[23.3557205,42.6646459,23.3558018,42.6646953],[23.3560112,42.6643734,23.3560917,42.6644212],[23.3560124,42.6643722,23.3560929,42.66442],[23.3563515,42.6640144,23.3564315,42.6640606],[23.356355,42.6640105,23.3564352,42.6640567],[23.3566386,42.6636918,23.3567234,42.6637391],[23.3566427,42.6636875,23.3567274,42.6637347],[23.3567963,42.6635265,23.3568764,42.6635708]],
    [[23.3614558,42.6605563,23.3615434,42.6606106],[23.3618689,42.6602323,23.3619423,42.6602809],[23.3619253,42.6601881,23.3619967,42.6602359],[23.3623645,42.6598433,23.3624402,42.6598982],[23.3624412,42.6597848,23.3625164,42.6598402],[23.3628981,42.6594363,23.3629714,42.6594946],[23.3629006,42.6594344,23.3629741,42.6594929],[23.3633961,42.6591059,23.3634719,42.659171],[23.3634133,42.6590958,23.3634883,42.6591604],[23.3638678,42.6588298,23.363942,42.658898]],
    [[23.3638352,42.6587999,23.363959,42.6589135],[23.3648815,42.6581889,23.3650094,42.6583069]],
    [[23.3649049,42.6582105,23.3649854,42.6582848],[23.3659319,42.6576241,23.3660074,42.6576898],[23.3659371,42.6576211,23.3660126,42.6576869],[23.3686424,42.656129,23.3687267,42.6561932],[23.3686543,42.6561225,23.3687382,42.6561863],[23.3694374,42.6556543,23.3695199,42.6557139],[23.3694467,42.6556487,23.3695287,42.6557079],[23.3699237,42.6553224,23.370007,42.6553808],[23.3699311,42.6553173,23.3700143,42.6553756],[23.3705828,42.6548515,23.3706731,42.6549129]]
  ];
  function visibleMetroRoofSegments(bounds) {
    var visible = new Set();
    metroRoofSections.forEach(function(rows, section) {
      for (var j=1;j<rows.length;j++) {
        var a=rows[j-1], b=rows[j];
        if (Math.max(a[0],a[2],b[0],b[2]) >= bounds.getWest() &&
            Math.min(a[0],a[2],b[0],b[2]) <= bounds.getEast() &&
            Math.max(a[1],a[3],b[1],b[3]) >= bounds.getSouth() &&
            Math.min(a[1],a[3],b[1],b[3]) <= bounds.getNorth()) visible.add(section+'/'+j);
      }
    });
    return visible;
  }

  function metroCanopyVertices(map, origin, visible) {
    if (!visible) visible=visibleMetroRoofSegments(map.getBounds());
    var vertices = [], facets = 16;
    var concrete = [.62,.59,.54], frame = [.35,.34,.32], underside = [.45,.43,.40];
    function quad(a,b,c,d,color) {
      for (var point of [a,b,c,a,c,d]) vertices.push(...point,...color);
    }
    function mix(a,b,t) { return a.map(function (v,i) { return v+(b[i]-v)*t; }); }
    function ground(ll) {
      var z = map.getTerrain() ? map.queryTerrainElevation(ll) || 0 : 0;
      var p = maplibregl.MercatorCoordinate.fromLngLat(ll,z);
      return [(p.x-origin.x)/origin.unit,(p.y-origin.y)/origin.unit,p.z/origin.unit];
    }
    function arch(left,right,overhang) {
      var width = Math.hypot(right[0]-left[0],right[1]-left[1]);
      return Array.from({length: facets+1},function (_,i) {
        var angle = Math.PI*i/facets, t = (1-Math.cos(angle))/2;
        var p = mix(left,right,t-overhang*Math.cos(angle)/Math.max(width,1));
        p[2] += 4.5+(5+overhang)*Math.sin(angle);
        return p;
      });
    }
    function strip(left,right,endLeft,endRight,rib) {
      var thickness = rib ? .34 : .13;
      var a=arch(left,right,thickness), b=arch(endLeft,endRight,thickness);
      var c=arch(left,right,0), d=arch(endLeft,endRight,0);
      for (var i=0;i<facets;i++) {
        var light=.61+.24*Math.sin(Math.PI*(i+.5)/facets);
        quad(a[i],b[i],b[i+1],a[i+1],rib ? frame : [light,light*.98,light*.92]);
        quad(c[i],c[i+1],d[i+1],d[i],underside);
        if (rib) {
          quad(a[i],a[i+1],c[i+1],c[i],frame);
          quad(b[i],d[i],d[i+1],b[i+1],frame);
        }
      }
      for (var side of [0,facets]) {
        quad(a[side],c[side],d[side],b[side],frame);
        if (!rib) continue;
        var corners=[a[side],c[side],d[side],b[side]];
        var feet=corners.map(function(p){return [p[0],p[1],p[2]-4.5];});
        for (var k=0;k<4;k++) {
          var next=(k+1)%4;
          quad(feet[k],feet[next],corners[next],corners[k],concrete);
        }
      }
    }
    metroRoofSections.forEach(function(rows, section) {
      var distance=0, spacing=8, ribWidth=.48;
      for(var j=1;j<rows.length;j++) {
        var a=rows[j-1], b=rows[j];
        var dx=(b[0]+b[2]-a[0]-a[2])*40935, dy=(b[1]+b[3]-a[1]-a[3])*55660;
        var length=Math.hypot(dx,dy), start=distance;
        distance+=length;
        if (!visible.has(section+'/'+j)) continue;
        var left=ground(a.slice(0,2)), right=ground(a.slice(2));
        var endLeft=ground(b.slice(0,2)), endRight=ground(b.slice(2));
        var cuts=[0,length];
        for(var bay=Math.floor(start/spacing)*spacing;bay<distance;bay+=spacing) {
          for(var edge of [bay,bay+ribWidth]) if(edge>start && edge<distance) cuts.push(edge-start);
        }
        if(j===rows.length-1 && length>ribWidth) cuts.push(length-ribWidth);
        cuts.sort(function(x,y){return x-y;});
        for(var k=1;k<cuts.length;k++) {
          var lo=cuts[k-1],hi=cuts[k],mid=(lo+hi)/2;
          if(hi-lo<.001) continue;
          var rib=(start+mid)%spacing<ribWidth || (j===rows.length-1 && mid>length-ribWidth);
          strip(mix(left,endLeft,lo/length),mix(right,endRight,lo/length),
            mix(left,endLeft,hi/length),mix(right,endRight,hi/length),rib);
        }
      }
    });
    return new Float32Array(vertices);
  }
