// Run inside the front container. Uses existing server configuration; never prints secrets.
import {mkdir,readFile,writeFile,rename,open,unlink,appendFile} from 'node:fs/promises';
import {join} from 'node:path';
const root=process.env.AIRE_DATA_DIR || '/data';
const id='northeia-lab', origin='https://northeia-lab.northeia.com';
const objectId=process.argv[2] || process.env.AIRE_LAB_ADMIN_OBJECT_ID || '';
const ms=process.env.AIRE_MICROSOFT_TENANT_ID || '';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
if(!uuid.test(ms) || (objectId && !uuid.test(objectId))) throw Error('Configure um Tenant ID Microsoft e um Object ID válidos.');
await mkdir(root,{recursive:true,mode:0o700});
const lockPath=join(root,'managed-tenants.lock'), lock=await open(lockPath,'wx',0o600);
try {
 let registry={revision:0,tenants:[]};
 try{registry=JSON.parse(await readFile(join(root,'managed-tenants.json'),'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
 const configured=JSON.parse(process.env.AIRE_TENANTS_JSON || '[]');
 if([...registry.tenants,...configured].some(t=>t.id===id)) { console.log('Northeia Lab já cadastrada; configuração preservada.'); }
 else {
  if([...registry.tenants,...configured].some(t=>t.publicOrigin===origin))throw Error('Domínio já cadastrado.');
  const tenant={id,name:'Northeia Lab',publicOrigin:origin,enabled:false,
   sso:{microsoftTenantId:ms,googleDomains:[]},members:objectId?[{provider:'microsoft',subject:objectId,role:'admin'}]:[],groups:[],repositories:[],
   githubTokenEnv:'NORTHEIA_LAB_GITHUB_TOKEN',engineUrlEnv:'NORTHEIA_LAB_ENGINE_URL',engineTokenEnv:'NORTHEIA_LAB_ENGINE_TOKEN',plan:{name:'Laboratório',monthlyUsd:0}};
  const next={revision:registry.revision+1,tenants:[...registry.tenants,tenant]};
  const tmp=join(root,`managed-tenants.${crypto.randomUUID()}.tmp`);
  await writeFile(tmp,JSON.stringify(next),{mode:0o600,flag:'wx'});
  await appendFile(join(root,'platform-audit.jsonl'),JSON.stringify({at:new Date().toISOString(),action:'tenant.seeded',tenant:id,actor:'server-operator',revision:next.revision})+'\n',{mode:0o600});
  await rename(tmp,join(root,'managed-tenants.json'));
  console.log('Northeia Lab cadastrada em rascunho. Ative no painel após iniciar seu motor e registrar o redirect SSO.');
 }
} finally {await lock.close();await unlink(lockPath);}
