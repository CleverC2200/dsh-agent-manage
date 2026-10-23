const fs=require('node:fs');
function check(doc,expected){
 const sets=doc.datasets||Object.entries(doc).filter(([,v])=>v&&Array.isArray(v.rows)).map(([name,v])=>({name,...v}));
 const ds=sets.find(d=>d.name===expected.name);if(!ds)throw Error('查询身份不一致：期望 '+expected.name+'，实际 '+sets.map(x=>x.name).join(','));
 if(ds.offset!==expected.offset)throw Error('分页offset不一致');
 if(!Array.isArray(ds.rows)||ds.rows.length!==ds.rowCount)throw Error('行数与rowCount不一致');
 if(expected.model&&!ds.modelContext?.some(m=>m.name===expected.model)&&!ds.fields?.some(f=>f.name?.startsWith(expected.model+'.')))throw Error('缺少期望模型元数据；保存完整工具返回，不只复制rows');
 return {name:ds.name,rows:ds.rows.length,offset:ds.offset,hasMorePages:ds.hasMorePages??null,total:ds.totalRowCount??null,checksum:ds.checksum??null};
}
module.exports=check;
if(require.main===module){try{console.log(JSON.stringify(check(JSON.parse(fs.readFileSync(process.argv[2],'utf8').replace(/^\uFEFF/,'')),{name:process.argv[3],offset:Number(process.argv[4]),model:process.argv[5]}),null,2));}catch(e){console.error(e.message);process.exitCode=1;}}
