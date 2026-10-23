/* Build a separate runtime bundle; retain tests and maintenance tools in development source. */
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..');
function pack(destination){
 const out=path.resolve(destination);if(out===root||out.startsWith(root+path.sep))throw Error('运行包目录不能放在Skill源码内部');
 if(fs.existsSync(out))throw Error('输出已存在；使用新的包目录，不覆盖未知文件');
 const scripts=fs.readdirSync(__dirname).filter(n=>n.endsWith('.js')||['generate-report.cjs','prepare-report-data.cjs','audit-report-data.cjs','report-environment.cjs'].includes(n));
 const files=['SKILL.md','agents/openai.yaml',...scripts.map(n=>'scripts/'+n),...fs.readdirSync(path.join(root,'assets')).map(n=>'assets/'+n),...fs.readdirSync(path.join(root,'references')).filter(n=>n.endsWith('.md')).map(n=>'references/'+n)];
 fs.mkdirSync(out,{recursive:true});
 for(const file of files){let data=fs.readFileSync(path.join(root,file));
  if(file.endsWith('.md')){let text=data.toString('utf8').replace(/^\s*node scripts\/test-.*$/gm,'').replace(/`node scripts\/test-[^`]+`/g,'开发包专项回归测试');if(file==='SKILL.md')text+='\n本包为运行版；开发回归与模板同步工具保留在开发版。运行时使用data-contract-audit.json及业务人工复核，不宣称完成开发回归或浏览器验收。\n';data=Buffer.from(text);}
  const target=path.join(out,file);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,data);
 }
 const manifest={kind:'runtime',files:files.map(file=>({file,sha256:crypto.createHash('sha256').update(fs.readFileSync(path.join(out,file))).digest('hex')}))};
 fs.writeFileSync(path.join(out,'runtime-package.json'),JSON.stringify(manifest,null,2));return {out,files:files.length};
}
module.exports=pack;if(require.main===module)console.log(pack(process.argv[2]));
