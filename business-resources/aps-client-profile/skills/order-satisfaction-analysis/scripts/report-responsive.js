/* Size inline drilldowns to the scroll viewport, not the colspan table width. */
(function(root){
 const mounts=new WeakMap();
 function mount(host){
  mounts.get(host)?.();
  const groups=new Map();
  host.querySelectorAll('.inline-drill-row > td > .reason-drilldown, .demand-source-row > td > .demand-source-panel').forEach(detail=>{
   const viewport=detail.closest('.report-table-wrap');if(!viewport)return;
   if(!groups.has(viewport))groups.set(viewport,[]);groups.get(viewport).push(detail);
  });
  const sync=()=>groups.forEach((details,viewport)=>{
   if(!(viewport.clientWidth>0))return;
   details.forEach(detail=>{
    const cellStyle=getComputedStyle(detail.parentElement);
    const padding=(parseFloat(cellStyle.paddingLeft)||0)+(parseFloat(cellStyle.paddingRight)||0);
    const width=Math.max(1,viewport.clientWidth-padding)+'px';
    if(detail.style.getPropertyValue('--report-detail-width')!==width)detail.style.setProperty('--report-detail-width',width);
   });
  });
  sync();
  if(root.ResizeObserver&&groups.size){const observer=new root.ResizeObserver(sync);groups.forEach((_,v)=>observer.observe(v));mounts.set(host,()=>observer.disconnect());}
  else if(groups.size){root.addEventListener('resize',sync);mounts.set(host,()=>root.removeEventListener('resize',sync));}
  else mounts.delete(host);
 }
 const header=document.querySelector('.topbar');
 function syncHeader(){if(!header)return;const fixed=['sticky','fixed'].includes(getComputedStyle(header).position);document.documentElement.style.setProperty('--report-header-offset',fixed?header.getBoundingClientRect().height+'px':'0px');}
 if(header){syncHeader();if(root.ResizeObserver){const observer=new root.ResizeObserver(syncHeader);observer.observe(header);}root.addEventListener('resize',syncHeader);}
 root.ReportResponsive={mount};
})(globalThis);
