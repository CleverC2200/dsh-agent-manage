// Produces read-only SQL intentions. MCP members must still be inspected at runtime.
const fs=require('node:fs'),path=require('node:path');
const quote=v=>{if(!['string','number'].includes(typeof v)||!Number.isFinite(typeof v==='number'?v:0))throw Error('过滤值必须是字符串或有限数');return "'"+String(v).replace(/'/g,"''")+"'";};
function make(config){
 if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(config.period||''))throw Error('period 必须为 YYYY-MM');
 const [year,month]=config.period.split('-').map(Number),start=config.period+'-01',end=new Date(Date.UTC(year,month,1)).toISOString().slice(0,10),compact=x=>x.replaceAll('-','');
 const schema=config.schema||'ai_db';if(!/^[A-Za-z_][\w]*$/.test(schema))throw Error('schema 无效');
 const definitions={
  orders:['agents_scm_order_plan_exe_m','fromorderno_month',['belong_base','region_code','province_region_code','material_code'],'fromorderno_month,belong_base,region_code,region_name,province_region_code,province_region_name,material_code,material_name,need_qty_origin,qtyshipped,outqty,demand_change_outqty,plan_inner_outqty,allnum'],
  sales:['agents_scm_demand_sales_f','stat_month',['belong_name','region_code','province_region_code','material_code'],'stat_month,source_flag,belong_name,region_code,region_name,province_region_code,province_region_name,material_code,material_name,plan_qty_initial,plan_qty_adjusted,order_qty_origin,act_dl_qty'],
  mapping:['agents_scm_demand_sales_f','stat_month',['material_code'],'stat_month,source_flag,material_code,product_categ_name,material_group,material_group_name'],
  production:['agents_mes_prod_oee_line_result_d','zdate',['factory_name','material_code'],'zdate,factory_name,classify1,material_code,material_name,workcenter,order_code,batch_no,deviation_reason,plan_qty,actual_qty'],
  schedule:['agents_prod_schedule_detail_d','base_finish_day',['factory_name','material_code','data_source','measure_unit'],'base_finish_day,act_ship_date,factory_name,material_code,material_name,product_categ_name,order_no,internal_order_no,data_source,measure_unit,order_qty,confirm_qty,deliv_qty'],
  salesReconcile:['agents_sales_plan_demand_m',config.salesReconcileDateField||'DATE_FIELD_REQUIRES_INSPECTION',[],`${config.salesReconcileDateField||'DATE_FIELD_REQUIRES_INSPECTION'},plannum,allnum`],
  stock:['agents_scm_stock_detail_d','the_date',['belong_base','material_code'],'data_month,the_date,belong_base,material_code,material_name,produce_plan,produce_plan_adj,produce_in_qty,base_transfer_in,wx_transfer_in,current_stock,available_stock'],
  transfer:['agents_scm_warehouse_transfer_plan_data_d','plan_month',['warehouse_code','material_code'],'plan_month,snapshot_date,plan_version,plan_source,warehouse_code,material_code,warehouse_month_transfer_plan,warehouse_transfer_qty,transfer_onway_qty,transfer_prepare_qty,plan_qty_unit']
 };
 const datasets={};
 for(const [id,[table,date,allowed,columns]] of Object.entries(definitions)){
  const isCompact=['production','schedule'].includes(id),from=isCompact?compact(start):start,to=isCompact?compact(end):end;
  const filters=config.filters?.[id]||{};
  const conditions=[`${date} >= ${quote(from)}`,`${date} < ${quote(to)}`];
  for(const [field,value] of Object.entries(filters)){
   if(!allowed.includes(field))throw Error(id+' 不支持过滤字段 '+field);
   const values=Array.isArray(value)?value:[value];if(!values.length)throw Error('空过滤列表');
   conditions.push(`${field} IN (${values.map(quote).join(',')})`);
  }
  if(id==='sales')conditions.push("source_flag='销售口径'");if(id==='mapping')conditions.push("source_flag='基地口径'");
  const where=conditions.join(' AND ');
  if(!/^[A-Za-z_]\w*$/.test(date))throw Error('日期字段不合法');
  datasets[id]={table:schema+'.'+table,dateField:date,period:config.period,filters,sql:date==='DATE_FIELD_REQUIRES_INSPECTION'?null:`SELECT ${columns} FROM ${schema}.${table} WHERE ${where}`,status:'pending',
   countSql:date==='DATE_FIELD_REQUIRES_INSPECTION'?null:`SELECT COUNT(*) AS row_count FROM ${schema}.${table} WHERE ${where}`,
   complete:false,notes:id==='orders'?'取完整月度行；分类 outqty>0 在同一批行内筛选。保留零发货行。':id==='schedule'?'全类别查询；按来源、单位分别保留，不能视作 MES 实绩或擅自归到 OE/OD。':id==='stock'?'月计划/库存快照不按天累加；日流量字段仍需知识库确认。':id==='transfer'?'日期类型与版本先 inspect；在途/待发不是接收兑现。':'先检查物理字段、日期类型与分页协议。'};
 }
 return {period:config.period,scope:config.scope||'当前授权业务范围',start,end,definitionsSource:'WeKnora（使用主提示词登记的知识库 MCP）',datasets};
}
module.exports={make};
if(require.main===module){const config=JSON.parse(fs.readFileSync(process.argv[2],'utf8')),out=path.resolve(process.argv[3]);fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,JSON.stringify(make(config),null,2));console.log(out);}
