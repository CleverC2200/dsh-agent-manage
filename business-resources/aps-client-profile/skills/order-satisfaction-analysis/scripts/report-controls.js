(function(root){
 let closeActive=()=>{};
 const arrow='<svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="m3 5 4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>';
 function enhance(select){
  closeActive();
  const wrap=document.createElement('div');wrap.className='selector-control';select.after(wrap);wrap.append(select);select.hidden=true;select.tabIndex=-1;
  const trigger=document.createElement('button');trigger.type='button';trigger.className='selector-trigger';trigger.setAttribute('aria-label','排序字段');trigger.setAttribute('aria-haspopup','listbox');trigger.setAttribute('aria-expanded','false');trigger.innerHTML='<span>'+AnalysisCore.esc(select.selectedOptions[0]?.textContent||'请选择')+'</span>'+arrow;wrap.append(trigger);
  let menu=null;
  const close=(focus=false)=>{menu?.remove();menu=null;trigger.setAttribute('aria-expanded','false');if(focus)trigger.focus();};
  closeActive=close;
  function open(index){
   if(menu)return;menu=document.createElement('div');menu.className='selector-menu';menu.setAttribute('role','listbox');menu.setAttribute('aria-label','排序字段');document.body.append(menu);
   [...select.options].forEach((opt,i)=>{const b=document.createElement('button');b.type='button';b.className='selector-option';b.setAttribute('role','option');b.setAttribute('aria-selected',String(opt.selected));b.textContent=opt.textContent+(opt.selected?' ✓':'');b.onclick=()=>{select.value=opt.value;close();select.dispatchEvent(new Event('change',{bubbles:true}));document.querySelector('.selector-trigger')?.focus();};b.onkeydown=ev=>{const bs=[...menu.querySelectorAll('button')];if(ev.key==='ArrowDown'||ev.key==='ArrowUp'){ev.preventDefault();bs[(i+(ev.key==='ArrowDown'?1:bs.length-1))%bs.length].focus();}if(ev.key==='Escape'){ev.preventDefault();close(true);}};menu.append(b);});
   const box=trigger.getBoundingClientRect(),below=innerHeight-box.bottom-14,above=box.top-14,height=Math.min(280,Math.max(below,above));menu.style.cssText=`position:fixed;left:${Math.max(7,Math.min(box.left,innerWidth-Math.max(box.width,160)-7))}px;min-width:${Math.max(box.width,160)}px;max-height:${height}px;${below>=Math.min(200,height)?'top:'+(box.bottom+7)+'px':'bottom:'+(innerHeight-box.top+7)+'px'}`;
   trigger.setAttribute('aria-expanded','true');menu.querySelectorAll('button')[index??select.selectedIndex]?.focus();
  }
  trigger.onclick=()=>menu?close():open();trigger.onkeydown=ev=>{if(['ArrowDown','ArrowUp'].includes(ev.key)){ev.preventDefault();open(ev.key==='ArrowDown'?0:select.options.length-1);}if(ev.key==='Escape')close(true);};
  closeActive=close;
 }
 document.addEventListener('click',ev=>{if(!ev.target.closest('.selector-menu,.selector-control'))closeActive();});
 window.addEventListener('resize',()=>closeActive());document.addEventListener('scroll',ev=>{if(!ev.target.closest?.('.selector-menu'))closeActive();},true);
 root.ReportControls={enhance};
})(globalThis);
