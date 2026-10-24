const fs=require('node:fs'),path=require('node:path'),{createRequire}=require('node:module');
function resolveDOM(options={}){
 const cwd=path.resolve(options.cwd||process.cwd()),candidates=[];
 if(options.modulePath||process.env.DOM_TEST_MODULE)candidates.push(options.modulePath||process.env.DOM_TEST_MODULE);
 const config=path.join(cwd,'.report-environment.json');
 if(fs.existsSync(config)){const c=JSON.parse(fs.readFileSync(config,'utf8'));if(c.domModule)candidates.push(c.domModule);}
 const roots=[cwd,__dirname,...(process.env.NODE_PATH||'').split(path.delimiter).filter(Boolean)];
 const errors=[];
 for(const candidate of candidates){try{const resolved=path.isAbsolute(candidate)?require.resolve(candidate):createRequire(path.join(cwd,'__report_environment__.cjs')).resolve(candidate);const m=require(resolved);if(typeof m.JSDOM!=='function')throw Error('模块未提供JSDOM');return {module:m,path:resolved};}catch(e){errors.push({candidate,error:e.message.split('\n')[0]});}}
 for(const root of roots){try{const resolved=createRequire(path.join(root,'__report_environment__.cjs')).resolve('jsdom');const m=require(resolved);if(typeof m.JSDOM==='function')return {module:m,path:resolved};}catch{}}
 return {module:null,path:null,errors};
}
module.exports={resolveDOM};
if(require.main===module){
 const output=process.argv[2],result=resolveDOM();const report={node:process.version,executable:process.execPath,domAvailable:!!result.module,domModule:result.path,errors:result.errors||[],next:result.module?'可运行DOM测试；不代表已完成浏览器验收':'调用宿主依赖发现工具获取已有jsdom绝对路径，设置DOM_TEST_MODULE后重试；无可用依赖则记录DOM未执行，不循环安装'};
 if(output){fs.mkdirSync(path.dirname(path.resolve(output)),{recursive:true});fs.writeFileSync(output,JSON.stringify(report,null,2));}
 console.log(JSON.stringify(report,null,2));if(!result.module)process.exitCode=2;
}
