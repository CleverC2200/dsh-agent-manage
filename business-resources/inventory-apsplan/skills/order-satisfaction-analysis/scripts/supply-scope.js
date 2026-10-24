(function(root){
 const value=x=>{if(x==null||(typeof x==='string'&&!x.trim()))return null;const n=Number(x);if(!Number.isFinite(n))throw Error('排程数量非法：'+String(x));return n;};
 const sum=(rs,k)=>rs.length&&rs.every(r=>value(r[k])!=null&&Number.isFinite(value(r[k])))?rs.reduce((s,r)=>s+value(r[k]),0):null;
 function reference(rows,skus,scope,orderPlanReference,metadata={}){
  const filtered=(rows||[]).filter(r=>!skus||skus.has(String(r.material_code).trim()));
  if(!filtered.length)return null;
  const units=[...new Set(filtered.map(r=>r.measure_unit||'未注明'))];
  if(units.length!==1)return {scope,orderSkuCount:skus?.size??null,orderPlanReference,rows:[],status:'unit_conflict',units};
  const conversion=metadata.unitMapping?.[units[0]],verified=conversion?.verified===true&&conversion.definitionRef&&conversion.unit==='件'&&Number.isFinite(conversion.factor)&&conversion.factor>0;
  const factor=verified?conversion.factor:1,unit=verified?'件':units[0]+'（源单位待核验）';
  const normalized=filtered.map(r=>({...r,...Object.fromEntries(['order_qty','confirm_qty','deliv_qty'].map(k=>[k,value(r[k])==null?null:value(r[k])*factor]))}));
  const map=new Map();for(const r of normalized){const key=JSON.stringify([r.data_source??null,r.factory_name??null,String(r.material_code).trim()]);if(!map.has(key))map.set(key,{key,code:String(r.material_code).trim(),name:r.material_name||'商品名称待补充',factory:r.factory_name||'基地待映射',channel:r.data_source||'来源未提供',source:[]});map.get(key).source.push(r);}
  const groups=[...map.values()].map(g=>{const planned=sum(g.source,'order_qty'),delivered=sum(g.source,'deliv_qty');return {...g,planned,delivered,gap:planned==null||delivered==null?null:Math.max(planned-delivered,0)};});
  return {scope,orderSkuCount:skus?.size??null,matchedSkuCount:new Set(normalized.map(r=>String(r.material_code).trim())).size,orderPlanReference,rows:normalized,groups,
   totals:{planned:sum(groups,'planned'),delivered:sum(groups,'delivered'),gap:sum(groups,'gap')},unit,sourceUnit:units[0],unitVerified:verified,status:'acquired'};
 }
 const api={reference};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.SupplyScope=api;
})(globalThis);
