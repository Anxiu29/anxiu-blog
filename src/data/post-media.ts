// Actual project screenshots only. Decorative generated concepts are not shipped.
export function getPostMedia(id:string) {
  const key=id.replace(/\.(md|mdx)$/,'');
  const media:Record<string,{src:string;caption:string;width:number;height:number;thumbnail?:boolean}>={
    'webhid-tool-guide':{src:'/images/projects/hid-interface.jpg',caption:'HID 工具界面，未连接设备',width:800,height:230,thumbnail:false},
    'anxiu-demo':{src:'/images/projects/anxiu-interface.jpg',caption:'Anxiu 的 RK-C98 演示模式',width:1280,height:800},
    'fog-town-nightwalk':{src:'/images/projects/fog-town.jpg',caption:'雾镇夜行实际运行界面',width:1280,height:800},
  };
  return media[key];
}
