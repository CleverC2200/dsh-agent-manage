const cp=require('node:child_process'),fs=require('node:fs'),path=require('node:path');
// 受限沙箱禁止管道子进程（EPERM）时，降级为记录状态而不是让整个自检失败。
const sandbox=code=>/EPERM|EACCES/.test(String(code||''));
const notes=[];let failed=false;
for(const script of ['test-source-pipeline.cjs','test-supply-ui.cjs']){
 try{cp.execFileSync(process.execPath,[path.join(__dirname,script)],{stdio:'inherit'});}
 catch(e){const s=sandbox(e&&e.code)?'SKIPPED_SANDBOX':'FAILED';notes.push({script,status:s,detail:String((e&&e.message)||e).slice(0,200)});if(s==='FAILED')failed=true;}
}
let syntax='PASS';
for(const script of fs.readdirSync(__dirname).filter(s=>/\.(cjs|js)$/.test(s))){
 try{cp.execFileSync(process.execPath,['--check',path.join(__dirname,script)],{stdio:'pipe'});}
 catch(e){if(sandbox(e&&e.code)){syntax='SKIPPED_SANDBOX';break;}notes.push({script,status:'SYNTAX_FAILED',detail:String((e&&e.message)||e).slice(0,200)});syntax='FAILED';failed=true;}
}
console.log(JSON.stringify({status:failed?'FAILED':'PASS',scope:'portable scripts and synthetic component checks',syntaxCheck:syntax,notes,liveQueries:'NOT_RUN',browserVisual:'NOT_RUN',businessDefinitions:'REQUIRES_CURRENT_KNOWLEDGE_BASE',hostLiveReplay:'NOT_RUN'}));
if(failed)process.exitCode=1;
