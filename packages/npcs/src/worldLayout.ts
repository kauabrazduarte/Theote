export const WORLD_HALF_SIZE=33.5;
export const TREE_SPOTS:[number,number,number][]=[[-19,-19,0.9],[-12,-19,0.75],[-3,-21,0.85],[8,-20,0.9],[23,-19,0.72],[27,-4,0.9],[27,13,0.75],[11,21,0.95],[-15,20,0.82],[-27,6,0.75],[-27,-14,0.88],[-8,21,0.7],[16,2,0.7],[2,21,0.75],[-18,18,0.7],[19,20,0.8]];
export const ORCHARD_SPOTS:[number,number][]=[[-18,12],[-15.8,15.7],[-14.2,13.7],[-17.2,8.6]];
export const POND={x:0.5,z:-14.5,radiusX:3.3,radiusZ:2.35};
export const WELL={x:1.5,z:6.2,radius:0.82};
export const WATER_WHEEL={x:-1.4,z:-14.2};
export const BENCH={x:-5.7,z:-1.8};
export const MARKET_STALL={x:-5,z:4};
export const CHAINED_GOBLIN={x:-24,z:24,approachX:-19.7,approachZ:23.8,name:'Duende acorrentado'} as const;
export const EXPLORE_SITES=[
  {id:'mirante',name:'Mirante da muralha',x:-26,z:-25,description:'Observar os caminhos além da muralha.',discovery:'Do alto do mirante, as trilhas dos duendes parecem mudar de direção antes do amanhecer.'},
  {id:'pedras',name:'Círculo de pedras',x:-26,z:9,description:'Investigar as marcas gravadas nas pedras.',discovery:'Uma pedra do círculo traz marcas antigas de contagem; alguém vigiava os dias antes de haver calendário.'},
  {id:'ruinas',name:'Ruínas de Cesar',x:2,z:25,description:'Examinar restos de uma antiga construção.',discovery:'Sob as ruínas há sulcos de ferramentas; Cesar preparou mais de uma defesa para o vale.'},
  {id:'clareira',name:'Clareira dos vaga-lumes',x:24,z:24,description:'Observar a clareira iluminada ao anoitecer.',discovery:'Os vaga-lumes se juntam perto de uma nascente pequena, escondida entre raízes.'},
  {id:'oficina',name:'Oficina antiga',x:-5,z:-25,description:'Examinar a bancada e objetos deixados ali.',discovery:'A bancada guarda um desenho incompleto de uma roda para transportar madeira.'},
] as const;
export const FENCES=[{x:-15,z:2.8,width:6.8,depth:6.2},{x:-3.8,z:12.2,width:5.2,depth:4.8},{x:15,z:-22,width:8.2,depth:7.8}] as const;
