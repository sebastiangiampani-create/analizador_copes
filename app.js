(() => {
  const DB_NAME = 'analizador_copes_v1';
  const STORE = 'state';
  const KEY = 'dataset';
  const EMPTY = { actions: [], proposals: [], registrations: [], attendance: [], imports: [], sources: [], savedFilters: [] };
  const REMOTE_ENDPOINT = 'https://qchnawvoensqnynsuhfu.supabase.co/functions/v1/copes-state';
  const REMOTE_KEY_STORAGE = 'analizador_copes_workspace_key_v1';
  let remoteReady = false;
  let storageModalResolve = null;
  let configSaveTimer = null;
  let dataset = structuredClone(EMPTY);
  let charts = {};
  const PALETTE = ['#167566','#2f7fe0','#7b68c7','#d18a3a','#3aa7a0','#7d8c99','#bd6a5a','#5d9b63','#8a6bb8','#c49a3f'];
  let filtered = { registrations: [], attendance: [], proposals: [] };

  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];
  const esc = (v='') => String(v ?? '').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));
  const normalize = (v='') => String(v ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
  const codeIn = (v='') => (String(v ?? '').match(/C\d{4}(?:[-_]\d+)?/i)?.[0] || '').toUpperCase().replace('_','-');
  const mainCodeIn = (v='') => (String(v ?? '').match(/C\d{4}/i)?.[0] || '').toUpperCase();
  const num = (v) => Number(String(v ?? '').replace(',','.')) || 0;
  const unique = (arr) => [...new Set(arr.filter(v => v !== null && v !== undefined && String(v).trim() !== '').map(v => String(v).trim()))];
  const sortAlpha = (arr) => arr.sort((a,b) => a.localeCompare(b,'es',{numeric:true,sensitivity:'base'}));
  const cleanDni = (v='') => String(v ?? '').replace(/\D+/g,'').trim();
  const idOf = (r) => {
    const dni=cleanDni(r?.dni);
    return dni ? 'dni:'+dni : String(r?.email || r?.name || '').trim().toLowerCase();
  };
  const cueOf = (r) => String(r?.cue || '').trim() || ('school:'+normalize(r?.school||''));
  const statusNorm = (v='') => {
    const n=normalize(v);
    if(n.includes('baja') || n.includes('inactivo')) return 'Baja';
    if(n.includes('activo') || n.includes('alta')) return 'Activo';
    return String(v||'').trim();
  };
  const upper = (v='') => String(v||'').trim().toUpperCase();

  function toast(msg){
    const el = $('#toast'); el.textContent = msg; el.classList.add('show');
    clearTimeout(toast.t); toast.t = setTimeout(()=>el.classList.remove('show'),2600);
  }

  function openDb(){
    return new Promise((resolve,reject)=>{
      const req=indexedDB.open(DB_NAME,1);
      req.onupgradeneeded=()=>{const db=req.result;if(!db.objectStoreNames.contains(STORE))db.createObjectStore(STORE)};
      req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);
    });
  }
  async function saveState(){
    const db=await openDb();
    await new Promise((resolve,reject)=>{const tx=db.transaction(STORE,'readwrite');tx.objectStore(STORE).put(dataset,KEY);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error)});
    db.close();
    if(remoteReady) scheduleRemoteConfigSave();
  }
  async function loadState(){
    const db=await openDb();
    const value=await new Promise((resolve,reject)=>{const tx=db.transaction(STORE,'readonly');const r=tx.objectStore(STORE).get(KEY);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});
    db.close(); dataset={...structuredClone(EMPTY), ...(value || {})};
    if(!Array.isArray(dataset.sources)) dataset.sources=[];
    if(!Array.isArray(dataset.savedFilters)) dataset.savedFilters=[];
  }
  async function clearState(){
    const db=await openDb();
    await new Promise((resolve,reject)=>{const tx=db.transaction(STORE,'readwrite');tx.objectStore(STORE).delete(KEY);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error)});
    db.close(); dataset=structuredClone(EMPTY); renderAll();
  }

  function workspaceKey(){ return localStorage.getItem(REMOTE_KEY_STORAGE) || ''; }

  function setStorageUi(mode,detail=''){
    const title=$('#storageTitle'), text=$('#storageDetail'), btn=$('#storageStatusBtn'), card=$('#storageCard');
    if(!title || !text || !btn)return;
    card?.classList.remove('storage-connected','storage-local','storage-error');
    if(mode==='connected'){
      title.textContent='Supabase conectado';
      text.textContent=detail || 'Las cargas quedan guardadas permanentemente.';
      btn.textContent='Supabase: conectado';
      card?.classList.add('storage-connected');
    }else if(mode==='error'){
      title.textContent='Guardado local';
      text.textContent=detail || 'No se pudo conectar con Supabase.';
      btn.textContent='Supabase: reconectar';
      card?.classList.add('storage-error');
    }else{
      title.textContent='Guardado local';
      text.textContent=detail || 'Conectá Supabase para no perder las cargas.';
      btn.textContent='Supabase: conectar';
      card?.classList.add('storage-local');
    }
  }

  async function remoteRequest(op,payload={},keyOverride=''){
    const key=keyOverride || workspaceKey();
    if(!key) throw new Error('missing_workspace_key');
    const res=await fetch(REMOTE_ENDPOINT,{
      method:'POST',
      headers:{'Content-Type':'application/json','x-copes-key':key},
      body:JSON.stringify({op,...payload}),
      cache:'no-store'
    });
    const data=await res.json().catch(()=>({ok:false,error:'invalid_response'}));
    if(!res.ok || !data.ok) throw new Error(data.error || ('HTTP '+res.status));
    return data;
  }

  function openStorageModal(){
    if(!$('#storageModal')) return Promise.resolve('');
    if(storageModalResolve) return Promise.resolve('');
    $('#storageKeyInput').value='';
    $('#storageKeyError').textContent='';
    $('#storageModal').hidden=false;
    setTimeout(()=>$('#storageKeyInput')?.focus(),50);
    return new Promise(resolve=>{storageModalResolve=resolve});
  }

  function closeStorageModal(value=''){
    $('#storageModal').hidden=true;
    const resolve=storageModalResolve;
    storageModalResolve=null;
    if(resolve) resolve(value);
  }

  async function ensureRemoteAccess({interactive=true}={}){
    let key=workspaceKey();
    if(key){
      try{
        await remoteRequest('ping',{},key);
        remoteReady=true;
        setStorageUi('connected');
        return true;
      }catch(e){
        console.warn('Clave COPES guardada inválida o conexión caída',e);
        localStorage.removeItem(REMOTE_KEY_STORAGE);
        key='';
      }
    }
    remoteReady=false;
    if(!interactive){
      setStorageUi('local');
      return false;
    }
    const entered=String(await openStorageModal()||'').trim();
    if(!entered){
      setStorageUi('local');
      return false;
    }
    try{
      await remoteRequest('ping',{},entered);
      localStorage.setItem(REMOTE_KEY_STORAGE,entered);
      remoteReady=true;
      setStorageUi('connected');
      return true;
    }catch(e){
      console.error(e);
      $('#storageKeyError').textContent='La clave no es válida o Supabase no responde.';
      localStorage.removeItem(REMOTE_KEY_STORAGE);
      remoteReady=false;
      setStorageUi('error','Revisá la clave de acceso.');
      return false;
    }
  }

  function buildActionSnapshot(code){
    const action=dataset.actions.find(x=>x.code===code);
    if(!action)return null;
    const importInfo=dataset.imports.find(x=>x.code===code) || {code,title:action.title||code,when:new Date().toISOString()};
    return {
      action,
      proposals:dataset.proposals.filter(x=>x.actionCode===code),
      registrations:dataset.registrations.filter(x=>x.actionCode===code),
      attendance:dataset.attendance.filter(x=>x.actionCode===code),
      importInfo
    };
  }

  function applyActionSnapshot(payload){
    const code=payload?.action?.code;
    if(!/^C\d{4}$/.test(code||''))return;
    dataset.actions=dataset.actions.filter(x=>x.code!==code).concat(payload.action);
    dataset.proposals=dataset.proposals.filter(x=>x.actionCode!==code).concat(payload.proposals||[]);
    dataset.registrations=dataset.registrations.filter(x=>x.actionCode!==code).concat(payload.registrations||[]);
    dataset.attendance=dataset.attendance.filter(x=>x.actionCode!==code).concat(payload.attendance||[]);
    dataset.imports=dataset.imports.filter(x=>x.code!==code).concat(payload.importInfo||{code,title:payload.action.title||code,when:new Date().toISOString()});
  }

  async function saveRemoteAction(code){
    if(!remoteReady)return false;
    const payload=buildActionSnapshot(code);
    if(!payload)return false;
    await remoteRequest('save_action',{actionCode:code,payload});
    return true;
  }

  async function saveRemoteConfig(){
    if(!remoteReady)return;
    await remoteRequest('save_config',{payload:{
      sources:dataset.sources||[],
      savedFilters:dataset.savedFilters||[]
    }});
  }

  function scheduleRemoteConfigSave(){
    clearTimeout(configSaveTimer);
    configSaveTimer=setTimeout(()=>{
      saveRemoteConfig().catch(e=>{
        console.error('Error guardando configuración en Supabase',e);
        remoteReady=false;
        setStorageUi('error','La copia local sigue disponible; reconectá Supabase.');
      });
    },250);
  }

  async function initRemotePersistence(){
    const localSnapshots=(dataset.actions||[]).map(a=>buildActionSnapshot(a.code)).filter(Boolean);
    const localSources=structuredClone(dataset.sources||[]);
    const localFilters=structuredClone(dataset.savedFilters||[]);

    const connected=await ensureRemoteAccess({interactive:true});
    if(!connected)return;

    try{
      const remote=await remoteRequest('load');
      const rows=remote.actions||[];
      const remoteCodes=new Set(rows.map(r=>r.action_code));
      const localOnly=localSnapshots.filter(p=>!remoteCodes.has(p.action.code));

      if(rows.length){
        dataset=structuredClone(EMPTY);
        for(const row of rows) applyActionSnapshot(row.payload);
        for(const p of localOnly){
          applyActionSnapshot(p);
          await remoteRequest('save_action',{actionCode:p.action.code,payload:p});
        }
        dataset.sources=Array.isArray(remote.config?.sources)?remote.config.sources:localSources;
        dataset.savedFilters=Array.isArray(remote.config?.savedFilters)?remote.config.savedFilters:localFilters;
      }else if(localSnapshots.length){
        for(const p of localSnapshots){
          await remoteRequest('save_action',{actionCode:p.action.code,payload:p});
        }
        await saveRemoteConfig();
      }

      await saveState();
      setStorageUi('connected',(dataset.actions.length||0)+' acción(es) persistidas en Supabase.');
    }catch(e){
      console.error('Error inicializando persistencia remota',e);
      remoteReady=false;
      setStorageUi('error','No se pudo recuperar Supabase. La copia local sigue intacta.');
      toast('No se pudo conectar con Supabase; se mantiene la copia local.');
    }
  }

  function spreadsheetIdFromUrl(url=''){
    return String(url).match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/)?.[1] || '';
  }

  function sourceAuthLabel(mode){
    return ({private_backend:'Privada · backend',public_link:'Pública por link',technical_account:'Cuenta técnica',delegated:'Autenticado'})[mode] || mode || '—';
  }

  function sourceStatusLabel(status){
    return ({pending_backend:'Pendiente de conexión',syncing:'Sincronizando',ok:'Sincronizada',error:'Error'})[status] || status || 'Pendiente de conexión';
  }

  function mapRow(row){
    const m={}; Object.entries(row||{}).forEach(([k,v])=>m[normalize(k)]=v); return m;
  }
  function pick(m, keys){
    for(const k of keys){const v=m[normalize(k)]; if(v!==null && v!==undefined && String(v).trim()!=='') return v}
    return '';
  }
  function formatDate(v){
    if(!v) return '';
    const s=String(v).trim();
    const iso=s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if(iso) return `${iso[3]}/${iso[2]}/${iso[1]}`;
    if(v instanceof Date && !Number.isNaN(v.getTime())) return v.toLocaleDateString('es-AR',{day:'2-digit',month:'2-digit',year:'numeric'});
    const d = new Date(v);
    if(!Number.isNaN(d.getTime())) return d.toLocaleDateString('es-AR',{day:'2-digit',month:'2-digit',year:'numeric'});
    const m=s.match(/(\d{1,2})[\/\-.](\d{1,2})(?:[\/\-.](\d{2,4}))?/);
    if(m) return [m[1].padStart(2,'0'),m[2].padStart(2,'0'),m[3] ? (m[3].length===2?'20'+m[3]:m[3]) : ''].filter(Boolean).join('/');
    return s;
  }
  function isoDate(v, year){
    if(!v) return '';
    if(v instanceof Date && !Number.isNaN(v.getTime())) return v.toISOString().slice(0,10);
    const s=String(v); const m=s.match(/(\d{1,2})[\/\-.](\d{1,2})(?:[\/\-.](\d{2,4}))?/);
    if(!m) return '';
    const y = m[3] ? (m[3].length===2 ? '20'+m[3] : m[3]) : String(year || new Date().getFullYear());
    return `${y}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`;
  }
  function cleanSchool(v){
    let s=String(v||'').trim(); if(!s) return '';
    if(s.includes('\n')){ const parts=s.split(/\n+/).map(x=>x.trim()).filter(Boolean); if(parts.length>1) s=parts[parts.length-1] }
    s=s.replace(/^[A-Z]-?\d+[A-Z]?\s*\|\s*/i,'').replace(/\s*-\s*\d{7,9}\s*$/,'').trim();
    return s;
  }
  function parseDependencyFromSchool(v){
    const parts=String(v||'').split(/\n+/).map(x=>x.trim()).filter(Boolean); return parts.length>1 ? parts[0] : '';
  }
  function actionTitle(fileName, code){
    return fileName.replace(/\.xlsx?$|\.csv$/i,'').replace(code,'').replace(/^\s*[-_]+|\s*[-_]+$/g,'').replace(/\s*[_-]\s*(Inscripci[oó]n|Inscripcion).*$/i,'').trim() || code;
  }
  function yearIn(fileName, rows=[]){
    const y=String(fileName).match(/20\d{2}/)?.[0]; if(y) return Number(y);
    for(const r of rows){ for(const v of Object.values(r)){ const m=String(v??'').match(/20\d{2}/); if(m) return Number(m[0]) }}
    return new Date().getFullYear();
  }
  function splitTutors(v){
    return unique(String(v||'').split(/\n|;/).map(x=>x.trim().replace(/^[-•]+/,'').trim()).filter(Boolean).map(x=>x.replace(/\s*-\s*\d{7,8}\s*$/,'')));
  }

  function parseWorkbook(file, wb){
    const code=mainCodeIn(file.name);
    if(!code) throw new Error('No se detectó un código de acción tipo C0000 en el nombre del archivo.');
    const allSheets={};
    wb.SheetNames.forEach(name=>{ allSheets[name]=XLSX.utils.sheet_to_json(wb.Sheets[name],{defval:'',raw:true}) });
    const sheetBy=(term)=>Object.entries(allSheets).find(([n])=>normalize(n).includes(term))?.[1] || [];
    const proposalsRows=sheetBy('propuesta');
    const regRows=sheetBy('inscrip');
    const attRows=Object.entries(allSheets).find(([n])=>normalize(n)==='asistencias')?.[1] || sheetBy('asisten');
    const year=yearIn(file.name,[...proposalsRows.slice(0,4),...regRows.slice(0,4)]);
    const title=actionTitle(file.name,code);

    const proposals=proposalsRows.map(raw=>{
      const m=mapRow(raw);
      const pcode=(codeIn(pick(m,['Codigo','Código'])) || code).toUpperCase();
      const commission=String(pick(m,['Comisión','Comision','Taller','Propuesta'])||pcode).trim();
      const meetingCols=Object.entries(raw).filter(([k,v])=>/^enc\.?\s*\d+/i.test(String(k)) && v).map(([k,v])=>({label:k,text:String(v),date:isoDate(v,year)}));
      const baseDate=isoDate(pick(m,['Fecha']),year);
      if(baseDate && !meetingCols.length) meetingCols.push({label:'Encuentro',text:formatDate(pick(m,['Fecha'])),date:baseDate});
      return {
        actionCode:code, code:pcode, commission,
        area:String(pick(m,['Área','Area'])||'').trim(),
        formation:String(pick(m,['Formación','Formacion'])||'').trim(),
        venue:String(pick(m,['Sede'])||'').trim(),
        shift:String(pick(m,['Turno','Horario'])||'').trim(),
        capacity:num(pick(m,['Cupo'])),
        registeredReported:num(pick(m,['# Inscr.','# Inscr'])),
        tutors:splitTutors(pick(m,['Capacitador','Tutor','Capacitadores'])),
        meetings:meetingCols
      };
    }).filter(r=>r.code);

    const pMap=new Map(proposals.map(p=>[p.code,p]));

    const registrations=regRows.map(raw=>{
      const m=mapRow(raw);
      let pcode=codeIn(pick(m,['Codigo','Código','Taller','Propuesta'])) || code;
      pcode=pcode.toUpperCase();
      const p=pMap.get(pcode);
      const schoolRaw=pick(m,['Establecimiento','Escuela / Establecimiento','Escuela']);
      const school=cleanSchool(schoolRaw);
      return {
        actionCode:code, commissionCode:pcode,
        dni:String(pick(m,['DNI'])||'').replace(/\.0$/,'').trim(),
        cuil:String(pick(m,['Cuil','CUIL'])||'').trim(),
        name:[pick(m,['Nombre','Nombre/s']),pick(m,['Apellido','Apellido/s'])].filter(Boolean).join(' ').trim(),
        email:String(pick(m,['Correo','Email'])||'').trim(),
        school:String(pick(m,['ESCUELA','Escuela','Establecimiento','Escuela / Establecimiento'])||school||'').trim(),
        cue:String(pick(m,['CUE','Codigo CUE','Código CUE'])||'').trim(),
        dependency:String(pick(m,['DEPENDENCIA','Dependencia','Dep. Fun'])||parseDependencyFromSchool(schoolRaw)||'').trim(),
        sector:String(pick(m,['SECTOR DE GESTIÓN','Sector de Gestión','Sector de Gestion','Sector Gestión'])||'').trim(),
        comuna:String(pick(m,['COMUNA','Comuna'])||'').trim(),
        status:statusNorm(pick(m,['ESTADO','Estado'])||'Activo'),
        statusDate:isoDate(pick(m,['FECHA ESTADO','Fecha Estado','Fecha de Estado']),year),
        bajaDate:isoDate(pick(m,['FECHA BAJA','Fecha Baja','Fecha de Baja']),year),
        region:String(pick(m,['DE','DE/Región','DE o Región'])||'').trim(),
        area:String(pick(m,['Area','Área'])||p?.area||'').trim(),
        formation:String(pick(m,['Formación','Formacion','Tipo de Formación'])||p?.formation||'').trim(),
        venue:String(pick(m,['Sede'])||p?.venue||'').trim(),
        shift:String(pick(m,['Turno'])||p?.shift||'').trim(),
        tutor:(p?.tutors||[]).join(' · '),
        registrationDate:isoDate(pick(m,['FECHA','Fecha','Fecha y hora']),year),
        source:file.name
      };
    }).filter(r=>idOf(r));

    const attendance=attRows.map(raw=>{
      const m=mapRow(raw);
      let pcode=codeIn(pick(m,['Codigo','Código','Comision','Comisión','Taller','Propuesta'])) || code;
      pcode=pcode.toUpperCase();
      const p=pMap.get(pcode);
      const encounter=String(pick(m,['Encuentro','Encuentro N°','Encuentro N','Enc.'])||'').trim();
      let eventDate='';
      if(p){
        const meet=encounter ? p.meetings.find(x=>normalize(x.label)===normalize(encounter)) : p.meetings[0];
        eventDate=meet?.date || '';
      }
      if(!eventDate) eventDate=isoDate(pick(m,['Fecha de encuentro','Fecha']),year);
      const schoolRaw=pick(m,['Establecimiento','Escuela / Establecimiento','Escuela']);
      return {
        actionCode:code, commissionCode:pcode,
        dni:String(pick(m,['DNI'])||'').replace(/\.0$/,'').trim(),
        name:[pick(m,['Nombre','Nombre/s']),pick(m,['Apellido','Apellido/s'])].filter(Boolean).join(' ').trim(),
        email:String(pick(m,['Correo','Email'])||'').trim(),
        school:String(pick(m,['ESCUELA','Escuela','Establecimiento','Escuela / Establecimiento'])||cleanSchool(schoolRaw)||'').trim(),
        cue:String(pick(m,['CUE','Codigo CUE','Código CUE'])||'').trim(),
        dependency:String(pick(m,['DEPENDENCIA','Dependencia','Dep. Fun'])||parseDependencyFromSchool(schoolRaw)||'').trim(),
        sector:String(pick(m,['SECTOR DE GESTIÓN','Sector de Gestión','Sector de Gestion','Sector Gestión'])||'').trim(),
        comuna:String(pick(m,['COMUNA','Comuna'])||'').trim(),
        status:statusNorm(pick(m,['ESTADO','Estado'])||''),
        region:String(pick(m,['DE/Región','DE','DE o Región'])||'').trim(),
        area:String(pick(m,['Area','Área'])||p?.area||'').trim(),
        formation:String(pick(m,['Formación','Formacion','Tipo de Formación'])||p?.formation||'').trim(),
        venue:String(pick(m,['Sede'])||p?.venue||'').trim(),
        shift:String(pick(m,['Turno'])||p?.shift||'').trim(),
        tutor:(p?.tutors||[]).join(' · '),
        encounter:encounter || (p?.meetings?.[0]?.label || ''),
        eventDate,
        capturedAt:isoDate(pick(m,['FECHA','Fecha','Fecha y hora']),year),
        source:file.name
      };
    }).filter(r=>idOf(r));

    const mismatches=[];
    for(const [sheetName,rows] of Object.entries(allSheets)){
      for(const row of rows.slice(0,4000)){
        for(const [k,v] of Object.entries(row)){
          if(!normalize(k).includes('codigo')) continue;
          const mc=mainCodeIn(v);
          if(mc && mc!==code) mismatches.push({sheet:sheetName,column:k,found:mc});
        }
      }
    }
    const mismatchSummary=Object.values(mismatches.reduce((a,x)=>{const k=`${x.sheet}|${x.column}|${x.found}`;a[k]=a[k]||{...x,count:0};a[k].count++;return a},{}));

    return {
      action:{code,title,year,source:file.name},
      proposals, registrations, attendance,
      importInfo:{file:file.name,code,title,proposals:proposals.length,registrations:registrations.length,attendance:attendance.length,mismatches:mismatchSummary}
    };
  }

  function dedupe(rows,keyFn){const m=new Map();for(const r of rows){const k=keyFn(r);if(k)m.set(k,r)}return [...m.values()]}
  function mergeParsed(p){
    const code=p.action.code;
    dataset.actions=dataset.actions.filter(x=>x.code!==code).concat(p.action);
    dataset.proposals=dataset.proposals.filter(x=>x.actionCode!==code).concat(p.proposals);
    dataset.registrations=dataset.registrations.filter(x=>x.actionCode!==code).concat(dedupe(p.registrations,r=>[r.actionCode,r.commissionCode,idOf(r)].join('|')));
    dataset.attendance=dataset.attendance.filter(x=>x.actionCode!==code).concat(dedupe(p.attendance,r=>[r.actionCode,r.commissionCode,idOf(r),r.encounter,r.eventDate,r.capturedAt].join('|')));
    const existedImport=dataset.imports.some(x=>x.code===code);
    dataset.imports=dataset.imports.filter(x=>x.code!==code).concat({...p.importInfo,updated:existedImport,when:new Date().toISOString()});
  }

  async function handleFiles(files){
    if(!files.length)return;
    $('#importSummary').textContent='Procesando archivos...';
    const results=[];
    const successfulCodes=[];
    for(const file of files){
      try{
        const data=await file.arrayBuffer();
        const wb=XLSX.read(data,{type:'array',cellDates:true});
        const parsed=parseWorkbook(file,wb);
        const existed=dataset.actions.some(x=>x.code===parsed.action.code);
        mergeParsed(parsed);
        successfulCodes.push(parsed.action.code);
        results.push({ok:true,updated:existed,...parsed.importInfo});
      }catch(e){
        console.error('Error importando',file.name,e);
        results.push({ok:false,file:file.name,error:e.message});
      }
    }
    await saveState();

    let remoteSaved=0;
    if(successfulCodes.length){
      if(!remoteReady) await ensureRemoteAccess({interactive:true});
      if(remoteReady){
        for(const code of unique(successfulCodes)){
          try{ if(await saveRemoteAction(code)) remoteSaved++; }
          catch(e){
            console.error('Error guardando '+code+' en Supabase',e);
            remoteReady=false;
            setStorageUi('error','La carga quedó local; reconectá para subirla a Supabase.');
            break;
          }
        }
      }
    }

    renderImportResults(results);

    const okCount=results.filter(x=>x.ok).length;
    if(okCount){
      ['filterAction','filterSchool','filterDependency','filterSector','filterComuna','filterStatus','filterDate','filterTutor','filterArea','filterVenue','filterShift','excludeDate'].forEach(id=>{const el=$('#'+id);if(el)el.value=''});
      ['globalSearch','excludeSurname'].forEach(id=>{const el=$('#'+id);if(el)el.value=''});
      if($('#savedFilterSelect'))$('#savedFilterSelect').value='';
      if($('#deleteFilterBtn'))$('#deleteFilterBtn').disabled=true;
      renderAll();
      switchView('dashboard');
      const updatedCount=results.filter(x=>x.ok&&x.updated).length;
      const newCount=okCount-updatedCount;
      const parts=[];
      if(updatedCount)parts.push(updatedCount+' acción(es) actualizada(s)');
      if(newCount)parts.push(newCount+' acción(es) nueva(s)');
      const storageMsg=remoteSaved ? ' · guardado en Supabase' : (remoteReady?'':' · copia local');
      toast((parts.join(' · ')||okCount+' archivo(s) procesado(s)')+storageMsg+'. Panel actualizado.');
    }else{
      renderAll();
      switchView('imports');
      toast('No se pudo cargar ningún archivo. Revisá el detalle.');
    }
    if($('#fileInput')) $('#fileInput').value='';
  }

  function renderImportResults(results=dataset.imports){
    const host=$('#importResults');
    if(!results.length){host.innerHTML='<div class="empty">Todavía no hay cargas.</div>';$('#importSummary').textContent='Todavía no cargaste archivos.';return}
    $('#importSummary').textContent=`${dataset.actions.length} acción(es) cargada(s) en esta prueba.`;
    host.innerHTML=results.slice().reverse().map(r=>{
      if(r.ok===false) return `<div class="import-card"><strong>${esc(r.file)}</strong><div class="warning">${esc(r.error)}</div></div>`;
      const warns=(r.mismatches||[]).map(w=>`<div class="warning">Código distinto detectado: <strong>${esc(w.found)}</strong> en ${esc(w.sheet)} / ${esc(w.column)} (${w.count} registro(s)). No se usa como código principal.</div>`).join('');
      const badge=r.updated?'Actualizada':'Nueva';
      const when=r.when?new Date(r.when).toLocaleString('es-AR'):'';
      return `<div class="import-card"><div class="row"><div><span class="import-code">${esc(r.code)}</span> · <strong>${esc(r.title)}</strong></div><span class="badge">${badge}</span></div><div class="import-meta">${r.proposals||0} comisiones · ${r.registrations||0} inscripciones · ${r.attendance||0} asistencias${when?' · '+esc(when):''}</div>${warns}</div>`;
    }).join('');
  }

  function fillSelect(sel,values,label='Todos'){
    const old=sel.value; sel.innerHTML=`<option value="">${label}</option>`+sortAlpha(unique(values)).map(v=>`<option value="${esc(v)}">${esc(v)}</option>`).join(''); if([...sel.options].some(o=>o.value===old))sel.value=old;
  }

  function currentFilters(){
    return {
      action:$('#filterAction').value,
      school:$('#filterSchool').value,
      dependency:$('#filterDependency').value,
      sector:$('#filterSector').value,
      comuna:$('#filterComuna').value,
      status:$('#filterStatus').value,
      date:$('#filterDate').value,
      tutor:$('#filterTutor').value,
      area:$('#filterArea').value,
      venue:$('#filterVenue').value,
      shift:$('#filterShift').value,
      excludeSurname:normalize($('#excludeSurname').value),
      excludeDate:$('#excludeDate').value,
      q:normalize($('#globalSearch').value)
    };
  }
  function rowDate(r){ return r.eventDate || r.registrationDate || r.capturedAt || ''; }
  function matchesBase(r,f){
    if(f.action && r.actionCode!==f.action)return false;
    if(f.school && r.school!==f.school)return false;
    if(f.dependency && r.dependency!==f.dependency)return false;
    if(f.sector && r.sector!==f.sector)return false;
    if(f.comuna && r.comuna!==f.comuna)return false;
    if(f.status && statusNorm(r.status)!==f.status)return false;
    if(f.excludeSurname && normalize(r.name).includes(f.excludeSurname))return false;
    if(f.tutor && !String(r.tutor||'').includes(f.tutor))return false;
    if(f.area && r.area!==f.area)return false;
    if(f.venue && r.venue!==f.venue)return false;
    if(f.shift && r.shift!==f.shift)return false;
    if(f.q){
      const hay=normalize([r.dni,r.name,r.email,r.school,r.cue,r.dependency,r.sector,r.comuna,r.status,rowDate(r),r.region,r.area,r.commissionCode,r.tutor,r.venue].join(' '));
      if(!hay.includes(f.q))return false;
    }
    return true;
  }
  function matchesRegistration(r,f){
    if(!matchesBase(r,f))return false;
    // FECHA del tablero representa el encuentro. Para el padrón de inscriptos
    // se conserva a quienes estaban activos en esa fecha, no solo a quienes se inscribieron ese día.
    if(f.date && !activeAtDate(r,f.date))return false;
    return true;
  }
  function matchesAttendance(r,f){
    if(!matchesBase(r,f))return false;
    if(f.date && r.eventDate!==f.date)return false;
    if(f.excludeDate && r.eventDate===f.excludeDate)return false;
    return true;
  }

  function refreshFilterOptions(){
    fillSelect($('#filterAction'),dataset.actions.map(x=>x.code),'Todas');
    const action=$('#filterAction')?.value || '';
    const regs=action ? dataset.registrations.filter(x=>x.actionCode===action) : dataset.registrations;
    const props=action ? dataset.proposals.filter(x=>x.actionCode===action) : dataset.proposals;
    fillSelect($('#filterSchool'),regs.map(x=>x.school));
    fillSelect($('#filterDependency'),regs.map(x=>x.dependency));
    fillSelect($('#filterSector'),regs.map(x=>x.sector));
    fillSelect($('#filterComuna'),regs.map(x=>x.comuna));
    fillSelect($('#filterStatus'),regs.map(x=>statusNorm(x.status)).filter(Boolean));
    fillSelect($('#filterTutor'),props.flatMap(x=>x.tutors||[]));
    fillSelect($('#filterArea'),regs.map(x=>x.area).concat(props.map(x=>x.area)));
    fillSelect($('#filterVenue'),regs.map(x=>x.venue).concat(props.map(x=>x.venue)));
    fillSelect($('#filterShift'),regs.map(x=>x.shift).concat(props.map(x=>x.shift)));
    renderSavedFilters();
  }

  function applyFilters(){
    const f=currentFilters();
    filtered.registrations=dataset.registrations.filter(r=>matchesRegistration(r,f));
    filtered.attendance=dataset.attendance.filter(r=>matchesAttendance(r,f));

    // Las propuestas/comisiones deben quedar acotadas a lo que sobrevivió
    // a los filtros de personas (escuela, dependencia, comuna, estado, etc.).
    const scopedCommissionCodes=new Set(
      filtered.registrations.map(r=>r.commissionCode)
        .concat(filtered.attendance.map(r=>r.commissionCode))
        .filter(Boolean)
    );

    filtered.proposals=dataset.proposals.filter(p=>{
      if(f.action && p.actionCode!==f.action)return false;
      if(f.tutor && !(p.tutors||[]).includes(f.tutor))return false;
      if(f.area && p.area!==f.area)return false;
      if(f.venue && p.venue!==f.venue)return false;
      if(f.shift && p.shift!==f.shift)return false;

      const hasPeopleLevelFilter=!!(
        f.school || f.dependency || f.sector || f.comuna || f.status ||
        f.date || f.excludeDate || f.excludeSurname || f.q
      );
      if(hasPeopleLevelFilter && !scopedCommissionCodes.has(p.code))return false;
      return true;
    });
    renderDashboard(); renderDetail();
  }

  function filterSnapshot(){ return {...currentFilters()}; }
  function applyFilterSnapshot(f={}){
    const map={action:'filterAction',school:'filterSchool',dependency:'filterDependency',sector:'filterSector',comuna:'filterComuna',status:'filterStatus',date:'filterDate',tutor:'filterTutor',area:'filterArea',venue:'filterVenue',shift:'filterShift',excludeSurname:'excludeSurname',excludeDate:'excludeDate',q:'globalSearch'};
    for(const [k,id] of Object.entries(map)){const el=$('#'+id); if(el) el.value=f[k]||''}
    applyFilters();
  }
  function renderSavedFilters(){
    const sel=$('#savedFilterSelect'); if(!sel)return;
    const old=sel.value;
    sel.innerHTML='<option value="">Filtro guardado...</option>'+(dataset.savedFilters||[]).map(x=>`<option value="${esc(x.id)}">${esc(x.name)}</option>`).join('');
    if((dataset.savedFilters||[]).some(x=>x.id===old))sel.value=old;
    $('#deleteFilterBtn').disabled=!sel.value;
  }
  async function saveCurrentFilter(){
    const name=prompt('Nombre para este filtro:');
    if(!name?.trim())return;
    const item={id:(globalThis.crypto?.randomUUID?.()||'flt-'+Date.now()),name:name.trim(),config:filterSnapshot(),createdAt:new Date().toISOString()};
    dataset.savedFilters=[...(dataset.savedFilters||[]).filter(x=>normalize(x.name)!==normalize(item.name)),item];
    await saveState(); renderSavedFilters(); $('#savedFilterSelect').value=item.id; $('#deleteFilterBtn').disabled=false; toast('Filtro guardado');
  }
  async function deleteSavedFilter(){
    const id=$('#savedFilterSelect').value;if(!id)return;
    dataset.savedFilters=(dataset.savedFilters||[]).filter(x=>x.id!==id);
    await saveState();renderSavedFilters();toast('Filtro eliminado');
  }

  function groupUnique(rows,labelFn,idFn=idOf){
    const m=new Map();for(const r of rows){const k=labelFn(r)||'Sin dato';if(!m.has(k))m.set(k,new Set());const id=idFn(r);if(id)m.get(k).add(id)}return [...m.entries()].map(([label,s])=>({label,value:s.size}));
  }
  function rate(a,b){return b?Math.round(a/b*1000)/10:0}
  function activeAtDate(r,date){
    const st=statusNorm(r.status);
    if(!date) return st!=='Baja';
    if(r.registrationDate && r.registrationDate>date) return false;
    if(r.bajaDate) return date < r.bajaDate;
    if(st==='Baja') return false;
    return true;
  }
  function eventMetrics(regs,atts){
    const dates=unique(atts.map(x=>x.eventDate).filter(Boolean)).sort();
    return dates.map(date=>{
      const attendees=new Set(atts.filter(a=>a.eventDate===date).map(idOf).filter(Boolean));
      const active=new Set(regs.filter(r=>activeAtDate(r,date)).map(idOf).filter(Boolean));
      return {date,attendees:attendees.size,active:active.size,presentism:rate([...attendees].filter(x=>active.has(x)).length,active.size)};
    });
  }

  function renderDashboard(){
    const regs=filtered.registrations, atts=filtered.attendance;
    const regIds=new Set(regs.map(idOf).filter(Boolean)); const attIds=new Set(atts.map(idOf).filter(Boolean));
    $('#kpiRegistered').textContent=regIds.size.toLocaleString('es-AR');
    $('#kpiAttendees').textContent=attIds.size.toLocaleString('es-AR');
    $('#kpiRate').textContent=rate([...attIds].filter(x=>regIds.has(x)).length,regIds.size).toLocaleString('es-AR')+'%';
    $('#kpiSchools').textContent=unique(regs.map(cueOf)).length.toLocaleString('es-AR');
    $('#kpiCommissions').textContent=unique(regs.map(x=>x.commissionCode)).length.toLocaleString('es-AR');
    $('#kpiAttendanceRows').textContent=atts.length.toLocaleString('es-AR');
    const linkedAttIds=new Set([...attIds].filter(x=>regIds.has(x)));
    const schoolsReg=unique(regs.map(cueOf));
    const schoolsAtt=new Set(atts.map(cueOf).filter(Boolean));
    $('#insightActions').textContent=unique(regs.map(x=>x.actionCode).concat(atts.map(x=>x.actionCode))).length.toLocaleString('es-AR');
    $('#insightNoShow').textContent=[...regIds].filter(x=>!linkedAttIds.has(x)).length.toLocaleString('es-AR');
    $('#insightSchoolsNoShow').textContent=schoolsReg.filter(x=>x&&!schoolsAtt.has(x)).length.toLocaleString('es-AR');
    $('#exportBtn').disabled=!regs.length;

    const action=$('#filterAction').value;
    const act=dataset.actions.find(x=>x.code===action);
    $('#subtitle').textContent=act ? `${act.code} · ${act.title}` : (dataset.actions.length ? `${dataset.actions.length} acciones cargadas · filtros interactivos` : 'Carga una base para empezar a analizar.');

    const metrics=eventMetrics(regs,atts);
    const selectedDate=$('#filterDate').value;
    const currentMetric=selectedDate ? metrics.find(x=>x.date===selectedDate) : (metrics.length ? metrics[metrics.length-1] : null);
    $('#kpiPresentism').textContent=currentMetric ? currentMetric.presentism.toLocaleString('es-AR')+'%' : '—';
    $('#kpiPresentismHint').textContent=currentMetric ? `${formatDate(currentMetric.date)} · ${currentMetric.attendees}/${currentMetric.active} activos` : 'por encuentro: asistentes / activos';
    chart('attendanceChart','line',metrics.map(x=>formatDate(x.date)),[
      {label:'Asistentes únicos',data:metrics.map(x=>x.attendees),tension:.28,fill:false},
      {label:'Activos',data:metrics.map(x=>x.active),tension:.28,fill:false},
      {label:'Presentismo %',data:metrics.map(x=>x.presentism),tension:.28,fill:false,yAxisID:'y1'}
    ],{
      scales:{
        x:{grid:{display:false},ticks:{color:'#7a8790',font:{size:9}}},
        y:{beginAtZero:true,grid:{color:'#edf1f3'},ticks:{color:'#7a8790',font:{size:9}}},
        y1:{beginAtZero:true,max:100,position:'right',grid:{drawOnChartArea:false},ticks:{callback:v=>v+'%',color:'#7a8790',font:{size:9}}}
      }
    });

    const byArea=groupUnique(regs,r=>r.area||'Sin área').sort((a,b)=>b.value-a.value).slice(0,12);
    chart('areaChart','doughnut',byArea.map(x=>x.label),[{label:'Inscriptos',data:byArea.map(x=>x.value)}]);

    const byDep=groupUnique(regs,r=>r.dependency||'Sin dependencia').sort((a,b)=>b.value-a.value).slice(0,10);
    chart('dependencyChart','bar',byDep.map(x=>x.label),[{label:'Inscriptos',data:byDep.map(x=>x.value)}],{indexAxis:'y'});

    const commRegs=groupUnique(regs,r=>r.commissionCode).sort((a,b)=>b.value-a.value).slice(0,24);
    const attByComm=new Map(groupUnique(atts,r=>r.commissionCode).map(x=>[x.label,x.value]));
    chart('commissionChart','bar',commRegs.map(x=>x.label),[
      {label:'Inscriptos',data:commRegs.map(x=>x.value)},
      {label:'Asistentes',data:commRegs.map(x=>attByComm.get(x.label)||0)}
    ]);

    const schoolNames=new Map();
    [...regs,...atts].forEach(r=>{const k=cueOf(r);if(k&&!schoolNames.has(k))schoolNames.set(k,r.school||r.cue||'Sin escuela')});
    const schoolAtt=groupUnique(atts,r=>cueOf(r)).sort((a,b)=>b.value-a.value).slice(0,10);
    chart('schoolChart','bar',schoolAtt.map(x=>schoolNames.get(x.label)||x.label),[{label:'Asistentes únicos',data:schoolAtt.map(x=>x.value)}],{indexAxis:'y'});

    const venueAtt=groupUnique(atts,r=>r.venue||'Sin sede').sort((a,b)=>b.value-a.value).slice(0,10);
    chart('venueChart','bar',venueAtt.map(x=>x.label),[{label:'Asistentes',data:venueAtt.map(x=>x.value)}],{indexAxis:'y'});

    const tutorAtt=groupUnique(atts,r=>r.tutor||'Sin tutor').sort((a,b)=>b.value-a.value).slice(0,10);
    chart('tutorChart','bar',tutorAtt.map(x=>x.label),[{label:'Asistentes',data:tutorAtt.map(x=>x.value)}],{indexAxis:'y'});

    const shiftAtt=groupUnique(atts,r=>r.shift||'Sin turno').sort((a,b)=>b.value-a.value).slice(0,8);
    chart('shiftChart','doughnut',shiftAtt.map(x=>x.label),[{label:'Asistentes',data:shiftAtt.map(x=>x.value)}]);

    const schools=groupUnique(regs,r=>cueOf(r)).sort((a,b)=>b.value-a.value);
    const attSchool=new Map(groupUnique(atts,r=>cueOf(r)).map(x=>[x.label,x.value]));
    const schoolMeta=new Map();
    regs.forEach(r=>{const k=cueOf(r);if(k&&!schoolMeta.has(k))schoolMeta.set(k,r)});
    $('#schoolTable').innerHTML=schools.slice(0,80).map(s=>{
      const a=attSchool.get(s.label)||0,m=schoolMeta.get(s.label)||{};
      return `<tr><td>${esc(m.cue||'—')}</td><td>${esc(upper(m.school)||'—')}</td><td>${esc(upper(m.dependency)||'—')}</td><td>${esc(upper(m.sector)||'—')}</td><td>${esc(upper(m.comuna)||'—')}</td><td>${s.value}</td><td>${a}</td><td>${rate(a,s.value).toLocaleString('es-AR')}%</td></tr>`
    }).join('') || '<tr><td colspan="8" class="empty">Sin datos.</td></tr>';

    const absentById=new Map();
    regs.filter(r=>!attIds.has(idOf(r))).forEach(r=>{const id=idOf(r);if(id&&!absentById.has(id))absentById.set(id,r)});
    const absent=[...absentById.values()];
    $('#absentTable').innerHTML=absent.slice(0,250).map(r=>`<tr><td>${esc(cleanDni(r.dni)||'—')}</td><td>${esc(r.name||r.email||'—')}</td><td>${esc(upper(r.school)||'—')}</td><td>${esc(formatDate(r.registrationDate)||'—')}</td><td>${esc(upper(r.dependency)||'—')}</td><td>${esc(upper(statusNorm(r.status))||'—')}</td><td>${esc(r.commissionCode||'—')}</td></tr>`).join('') || '<tr><td colspan="7" class="empty">No hay inscriptos ausentes con estos filtros.</td></tr>';
  }

  function chart(id,type,labels,datasets,extra={}){
    try{
      if(charts[id])charts[id].destroy();
      const ctx=document.getElementById(id); if(!ctx)return;
      const styled=datasets.map((d,i)=>{
      if(type==='doughnut') return {...d,backgroundColor:labels.map((_,j)=>PALETTE[j%PALETTE.length]),borderWidth:0,hoverOffset:4};
      if(type==='line') return {...d,borderColor:PALETTE[i%PALETTE.length],backgroundColor:'rgba(22,117,102,.08)',pointBackgroundColor:PALETTE[i%PALETTE.length],pointRadius:3,borderWidth:2.2};
      return {...d,backgroundColor:PALETTE[i%PALETTE.length],borderRadius:6,borderSkipped:false,maxBarThickness:38};
    });
      charts[id]=new Chart(ctx,{
        type,
        data:{labels,datasets:styled},
        options:{
          responsive:true,
          maintainAspectRatio:false,
          interaction:{mode:'nearest',intersect:false},
          plugins:{
            legend:{position:'bottom',labels:{boxWidth:8,usePointStyle:true,padding:14,color:'#6d7983',font:{size:10,weight:600}}},
            tooltip:{backgroundColor:'#10262b',titleColor:'#fff',bodyColor:'#dfe9e7',padding:10,cornerRadius:8}
          },
          scales:type==='doughnut'?{}:{
            x:{grid:{display:false},ticks:{maxRotation:45,minRotation:0,color:'#7a8790',font:{size:9}}},
            y:{beginAtZero:true,grid:{color:'#edf1f3'},ticks:{color:'#7a8790',font:{size:9}}}
          },
          ...extra
        }
      });
    }catch(e){
      console.error('Error renderizando gráfico '+id,e);
    }
  }

  function renderDetail(){
    const q=normalize($('#detailSearch').value);
    const attSet=new Set(filtered.attendance.map(idOf).filter(Boolean));
    const actions=new Map(dataset.actions.map(a=>[a.code,a]));
    const byId=new Map();
    filtered.registrations.filter(r=>!q||normalize([r.dni,r.name,r.school,r.cue,r.dependency,r.sector,r.comuna,r.status,r.commissionCode,r.area].join(' ')).includes(q)).forEach(r=>{const id=idOf(r);if(id&&!byId.has(id))byId.set(id,r)});
    const rows=[...byId.values()].slice(0,1000);
    $('#detailTable').innerHTML=rows.map(r=>`<tr><td>${esc(cleanDni(r.dni)||'—')}</td><td>${esc(r.name||r.email||'—')}</td><td><strong>${esc(r.actionCode)}</strong><br><small>${esc(actions.get(r.actionCode)?.title||'')}</small></td><td>${esc(upper(r.school)||'—')}</td><td>${esc(formatDate(r.registrationDate)||'—')}</td><td>${esc(upper(r.dependency)||'—')}</td><td>${esc(upper(r.sector)||'—')}</td><td>${esc(upper(r.comuna)||'—')}</td><td>${esc(upper(statusNorm(r.status))||'—')}</td><td>${esc(r.area||'—')}</td><td>${esc(r.commissionCode||'—')}</td><td>${attSet.has(idOf(r))?'<span class="badge">Sí</span>':'<span class="badge no">No</span>'}</td></tr>`).join('') || '<tr><td colspan="12" class="empty">Sin datos para mostrar.</td></tr>';
  }

  function refreshSourceActionOptions(){
    const input=$('#sourceAction'); if(!input) return;
    input.value=String(input.value||'').toUpperCase();
  }

  function gidFromSheetUrl(url=''){
    return String(url).match(/[?#&]gid=(\d+)/)?.[1] || '';
  }

  function gvizRowsFromResponse(resp){
    if(!resp || resp.status!=='ok' || !resp.table) throw new Error(resp?.errors?.[0]?.detailed_message || 'Google no devolvió datos utilizables.');
    const cols=(resp.table.cols||[]).map((c,i)=>String(c?.label||c?.id||('Columna '+(i+1))).trim());
    return (resp.table.rows||[]).map(row=>{
      const out={};
      cols.forEach((label,i)=>{
        let v=row?.c?.[i]?.v ?? '';
        if(typeof v==='string'){
          const m=v.match(/^Date\((\d{4}),(\d{1,2}),(\d{1,2})(?:,(\d+),(\d+),(\d+))?\)$/);
          if(m) v=new Date(Number(m[1]),Number(m[2]),Number(m[3]),Number(m[4]||0),Number(m[5]||0),Number(m[6]||0));
        }
        out[label]=v;
      });
      return out;
    });
  }

  function loadGvizSheet(spreadsheetId,{sheet='',gid=''}={}){
    return new Promise((resolve,reject)=>{
      const cb='__copesGviz_'+Date.now()+'_'+Math.random().toString(36).slice(2);
      const script=document.createElement('script');
      let done=false;
      const cleanup=()=>{
        delete globalThis[cb];
        script.remove();
      };
      const timer=setTimeout(()=>{
        if(done)return; done=true; cleanup();
        reject(new Error((sheet||('gid '+gid))+': sin respuesta de Google. Verificá que sea accesible por link.'));
      },12000);
      globalThis[cb]=(resp)=>{
        if(done)return; done=true; clearTimeout(timer); cleanup();
        try{ resolve(gvizRowsFromResponse(resp)); }catch(e){ reject(e); }
      };
      const params=new URLSearchParams();
      if(sheet) params.set('sheet',sheet);
      if(gid) params.set('gid',gid);
      params.set('tqx','responseHandler:'+cb);
      script.src='https://docs.google.com/spreadsheets/d/'+encodeURIComponent(spreadsheetId)+'/gviz/tq?'+params.toString();
      script.async=true;
      script.onerror=()=>{
        if(done)return; done=true; clearTimeout(timer); cleanup();
        reject(new Error((sheet||('gid '+gid))+': Google bloqueó la lectura.'));
      };
      document.head.appendChild(script);
    });
  }

  function classifySheetRows(rows){
    if(!rows?.length)return '';
    const keys=Object.keys(rows[0]||{}).map(normalize);
    const joined=keys.join(' | ');
    if(joined.includes('cupo') && (joined.includes('capacitador') || joined.includes(' inscr'))) return 'Propuestas';
    if(joined.includes('encuentro') || (joined.includes('comision') && joined.includes('codigo') && joined.includes('dni'))) return 'Asistencias';
    if(joined.includes('dni') && (joined.includes('escuela') || joined.includes('establecimiento'))) return 'Inscripciones';
    return '';
  }

  async function workbookFromGoogleSource(source){
    const spreadsheetId=source.spreadsheetId||spreadsheetIdFromUrl(source.url);
    if(!spreadsheetId) throw new Error('Link de Google Sheets inválido.');
    const wb=XLSX.utils.book_new();
    let found=0;
    const messages=[];

    for(const sheetName of ['Propuestas','Inscripciones','Asistencias']){
      try{
        const rows=await loadGvizSheet(spreadsheetId,{sheet:sheetName});
        if(rows.length){
          XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(rows),sheetName);
          found++;
        }
      }catch(e){ messages.push(e?.message||String(e)); }
    }

    if(!found){
      const gid=gidFromSheetUrl(source.url);
      if(gid){
        try{
          const rows=await loadGvizSheet(spreadsheetId,{gid});
          const kind=classifySheetRows(rows);
          if(kind && rows.length){
            XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(rows),kind);
            found++;
          }
        }catch(e){ messages.push(e?.message||String(e)); }
      }
    }

    if(!found) throw new Error(messages.join(' · ') || 'No pude leer Propuestas, Inscripciones ni Asistencias.');
    return wb;
  }

  function detectActionCodeFromWorkbook(wb){
    const preferred=['Propuestas','Inscripciones','Asistencias'];
    for(const name of preferred){
      if(!wb.Sheets[name]) continue;
      const rows=XLSX.utils.sheet_to_json(wb.Sheets[name],{defval:'',raw:true});
      for(const row of rows.slice(0,1000)){
        for(const v of Object.values(row)){
          const code=mainCodeIn(v);
          if(code) return code;
        }
      }
    }
    return '';
  }

  async function syncSourceNow(sourceId,{silent=false}={}){
    const src=(dataset.sources||[]).find(x=>x.id===sourceId);
    if(!src || src.status==='syncing') return;
    if(src.authMode!=='public_link'){
      src.status='pending_backend';
      src.lastSyncMessage='Google bloquea esta Sheet privada fuera de una sesión autorizada. El enlace quedó registrado; la carga por Excel sigue disponible.';
      await saveState(); renderSources();
      if(!silent)toast('Sheet privada: queda pendiente de conexión backend');
      return;
    }

    src.status='syncing';
    src.lastSyncMessage='Leyendo Google Sheets...';
    renderSources();

    try{
      const wb=await workbookFromGoogleSource(src);
      const detectedCode=detectActionCodeFromWorkbook(wb);
      if(detectedCode && (!src.actionCode || src.actionCode==='AUTO')){
        src.actionCode=detectedCode;
        if(!dataset.actions.some(a=>a.code===detectedCode)){
          dataset.actions.push({code:detectedCode,title:src.name||detectedCode,year:new Date().getFullYear(),source:'Google Sheets'});
        }
      }
      if(!/^C\d{4}$/.test(src.actionCode||'')) throw new Error('No pude detectar el código de acción C#### dentro de la planilla.');
      const fakeFile={name:src.actionCode+' - '+(src.name||'Google Sheets')+'.xlsx'};
      const parsed=parseWorkbook(fakeFile,wb);
      mergeParsed(parsed);

      src.status='ok';
      src.lastSyncAt=new Date().toISOString();
      src.lastSyncMessage=parsed.registrations.length+' inscripciones · '+parsed.attendance.length+' asistencias · '+parsed.proposals.length+' propuestas';
      await saveState();
      if(remoteReady){
        try{ await saveRemoteAction(src.actionCode); }
        catch(e){ console.error('No se pudo persistir la sincronización en Supabase',e); }
      }
      renderAll();
      if(!silent){
        switchView('dashboard');
        toast('Sincronización completada: '+src.actionCode);
      }
    }catch(e){
      console.error('Error sincronizando Google Sheets',e);
      const msg=e?.message||'No se pudo sincronizar.';
      if(/sin respuesta de Google|bloqueó la lectura|pantalla de acceso|HTTP 401|HTTP 403|accesible por link/i.test(msg)){
        src.status='pending_backend';
        src.authMode='private_backend';
        src.lastSyncMessage='La Sheet es privada. El enlace quedó guardado y necesita conexión backend para sincronizar.';
      }else{
        src.status='error';
        src.lastSyncMessage=msg;
      }
      await saveState();
      renderSources();
      if(!silent)toast('No se pudo sincronizar '+src.actionCode);
    }
  }

  function startSourceAutoSync(){
    const runDue=()=>{
      const now=Date.now();
      (dataset.sources||[]).filter(s=>s.active!==false && s.authMode==='public_link').forEach(s=>{
        const intervalMs=(Number(s.intervalMinutes)||5)*60000;
        const last=s.lastSyncAt ? new Date(s.lastSyncAt).getTime() : 0;
        const pending=!s.lastSyncAt || s.status==='pending_backend' || !s.status;
        if(pending || now-last>=intervalMs) syncSourceNow(s.id,{silent:true});
      });
    };
    setTimeout(runDue,500);
    setInterval(runDue,60000);
  }

  function renderSources(){
    if(!$('#sourceTable')) return;
    refreshSourceActionOptions();
    const sources=dataset.sources||[];
    $('#sourceCount').textContent=sources.length.toLocaleString('es-AR');
    $('#sourceActiveCount').textContent=sources.filter(x=>x.active!==false).length.toLocaleString('es-AR');
    $('#sourcePendingCount').textContent=sources.filter(x=>x.status==='pending_backend'||!x.status).length.toLocaleString('es-AR');

    $('#sourceTable').innerHTML=sources.slice().sort((a,b)=>(b.createdAt||'').localeCompare(a.createdAt||'')).map(s=>{
      const sid=s.spreadsheetId||spreadsheetIdFromUrl(s.url);
      const status=s.status||'pending_backend';
      return `<tr>
        <td><strong>${esc(s.actionCode||'—')}</strong></td>
        <td><span class="source-name">${esc(s.name||'Google Sheet')}</span><span class="source-id">${esc(sid||s.url||'')}</span></td>
        <td>${esc(sourceAuthLabel(s.authMode))}</td>
        <td>cada ${Number(s.intervalMinutes)||5} min</td>
        <td><span class="source-status ${status==='ok'?'ok':status==='error'?'error':'pending'}">${esc(sourceStatusLabel(status))}</span>${s.lastSyncMessage?`<span class="source-id" title="${esc(s.lastSyncMessage)}">${esc(s.lastSyncMessage)}</span>`:''}</td>
        <td>${s.lastSyncAt?new Date(s.lastSyncAt).toLocaleString('es-AR'):'—'}</td>
        <td><button class="source-action-btn" data-sync-source="${esc(s.id)}">Sincronizar</button> <button class="source-action-btn" data-remove-source="${esc(s.id)}">Quitar</button></td>
      </tr>`;
    }).join('') || '<tr><td colspan="7" class="empty">Todavía no registraste fuentes. Podés asociar el link de cada Google Sheet desde el formulario.</td></tr>';

    document.querySelectorAll('[data-sync-source]').forEach(btn=>btn.addEventListener('click',()=>syncSourceNow(btn.dataset.syncSource)));
    document.querySelectorAll('[data-remove-source]').forEach(btn=>btn.addEventListener('click',async()=>{
      const id=btn.dataset.removeSource;
      const src=(dataset.sources||[]).find(x=>x.id===id);
      if(!src) return;
      if(!confirm(`¿Quitar la fuente ${src.actionCode||''} de esta configuración local?`)) return;
      dataset.sources=dataset.sources.filter(x=>x.id!==id);
      await saveState(); renderSources(); toast('Fuente quitada de la prueba local');
    }));
  }

  async function saveSourceFromForm(e){
    e.preventDefault();
    const typedCode=String($('#sourceAction').value||'').trim().toUpperCase();
    const actionCode=typedCode || 'AUTO';
    const url=$('#sourceUrl').value.trim();
    if(typedCode && !/^C\d{4}$/.test(typedCode)){toast('Usá un código C#### o dejalo vacío para detección automática');return}
    if(!url){toast('Pegá el link de Google Sheets');return}
    const spreadsheetId=spreadsheetIdFromUrl(url);
    if(!spreadsheetId){toast('El link no parece ser una Google Sheet válida');return}

    const duplicate=(dataset.sources||[]).find(x=>x.spreadsheetId===spreadsheetId);
    if(duplicate){toast('Esa fuente ya está registrada para la acción');return}

    const source={
      id:(globalThis.crypto?.randomUUID?.() || 'src-'+Date.now()),
      actionCode,
      name:$('#sourceName').value.trim() || `${actionCode} · Google Sheets`,
      url,
      spreadsheetId,
      authMode:$('#sourceAuthMode').value,
      intervalMinutes:Number($('#sourceInterval').value)||5,
      active:true,
      status:'pending_backend',
      lastSyncAt:null,
      createdAt:new Date().toISOString()
    };
    dataset.sources=[...(dataset.sources||[]),source];
    if(actionCode!=='AUTO' && !dataset.actions.some(a=>a.code===actionCode)){
      dataset.actions.push({
        code:actionCode,
        title:$('#sourceName').value.trim() || actionCode,
        year:new Date().getFullYear(),
        source:'Google Sheets'
      });
    }
    await saveState();
    $('#sourceForm').reset();
    $('#sourceInterval').value='5';
    renderSources();
    refreshFilterOptions();
    if(source.authMode==='public_link'){
      toast('Link registrado. Probando acceso público...');
      await syncSourceNow(source.id);
    }else{
      source.status='pending_backend';
      source.lastSyncMessage='Google Sheet privada registrada. Pendiente de conexión backend.';
      await saveState();
      renderSources();
      toast('Google Sheet privada registrada');
    }
  }

  function renderAll(){
    refreshFilterOptions(); renderImportResults(); renderSources(); applyFilters();
  }

  function switchView(name){
    $$('.view').forEach(x=>x.classList.remove('active')); $$('.nav-item').forEach(x=>x.classList.remove('active'));
    $('#view-'+name)?.classList.add('active'); document.querySelector(`.nav-item[data-view="${name}"]`)?.classList.add('active');
  }

  function exportCsv(){
    const rows=filtered.registrations.map(r=>({...r,asistio:filtered.attendance.some(a=>idOf(a)===idOf(r))?'SI':'NO'}));
    if(!rows.length)return;
    const ws=XLSX.utils.json_to_sheet(rows); const csv=XLSX.utils.sheet_to_csv(ws);
    const blob=new Blob([csv],{type:'text/csv;charset=utf-8'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='analizador_copes_filtrado.csv';a.click();URL.revokeObjectURL(url);
  }

  function bind(){
    $$('.nav-item').forEach(b=>b.addEventListener('click',()=>switchView(b.dataset.view)));
    $('#pickFiles').addEventListener('click',()=>$('#fileInput').click());
    $('#fileInput').addEventListener('change',e=>handleFiles([...e.target.files]));
    const dz=$('#dropzone');
    ['dragenter','dragover'].forEach(ev=>dz.addEventListener(ev,e=>{e.preventDefault();dz.classList.add('drag')}));
    ['dragleave','drop'].forEach(ev=>dz.addEventListener(ev,e=>{e.preventDefault();dz.classList.remove('drag')}));
    dz.addEventListener('drop',e=>handleFiles([...e.dataTransfer.files]));
    ['filterSchool','filterDependency','filterSector','filterComuna','filterStatus','filterDate','filterTutor','filterArea','filterVenue','filterShift','excludeDate'].forEach(id=>$('#'+id).addEventListener('change',applyFilters));
    $('#filterAction').addEventListener('change',()=>{refreshFilterOptions();applyFilters()});
    ['globalSearch','excludeSurname'].forEach(id=>$('#'+id).addEventListener('input',applyFilters));
    $('#detailSearch').addEventListener('input',renderDetail);
    $('#savedFilterSelect').addEventListener('change',()=>{const id=$('#savedFilterSelect').value;$('#deleteFilterBtn').disabled=!id;const f=(dataset.savedFilters||[]).find(x=>x.id===id);if(f)applyFilterSnapshot(f.config)});
    $('#saveFilterBtn').addEventListener('click',saveCurrentFilter);
    $('#deleteFilterBtn').addEventListener('click',deleteSavedFilter);
    $('#clearFilters').addEventListener('click',()=>{['filterAction','filterSchool','filterDependency','filterSector','filterComuna','filterStatus','filterDate','filterTutor','filterArea','filterVenue','filterShift','excludeDate'].forEach(id=>$('#'+id).value='');['globalSearch','excludeSurname'].forEach(id=>$('#'+id).value='');$('#savedFilterSelect').value='';$('#deleteFilterBtn').disabled=true;applyFilters()});
    $('#exportBtn').addEventListener('click',exportCsv);
    $('#resetBtn').addEventListener('click',async()=>{
      if(confirm('¿Limpiar solamente los datos de este navegador? Los datos guardados en Supabase NO se eliminan.')){
        await clearState();
        toast('Copia local limpiada. Podés recargar desde Supabase.');
        if(remoteReady) await initRemotePersistence();
      }
    });
    $('#storageStatusBtn')?.addEventListener('click',async()=>{
      if(remoteReady){
        try{
          const remote=await remoteRequest('load');
          for(const row of (remote.actions||[])) applyActionSnapshot(row.payload);
          if(Array.isArray(remote.config?.sources)) dataset.sources=remote.config.sources;
          if(Array.isArray(remote.config?.savedFilters)) dataset.savedFilters=remote.config.savedFilters;
          await saveState();renderAll();
          toast('Datos recargados desde Supabase');
        }catch(e){
          console.error(e);remoteReady=false;setStorageUi('error');
        }
      }else{
        const ok=await ensureRemoteAccess({interactive:true});
        if(ok){await initRemotePersistence();renderAll()}
      }
    });
    $('#storageKeyForm')?.addEventListener('submit',e=>{
      e.preventDefault();
      closeStorageModal($('#storageKeyInput').value);
    });
    $('#storageKeyCancel')?.addEventListener('click',()=>closeStorageModal(''));
    $('#sourceForm')?.addEventListener('submit',saveSourceFromForm);
    $('#sourceAction')?.addEventListener('input',e=>{e.target.value=e.target.value.toUpperCase().replace(/[^C0-9]/g,'').slice(0,5)});
  }

  async function init(){
    bind();
    await loadState();
    await initRemotePersistence();
    renderAll();
    startSourceAutoSync();
    if(!dataset.actions.length) switchView('imports');
  }
  init();
})();