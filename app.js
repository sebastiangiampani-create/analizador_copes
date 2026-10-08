(() => {
  const DB_NAME = 'analizador_copes_v1';
  const STORE = 'state';
  const KEY = 'dataset';
  const EMPTY = { actions: [], proposals: [], registrations: [], attendance: [], bajas: [], tutors: [], imports: [], sources: [], manualTutorCatalog: [], manualTutorAssignments: [], savedFilters: [], customFields: [], masters:{schools:[],areas:[],cargos:[]} };
  const REMOTE_ENDPOINT = 'https://qchnawvoensqnynsuhfu.supabase.co/functions/v1/copes-state';
  const REMOTE_KEY_STORAGE = 'analizador_copes_workspace_key_v1';
  const TUTOR_COURSE_SOURCE={
    id:'tutor-course-master',
    sourceKind:'tutor_courses',
    actionCode:'GLOBAL',
    name:'Tutores y cursos',
    url:'https://docs.google.com/spreadsheets/d/1m6Pf_92q3mGTJN4XO6n4v74xv1zOk2n1PeSQNgd7DhM/edit?gid=610453907#gid=610453907',
    spreadsheetId:'1m6Pf_92q3mGTJN4XO6n4v74xv1zOk2n1PeSQNgd7DhM',
    gid:'610453907',
    authMode:'backend_link',
    intervalMinutes:5,
    active:true,
    locked:true
  };
  let remoteReady = false;
  let remoteInitPromise = null;
  let storageModalResolve = null;
  let configSaveTimer = null;
  let dataset = structuredClone(EMPTY);
  let charts = {};
  const PALETTE = ['#167566','#2f7fe0','#7b68c7','#d18a3a','#3aa7a0','#7d8c99','#bd6a5a','#5d9b63','#8a6bb8','#c49a3f'];
  let filtered = { registrations: [], attendance: [], bajas: [], proposals: [] };

  const CHART_PREF_KEY='analisis_acciones_chart_types_v1';
  const REPORT_DRAFT_KEY='analisis_acciones_report_draft_v1';
  const CHART_TYPE_LABELS={
    bar:'Barras verticales',
    hbar:'Barras horizontales',
    line:'Líneas',
    doughnut:'Torta anillo',
    pie:'Torta',
    polarArea:'Área polar',
    radar:'Radar'
  };
  const CHART_META={
    attendanceChart:{title:'Presentismo por fecha',defaultType:'line',allowed:['line','bar']},
    presentismPercentChart:{title:'% de presentismo por fecha',defaultType:'bar',allowed:['bar','line']},
    areaCompareChart:{title:'Inscriptos vs asistentes por área',defaultType:'hbar',allowed:['bar','hbar','line','radar']},
    areaChart:{title:'Docentes por área',defaultType:'hbar',allowed:['bar','hbar','doughnut','pie','polarArea','radar']},
    dependencyChart:{title:'Por dependencia',defaultType:'hbar',allowed:['bar','hbar','doughnut','pie','polarArea']},
    commissionChart:{title:'Comisiones',defaultType:'bar',allowed:['bar','hbar','line','radar']},
    schoolChart:{title:'Escuelas',defaultType:'hbar',allowed:['bar','hbar','doughnut','pie','polarArea']},
    venueChart:{title:'Sedes',defaultType:'hbar',allowed:['bar','hbar','doughnut','pie','polarArea']},
    tutorChart:{title:'Tutores / capacitadores',defaultType:'hbar',allowed:['bar','hbar','doughnut','pie','polarArea']},
    cargoChart:{title:'Docentes por cargo',defaultType:'hbar',allowed:['bar','hbar','doughnut','pie','polarArea','radar']},
    shiftChart:{title:'Turnos',defaultType:'doughnut',allowed:['bar','hbar','doughnut','pie','polarArea']}
  };
  const KPI_META={
    kpiRegistered:'Docentes inscriptos',
    kpiAttendees:'Docentes asistentes',
    kpiRate:'Asistencia',
    kpiPresentism:'Presentismo',
    kpiSchools:'Escuelas representadas',
    kpiParticipatingSchools:'Escuelas participantes',
    kpiCommissions:'Comisiones',
    kpiAttendanceRows:'Registros de asistencia',
    insightNoShow:'Inscriptos sin asistencia',
    insightSchoolsNoShow:'Escuelas sin asistencia',
    insightBajas:'Bajas cruzadas'
  };
  const TABLE_META={
    schoolTable:'Escuelas con participación',
    absentTable:'Inscriptos sin asistencia',
    bajasTable:'Bajas'
  };

  function readLocalJson(key,fallback){
    try{return JSON.parse(localStorage.getItem(key)||'null')||fallback}catch{return fallback}
  }
  let chartPrefs=readLocalJson(CHART_PREF_KEY,{});
  let reportDraft={title:'Informe de acciones formativas',subtitle:'',notes:'',includeFilters:true,items:[],...readLocalJson(REPORT_DRAFT_KEY,{})};
  const MULTI_FILTER_DEFS={
    filterAction:{label:'ACCIÓN'},
    filterSchool:{label:'ESCUELA'},
    filterDependency:{label:'DEPENDENCIA'},
    filterSector:{label:'SECTOR DE GESTIÓN'},
    filterComuna:{label:'COMUNA'},
    filterStatus:{label:'ESTADO'},
    filterYear:{label:'AÑO'},
    filterEncounter:{label:'ENCUENTRO'},
    filterTutor:{label:'Tutor / capacitador'},
    filterArea:{label:'Área'},
    filterVenue:{label:'Sede'},
    filterShift:{label:'Turno'},
    filterCargo:{label:'Cargo'},
    filterDar:{label:'Es DAR'}
  };
  const multiFilterState={};
  if(!Array.isArray(reportDraft.items))reportDraft.items=[];

  function saveChartPrefs(){
    localStorage.setItem(CHART_PREF_KEY,JSON.stringify(chartPrefs));
    if(remoteReady)scheduleRemoteConfigSave();
  }
  function saveReportDraft(){
    localStorage.setItem(REPORT_DRAFT_KEY,JSON.stringify(reportDraft));
    if(remoteReady)scheduleRemoteConfigSave();
  }


  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];
  const esc = (v='') => String(v ?? '').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));
  const normalize = (v='') => String(v ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
  const parseActionCode = (v='',allowBare=false) => {
    const raw=String(v ?? '').trim().toUpperCase();
    if(!raw)return '';
    // Acepta C0611, C611, CO611 y CO0611 y normaliza siempre a C####.
    const m=raw.match(/\bC(?:O)?[\s_-]?0*(\d{1,4})(?!\d)/i);
    if(m)return 'C'+m[1].padStart(4,'0');
    if(allowBare){
      const b=raw.match(/^0*(\d{1,4})$/);
      if(b)return 'C'+b[1].padStart(4,'0');
    }
    return '';
  };
  const mainCodeIn = (v='') => parseActionCode(v,false);
  const actionCodeValue = (v='') => parseActionCode(v,true);
  const codeIn = (v='') => {
    const raw=String(v ?? '').trim().toUpperCase();
    const m=raw.match(/\bC(?:O)?[\s_-]?0*(\d{1,4})(?:[-_\s]+([A-Z0-9]+(?:[-_][A-Z0-9]+)*))?/i);
    if(!m)return '';
    const action='C'+m[1].padStart(4,'0');
    const suffix=String(m[2]||'').replace(/_/g,'-').replace(/^-+|-+$/g,'');
    return action+(suffix?'-'+suffix:'');
  };
  const num = (v) => Number(String(v ?? '').replace(',','.')) || 0;
  const unique = (arr) => [...new Set(arr.filter(v => v !== null && v !== undefined && String(v).trim() !== '').map(v => String(v).trim()))];
  const sortAlpha = (arr) => arr.sort((a,b) => a.localeCompare(b,'es',{numeric:true,sensitivity:'base'}));
  const cleanDni = (v='') => String(v ?? '').replace(/\D+/g,'').trim();
  const idOf = (r) => {
    const dni=cleanDni(r?.dni);
    return dni ? 'dni:'+dni : String(r?.email || r?.name || '').trim().toLowerCase();
  };
  const cleanDigits = (v='') => String(v ?? '').replace(/\D+/g,'').trim();
  const cleanCue = (v='') => {
    const d=cleanDigits(v);
    if(d.length===8) return d.slice(0,6);
    return d.length===6 ? d : '';
  };
  const cleanCueAnexo = (v='') => {
    const d=cleanDigits(v);
    return d.length===8 ? d : '';
  };
  const cueOf = (r) => cleanCue(r?.cue);
  const schoolKey = (r) => cueOf(r) || (normalize(r?.school||'') ? 'school:'+normalize(r.school) : '');
  const surnameOf = (r) => String(r?.surname || '').trim() || String(r?.name||'').trim().split(/\s+/).slice(-1)[0] || '';
  const statusNorm = (v='') => {
    const n=normalize(v);
    if(n.includes('baja') || n.includes('inactivo')) return 'Baja';
    if(n.includes('activo') || n.includes('alta')) return 'Activo';
    return String(v||'').trim();
  };
  const upper = (v='') => String(v||'').trim().toUpperCase();

  function rowYear(raw,m,fallbackYear=''){
    const direct=pickExact(raw,['AÑO','Año','ANO','Ano','YEAR','Year']) || pick(m,['AÑO','Año','ANO','Ano','YEAR','Year']);
    const n=String(direct||'').match(/20\d{2}/)?.[0];
    return n||String(fallbackYear||'');
  }
  function rowUniverse(raw,m){
    return String(
      pickExact(raw,['UNIVERSO','Universo','UNIVERSO PRESENTISMO','Universo presentismo']) ||
      pick(m,['UNIVERSO','Universo','UNIVERSO PRESENTISMO','Universo presentismo']) || ''
    ).trim();
  }
  function rowDar(raw,m){
    const v=pickExact(raw,['ES DAR','Es DAR','DAR','Es dar']) || pick(m,['ES DAR','Es DAR','DAR']);
    if(v===true)return 'Sí';
    if(v===false)return 'No';
    const n=normalize(v);
    if(['si','s','yes','true','1','dar'].includes(n))return 'Sí';
    if(['no','n','false','0'].includes(n))return 'No';
    return String(v||'').trim();
  }
  function encounterValue(raw,m){
    return String(
      pickExact(raw,['ENCUENTRO','Encuentro','N° ENCUENTRO','Nº ENCUENTRO','NRO ENCUENTRO','Encuentro N°','Encuentro N']) ||
      pick(m,['ENCUENTRO','Encuentro','N° ENCUENTRO','Nº ENCUENTRO','NRO ENCUENTRO','Encuentro N°','Encuentro N','Enc.']) || ''
    ).trim();
  }
  function encounterNumber(v=''){
    const raw=String(v||'').trim();
    const m=raw.match(/(?:encuentro|enc\.?|e)?\s*#?\s*(\d+)/i);
    return m?String(Number(m[1])):'';
  }
  function encounterLabel(encounter,date=''){
    const n=encounterNumber(encounter);
    const e=n?'E'+n:(String(encounter||'').trim()||'');
    const d=date?formatDate(date):'';
    return [e,d].filter(Boolean).join(' · ') || d || e || 'Sin encuentro';
  }

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
    if(!Array.isArray(dataset.bajas)) dataset.bajas=[];
    if(!Array.isArray(dataset.tutors)) dataset.tutors=[];
    if(!Array.isArray(dataset.sources)) dataset.sources=[];
    if(!Array.isArray(dataset.manualTutorCatalog)) dataset.manualTutorCatalog=[];
    if(!Array.isArray(dataset.manualTutorAssignments)) dataset.manualTutorAssignments=[];
    dataset.savedFilters=[];
    dataset.customFields=[];
    if(!dataset.masters || typeof dataset.masters!=='object') dataset.masters={schools:[],areas:[],cargos:[]};
    if(!Array.isArray(dataset.masters.schools)) dataset.masters.schools=[];
    if(!Array.isArray(dataset.masters.areas)) dataset.masters.areas=[];
    if(!Array.isArray(dataset.masters.cargos)) dataset.masters.cargos=[];
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
      text.textContent=detail || 'Las cargas están guardadas online y verificadas.';
      btn.textContent='Supabase: conectado';
      card?.classList.add('storage-connected');
    }else if(mode==='error'){
      title.textContent='Supabase sin conexión';
      text.textContent=detail || 'No se puede cargar una base hasta recuperar la conexión.';
      btn.textContent='Supabase: reconectar';
      card?.classList.add('storage-error');
    }else{
      title.textContent='Supabase requerido';
      text.textContent=detail || 'Conectá Supabase. Las nuevas bases deben quedar guardadas online.';
      btn.textContent='Supabase: conectar';
      card?.classList.add('storage-local');
    }
  }

  async function remoteRequest(op,payload={},keyOverride=''){
    const key=keyOverride || workspaceKey();
    if(!key) throw new Error('missing_workspace_key');
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),60000);
    try{
      const res=await fetch(REMOTE_ENDPOINT,{
        method:'POST',
        headers:{'Content-Type':'application/json','x-copes-key':key},
        body:JSON.stringify({op,...payload}),
        cache:'no-store',
        signal:controller.signal
      });
      const data=await res.json().catch(()=>({ok:false,error:'invalid_response'}));
      if(!res.ok || !data.ok){
        const err=new Error(data.message || data.error || ('HTTP '+res.status));
        err.code=data.error || '';
        err.status=res.status;
        throw err;
      }
      return data;
    }catch(e){
      if(e?.name==='AbortError')throw new Error('Supabase tardó demasiado en responder.');
      throw e;
    }finally{
      clearTimeout(timer);
    }
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

  async function pingRemoteWithRetry(key,{attempts=3}={}){
    let lastError=null;
    for(let attempt=0;attempt<attempts;attempt++){
      try{
        await remoteRequest('ping',{},key);
        return true;
      }catch(e){
        lastError=e;
        const transient=e?.status===502||e?.status===503||e?.status===504||/tardó demasiado|Failed to fetch|network/i.test(e?.message||'');
        if(!transient||attempt===attempts-1)break;
        await new Promise(resolve=>setTimeout(resolve,350*(attempt+1)));
      }
    }
    throw lastError||new Error('remote_ping_failed');
  }

  async function ensureRemoteAccess({interactive=true}={}){
    let key=workspaceKey();
    if(key){
      try{
        await pingRemoteWithRetry(key,{attempts:3});
        remoteReady=true;
        setStorageUi('connected');
        return true;
      }catch(e){
        console.warn('No se pudo validar temporalmente la conexión guardada',e);
        // Solo descartamos la clave si el backend confirma que es inválida.
        if(e?.status===401||e?.code==='invalid_workspace_key'){
          localStorage.removeItem(REMOTE_KEY_STORAGE);
          key='';
        }else{
          remoteReady=false;
          setStorageUi('error','Supabase respondió con un error temporal. Reintentá en unos segundos.');
          return false;
        }
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
      await pingRemoteWithRetry(entered,{attempts:3});
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
    const normalizedAction={
      ...action,
      status:action.status==='finalizada'?'finalizada':'activa',
      finalizedAt:action.status==='finalizada'?(action.finalizedAt||null):null
    };
    return {
      action:normalizedAction,
      proposals:dataset.proposals.filter(x=>x.actionCode===code),
      registrations:dataset.registrations.filter(x=>x.actionCode===code),
      attendance:dataset.attendance.filter(x=>x.actionCode===code),
      bajas:dataset.bajas.filter(x=>x.actionCode===code),
      tutors:dataset.tutors.filter(x=>x.actionCode===code),
      importInfo
    };
  }

  function applyActionSnapshot(payload){
    const code=payload?.action?.code;
    if(!/^C\d{4}$/.test(code||''))return;
    const action={
      ...payload.action,
      status:payload.action?.status==='finalizada'?'finalizada':'activa',
      finalizedAt:payload.action?.status==='finalizada'?(payload.action?.finalizedAt||null):null
    };
    dataset.actions=dataset.actions.filter(x=>x.code!==code).concat(action);
    dataset.proposals=dataset.proposals.filter(x=>x.actionCode!==code).concat(payload.proposals||[]);
    dataset.registrations=dataset.registrations.filter(x=>x.actionCode!==code).concat(payload.registrations||[]);
    dataset.attendance=dataset.attendance.filter(x=>x.actionCode!==code).concat(payload.attendance||[]);
    dataset.bajas=dataset.bajas.filter(x=>x.actionCode!==code).concat(payload.bajas||[]);
    dataset.tutors=dataset.tutors.filter(x=>x.actionCode!==code).concat(payload.tutors||[]);
    dataset.imports=dataset.imports.filter(x=>x.code!==code).concat(payload.importInfo||{code,title:payload.action.title||code,when:new Date().toISOString()});
  }

  function remoteExpectedCounts(payload){
    return {
      proposals:Array.isArray(payload?.proposals)?payload.proposals.length:0,
      registrations:Array.isArray(payload?.registrations)?payload.registrations.length:0,
      attendance:Array.isArray(payload?.attendance)?payload.attendance.length:0,
      bajas:Array.isArray(payload?.bajas)?payload.bajas.length:0,
      tutors:Array.isArray(payload?.tutors)?payload.tutors.length:0
    };
  }

  async function verifyRemotePayload(payload){
    const code=payload?.action?.code;
    const expected=remoteExpectedCounts(payload);
    const check=await remoteRequest('get_action',{actionCode:code});
    const row=check?.action;
    if(!row) throw new Error('remote_verify_missing');
    const got={
      proposals:Number(row.total_propuestas||0),
      registrations:Number(row.total_inscripciones||0),
      attendance:Number(row.total_asistencias||0),
      bajas:Number(row.total_bajas||0),
      tutors:Number(row.total_tutores||0)
    };
    for(const key of Object.keys(expected)){
      if(got[key]!==expected[key]) throw new Error('remote_verify_mismatch_'+key);
    }
    return row;
  }

  async function saveRemotePayload(payload,{retries=1}={}){
    if(!remoteReady)throw new Error('remote_not_ready');
    const code=payload?.action?.code;
    if(!/^C\d{4}$/.test(code||''))throw new Error('invalid_action_code');
    let lastError=null;
    for(let attempt=0;attempt<=retries;attempt++){
      try{
        await remoteRequest('save_action',{actionCode:code,payload});
        await verifyRemotePayload(payload);
        return true;
      }catch(e){
        lastError=e;
        if(attempt<retries) await new Promise(r=>setTimeout(r,350*(attempt+1)));
      }
    }
    throw lastError||new Error('remote_save_failed');
  }

  async function saveRemoteAction(code){
    if(!remoteReady)return false;
    const payload=buildActionSnapshot(code);
    if(!payload)return false;
    await saveRemotePayload(payload);
    return true;
  }

  async function saveRemoteConfig(){
    if(!remoteReady)return;
    await remoteRequest('save_config',{payload:{
      sources:dataset.sources||[],
      manualTutorCatalog:dataset.manualTutorCatalog||[],
      manualTutorAssignments:dataset.manualTutorAssignments||[],
      savedFilters:[],
      customFields:[],
      chartPrefs,
      reportDraft
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

  async function fetchRemoteActionPayload(actionCode){
    let lastError=null;
    for(let attempt=0;attempt<2;attempt++){
      try{
        const result=await remoteRequest('get_action_payload',{actionCode});
        if(!result?.action?.payload)throw new Error('remote_payload_missing');
        return result.action.payload;
      }catch(e){
        lastError=e;
        if(attempt===0)await new Promise(resolve=>setTimeout(resolve,300));
      }
    }
    throw lastError||new Error('remote_payload_failed');
  }

  async function initRemotePersistenceCore(){
    const localSnapshots=(dataset.actions||[]).map(a=>buildActionSnapshot(a.code)).filter(Boolean);
    const localSources=structuredClone(dataset.sources||[]);
    const localManualTutorCatalog=structuredClone(dataset.manualTutorCatalog||[]);
    const localManualTutorAssignments=structuredClone(dataset.manualTutorAssignments||[]);

    const connected=await ensureRemoteAccess({interactive:true});
    if(!connected){
      setStorageUi('error','Conexión obligatoria para cargar bases. Lo que ya esté en este navegador todavía no está garantizado online.');
      return false;
    }

    try{
      // Primero se carga sólo el índice liviano. Los payloads grandes se piden
      // acción por acción para que una base pesada no bloquee toda la aplicación.
      let remote=await remoteRequest('load_index');
      const remoteByCode=new Map((remote.actions||[]).map(r=>[r.action_code,r]));
      let migrated=0;

      for(const payload of localSnapshots){
        const code=payload.action.code;
        const remoteRow=remoteByCode.get(code);
        const localWhen=Date.parse(payload?.importInfo?.when||'')||0;
        const remoteWhen=Date.parse(remoteRow?.updated_at||'')||0;
        if(!remoteRow || (localWhen && localWhen>remoteWhen)){
          setStorageUi('connected','Sincronizando cambios locales de '+code+'...');
          await saveRemotePayload(payload);
          migrated++;
        }
      }

      {
        const mergedSources=Array.isArray(remote.config?.sources)&&remote.config.sources.length ? remote.config.sources : localSources;
        const mergedManualTutorCatalog=Array.isArray(remote.config?.manualTutorCatalog)
          ? remote.config.manualTutorCatalog
          : localManualTutorCatalog;
        const mergedManualTutorAssignments=Array.isArray(remote.config?.manualTutorAssignments)
          ? remote.config.manualTutorAssignments
          : localManualTutorAssignments;
        const mergedChartPrefs=(remote.config?.chartPrefs && typeof remote.config.chartPrefs==='object')?remote.config.chartPrefs:chartPrefs;
        const mergedReportDraft=(remote.config?.reportDraft && typeof remote.config.reportDraft==='object')?remote.config.reportDraft:reportDraft;
        await remoteRequest('save_config',{payload:{
          sources:mergedSources,
          manualTutorCatalog:mergedManualTutorCatalog,
          manualTutorAssignments:mergedManualTutorAssignments,
          savedFilters:[],
          customFields:[],
          chartPrefs:mergedChartPrefs,
          reportDraft:mergedReportDraft
        }});
        remote.config={
          ...(remote.config||{}),
          sources:mergedSources,
          manualTutorCatalog:mergedManualTutorCatalog,
          manualTutorAssignments:mergedManualTutorAssignments,
          chartPrefs:mergedChartPrefs,
          reportDraft:mergedReportDraft
        };
      }

      if(migrated) remote=await remoteRequest('load_index');

      const actionIndex=remote.actions||[];
      dataset=structuredClone(EMPTY);
      dataset.sources=Array.isArray(remote.config?.sources)?remote.config.sources:[];
      dataset.manualTutorCatalog=Array.isArray(remote.config?.manualTutorCatalog)?remote.config.manualTutorCatalog:[];
      dataset.manualTutorAssignments=Array.isArray(remote.config?.manualTutorAssignments)?remote.config.manualTutorAssignments:[];
      dataset.savedFilters=[];
      dataset.customFields=[];
      if(remote.config?.chartPrefs && typeof remote.config.chartPrefs==='object'){
        chartPrefs={...chartPrefs,...remote.config.chartPrefs};
        saveChartPrefs();
      }
      if(remote.config?.reportDraft && typeof remote.config.reportDraft==='object'){
        reportDraft={...reportDraft,...remote.config.reportDraft};
        if(!Array.isArray(reportDraft.items))reportDraft.items=[];
        saveReportDraft();
      }
      dataset.masters={
        schools:Array.isArray(remote.masters?.schools)?remote.masters.schools:[],
        areas:Array.isArray(remote.masters?.areas)?remote.masters.areas:[],
        cargos:Array.isArray(remote.masters?.cargos)?remote.masters.cargos:[]
      };

      for(let i=0;i<actionIndex.length;i++){
        const row=actionIndex[i];
        const code=row.action_code;
        setStorageUi('connected','Cargando bases '+(i+1)+'/'+actionIndex.length+' · '+code+'...');
        const payload=await fetchRemoteActionPayload(code);
        applyActionSnapshot(payload);
        // Cede el hilo al navegador entre bases para evitar que la interfaz
        // parezca congelada con acciones de varios miles de registros.
        await new Promise(resolve=>setTimeout(resolve,0));
      }

      applyMasterDataToDataset({onlyMissing:true});

      await saveState();
      const onlineCount=actionIndex.length;
      setStorageUi('connected',onlineCount+' acción(es) cargada(s) desde Supabase y verificadas'+(migrated?' · '+migrated+' migrada(s) desde este navegador':'')+'.');
      return true;
    }catch(e){
      console.error('Error inicializando persistencia remota',e);
      remoteReady=false;
      setStorageUi('error','No se pudo terminar de cargar la base desde Supabase. La copia online no se borró.');
      toast('No se pudo completar la carga desde Supabase. Reintentá la conexión.');
      return false;
    }
  }

  async function initRemotePersistence(){
    if(remoteInitPromise)return remoteInitPromise;
    remoteInitPromise=initRemotePersistenceCore();
    try{
      return await remoteInitPromise;
    }finally{
      remoteInitPromise=null;
    }
  }

  function spreadsheetIdFromUrl(url=''){
    return String(url).match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/)?.[1] || '';
  }

  function sourceAuthLabel(mode){
    return ({backend_link:'Link · backend',private_backend:'Link · backend',public_link:'Link · backend'})[mode] || mode || 'Link · backend';
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
  function pickExact(raw, keys){
    for(const k of keys){
      if(Object.prototype.hasOwnProperty.call(raw||{},k)){
        const v=raw[k];
        if(v!==null && v!==undefined && String(v).trim()!=='') return v;
      }
    }
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
  function isDependencySchoolLine(v=''){
    const n=normalize(v);
    return n.includes('direccion general') ||
      n.includes('gestion estatal') ||
      n.includes('gestion privada') ||
      n.includes('educacion de gestion estatal') ||
      n.includes('educacion de gestion privada');
  }
  function cleanSchool(v){
    const raw=String(v||'').trim(); if(!raw) return '';
    const parts=raw.split(/\n+/).map(x=>x.trim()).filter(Boolean);
    let candidates=parts.filter(x=>!isDependencySchoolLine(x));
    let s=(candidates.length?candidates[candidates.length-1]:(parts.at(-1)||raw));
    s=s
      .replace(/^[A-Z]-?\d+[A-Z]?\s*\|\s*/i,'')
      .replace(/^(?:direcci[oó]n\s+general[^|:\-]*?(?:gesti[oó]n\s+(?:estatal|privada)))\s*[|:\-]+\s*/i,'')
      .replace(/^(?:gesti[oó]n\s+(?:estatal|privada))\s*[|:\-]+\s*/i,'')
      .replace(/\s*-\s*\d{7,9}\s*$/,'')
      .trim();
    return s;
  }
  function parseDependencyFromSchool(v){
    const raw=String(v||'').trim();
    const parts=raw.split(/\n+/).map(x=>x.trim()).filter(Boolean);
    const explicit=parts.find(isDependencySchoolLine);
    if(explicit)return explicit;
    return raw.match(/direcci[oó]n\s+general[^|:\-]*?(?:gesti[oó]n\s+(?:estatal|privada))/i)?.[0]?.trim() || '';
  }
  function inferSectorFromSchool(v){
    const n=normalize(v);
    if(n.includes('gestion estatal') || n.includes('educacion de gestion estatal'))return 'Estatal';
    if(n.includes('gestion privada') || n.includes('educacion de gestion privada'))return 'Privado';
    return '';
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

  function extractCueAnexo(v=''){
    const s=String(v||'');
    const explicit=s.match(/(?:CUE\s*)?(\d{8})(?!\d)/i);
    return explicit?.[1] || '';
  }

  function schoolCanonical(v=''){
    const replacements={
      esc:'escuela',tec:'tecnica',educ:'educacion',sup:'superior',gral:'general',
      ing:'ingeniero',dr:'doctor',prof:'profesor',pte:'presidente',sta:'santa',
      sto:'santo',ntra:'nuestra',sra:'senora',lib:'libertador',com:'comercio',
      ens:'escuela normal superior',eem:'escuela educacion media',cap:'capitan',
      tte:'teniente',art:'artilleria',cnel:'coronel',mons:'monsenor'
    };
    let tokens=normalize(v).split(/\s+/).filter(Boolean).flatMap(t=>(replacements[t]||t).split(' '));
    tokens=tokens.filter(t=>!['sede','ereingreso','reingreso'].includes(t));
    if(tokens.length>=2 && tokens.at(-2)==='de' && /^\d{1,2}$/.test(tokens.at(-1)) && Number(tokens.at(-1))<=21){
      tokens=tokens.slice(0,-2);
    }
    return tokens.map(t=>/^\d+$/.test(t)?String(Number(t)):t).join(' ');
  }

  function schoolType(v=''){
    const s=schoolCanonical(v);
    if(s.includes('tecnica'))return 'tecnica';
    if(s.includes('comercio'))return 'comercio';
    if(s.includes('educacion media'))return 'media';
    if(s.includes('normal superior'))return 'normal';
    if(s.includes('educacion artistica'))return 'artistica';
    if(s.includes('colegio'))return 'colegio';
    if(s.includes('liceo'))return 'liceo';
    if(s.includes('instituto'))return 'instituto';
    return '';
  }

  function schoolNumberDistrict(v=''){
    const original=String(v||'');
    const n=normalize(original);
    let number=Number(n.match(/\bn\s*0*(\d{1,2})\b/)?.[1]||0)||null;
    let district=Number(n.match(/\bde\s*0*(\d{1,2})\b/)?.[1]||0)||null;
    const slash=original.match(/[Nn][°ºo¬]?\s*0*(\d{1,2})\s*\/\s*0*(\d{1,2})/);
    if(slash){number=Number(slash[1]);district=Number(slash[2])}
    return {number,district};
  }

  function schoolTokens(v=''){
    const stop=new Set(['escuela','colegio','instituto','liceo','educacion','educativa','media','tecnica','superior','normal','en','de','del','la','el','los','las','n','general','doctor','ingeniero','profesor','presidente']);
    return new Set(schoolCanonical(v).split(' ').filter(t=>t.length>2 && !/^\d+$/.test(t) && !stop.has(t)));
  }

  function schoolSimilarity(a,b){
    const A=schoolTokens(a), B=schoolTokens(b);
    let inter=0; for(const t of A)if(B.has(t))inter++;
    const union=new Set([...A,...B]).size;
    const coverage=inter/Math.max(1,Math.min(A.size,B.size));
    const jaccard=inter/Math.max(1,union);
    const fa=schoolNumberDistrict(a), fb=schoolNumberDistrict(b);
    if(fa.number!==null && fb.number!==null && fa.number!==fb.number)return -1;
    if(fa.district!==null && fb.district!==null && fa.district!==fb.district)return -1;
    const ta=schoolType(a),tb=schoolType(b);
    return .6*coverage+.3*jaccard
      +(ta&&tb&&ta===tb?.15:0)
      +(fa.number!==null&&fb.number===fa.number?.12:0)
      +(fa.district!==null&&fb.district===fa.district?.15:0);
  }

  let schoolIndexMemoSource=null;
  let schoolIndexMemo=null;
  let areaLookupMemoSource=null;
  let areaLookupMemo=null;
  let cargoLookupMemoSource=null;
  let cargoLookupMemo=null;

  function schoolSimilarityProfile(profile,prepared){
    const A=profile.tokens, B=prepared.tokens;
    let inter=0; for(const t of A)if(B.has(t))inter++;
    const union=new Set([...A,...B]).size;
    const coverage=inter/Math.max(1,Math.min(A.size,B.size));
    const jaccard=inter/Math.max(1,union);
    const fa=profile.nd, fb=prepared.nd;
    if(fa.number!==null && fb.number!==null && fa.number!==fb.number)return -1;
    if(fa.district!==null && fb.district!==null && fa.district!==fb.district)return -1;
    const ta=profile.type,tb=prepared.type;
    return .6*coverage+.3*jaccard
      +(ta&&tb&&ta===tb?.15:0)
      +(fa.number!==null&&fb.number===fa.number?.12:0)
      +(fa.district!==null&&fb.district===fa.district?.15:0);
  }

  function schoolMasterIndexes(){
    const schools=dataset.masters?.schools||[];
    if(schoolIndexMemo && schoolIndexMemoSource===schools)return schoolIndexMemo;
    const byAnexo=new Map(), byCue=new Map(), byName=new Map(), byCanonical=new Map(), byTypeNumber=new Map(), byTypeNumberDistrict=new Map();
    const prepared=[];
    for(const school of schools){
      const ca=cleanCueAnexo(school.cueanexo), cue=cleanCue(school.cue), name=normalize(school.nombre_norm||school.nombre||'');
      const canonical=schoolCanonical(school.nombre||'');
      const type=schoolType(school.nombre||'');
      const nd=schoolNumberDistrict(school.nombre||'');
      if(ca)byAnexo.set(ca,school);
      if(cue){if(!byCue.has(cue))byCue.set(cue,[]);byCue.get(cue).push(school)}
      if(name){if(!byName.has(name))byName.set(name,[]);byName.get(name).push(school)}
      if(canonical){if(!byCanonical.has(canonical))byCanonical.set(canonical,[]);byCanonical.get(canonical).push(school)}
      if(type && nd.number!==null){
        const k=type+'|'+nd.number;
        if(!byTypeNumber.has(k))byTypeNumber.set(k,[]);
        byTypeNumber.get(k).push(school);
        if(nd.district!==null){
          const kd=k+'|'+nd.district;
          if(!byTypeNumberDistrict.has(kd))byTypeNumberDistrict.set(kd,[]);
          byTypeNumberDistrict.get(kd).push(school);
        }
      }
      prepared.push({school,tokens:schoolTokens(school.nombre||''),type,nd});
    }
    schoolIndexMemoSource=schools;
    schoolIndexMemo={byAnexo,byCue,byName,byCanonical,byTypeNumber,byTypeNumberDistrict,prepared,matchCache:new Map()};
    return schoolIndexMemo;
  }

  function findMasterSchool(row,index=schoolMasterIndexes()){
    const raw=String(row?.schoolRaw||row?.school||'');
    const anexo=cleanCueAnexo(row?.cueAnexo)||extractCueAnexo(raw);
    const cue=cleanCue(row?.cue)||cleanCue(anexo);
    const cleaned=cleanSchool(raw)||row?.school||'';
    const n=normalize(cleaned);
    const cacheKey=[anexo,cue,n].join('|');
    if(index.matchCache.has(cacheKey))return index.matchCache.get(cacheKey);

    let result=null;
    if(anexo && index.byAnexo.has(anexo)) result=index.byAnexo.get(anexo);

    if(!result && cue){
      const candidates=index.byCue.get(cue)||[];
      if(n){
        const named=candidates.find(school=>normalize(school.nombre_norm||school.nombre||'')===n);
        if(named)result=named;
      }
      if(!result && candidates.length===1)result=candidates[0];
    }

    if(!result && n){
      const byName=index.byName.get(n)||[];
      if(byName.length===1)result=byName[0];
    }

    const canonical=schoolCanonical(cleaned);
    if(!result && canonical){
      const exact=index.byCanonical.get(canonical)||[];
      if(exact.length===1)result=exact[0];
    }

    const nd=schoolNumberDistrict(raw), type=schoolType(raw);
    if(!result && type && nd.number!==null && nd.district!==null){
      const structured=index.byTypeNumberDistrict.get(type+'|'+nd.number+'|'+nd.district)||[];
      if(structured.length===1)result=structured[0];
    }
    if(!result && type && nd.number!==null){
      const numbered=index.byTypeNumber.get(type+'|'+nd.number)||[];
      if(numbered.length===1 && schoolSimilarity(raw,numbered[0].nombre)>=.45)result=numbered[0];
    }

    if(!result && raw){
      const profile={tokens:schoolTokens(raw),type,nd};
      let best=null,bestScore=-1,secondScore=-1;
      for(const prepared of index.prepared){
        const score=schoolSimilarityProfile(profile,prepared);
        if(score>bestScore){
          secondScore=bestScore;bestScore=score;best=prepared.school;
        }else if(score>secondScore){
          secondScore=score;
        }
      }
      if(best && bestScore>=.68 && (secondScore<0 || bestScore-secondScore>=.10))result=best;
    }

    index.matchCache.set(cacheKey,result||null);
    return result;
  }

  function classifyArea(v=''){
    const raw=String(v||'').trim();
    if(!raw)return '';
    const areas=dataset.masters?.areas||[];
    if(areaLookupMemoSource!==areas){
      areaLookupMemoSource=areas;
      areaLookupMemo=new Map(areas.map(a=>[normalize(a.area_norm||a.area),a.area]));
    }
    const byNorm=areaLookupMemo||new Map();
    const n=normalize(raw);
    if(byNorm.has(n))return byNorm.get(n);

    // Aproximación genérica guiada por el maestro: no hay alias de áreas escritos a mano.
    const tokens=new Set(n.split(' ').filter(x=>x.length>2));
    let best='',bestScore=0;
    for(const area of areas){
      const an=normalize(area.area_norm||area.area);
      if(!an)continue;
      const at=new Set(an.split(' ').filter(x=>x.length>2));
      const common=[...tokens].filter(x=>at.has(x)).length;
      const union=new Set([...tokens,...at]).size||1;
      let score=common/union;
      if(n===an)score=1;
      else if(n.includes(an)||an.includes(n))score=Math.max(score,.82);
      if(score>bestScore){bestScore=score;best=area.area}
    }
    return bestScore>=.55?best:'';
  }

  function cargoMasterFor(v=''){
    const raw=String(v||'').trim();
    if(!raw)return null;
    const cargos=dataset.masters?.cargos||[];
    if(cargoLookupMemoSource!==cargos){
      cargoLookupMemoSource=cargos;
      cargoLookupMemo=new Map(cargos.map(x=>[normalize(x.origen),x]));
    }
    return (cargoLookupMemo||new Map()).get(normalize(raw))||null;
  }

  function classifyCargo(v=''){
    const raw=String(v||'').trim();
    if(!raw)return '';
    return String(cargoMasterFor(raw)?.categoria||raw).trim();
  }

  function areaFromCargo(v=''){
    return String(cargoMasterFor(v)?.area||'').trim();
  }

  function enrichMasterRow(row,index=schoolMasterIndexes()){
    const out={...row};
    const master=findMasterSchool(out,index);
    if(master){
      out.school=master.nombre||out.school;
      out.cue=cleanCue(master.cue)||out.cue||'';
      out.cueAnexo=cleanCueAnexo(master.cueanexo)||out.cueAnexo||'';
      out.sector=master.sector||out.sector||'';
      out.comuna=master.departamento||out.comuna||'';
      out.dependency=String(out.dependency||'').trim() || String(master.dependency||'').trim() || parseDependencyFromSchool(out.schoolRaw||out.school||'');
      out.masterSchoolMatched=true;
    }else{
      out.cueAnexo=cleanCueAnexo(out.cueAnexo)||extractCueAnexo(out.schoolRaw||out.school||'');
      out.cue=cleanCue(out.cue)||cleanCue(out.cueAnexo);
      out.school=cleanSchool(out.schoolRaw||out.school||'')||out.school||'';
      out.dependency=String(out.dependency||'').trim() || parseDependencyFromSchool(out.schoolRaw||out.school||'');
      out.masterSchoolMatched=false;
    }
    if(!String(out.area||'').trim())out.area=areaFromCargo(out.cargo)||'';
    out.areaClass=classifyArea(out.area)||out.areaClass||out.area||'';
    out.cargoClass=classifyCargo(out.cargo)||out.cargoClass||'';
    return out;
  }

  function applyMasterDataToDataset({onlyMissing=false}={}){
    const idx=schoolMasterIndexes();
    const enrichIfNeeded=(r)=>{
      if(!onlyMissing)return enrichMasterRow(r,idx);
      const schoolDone=Object.prototype.hasOwnProperty.call(r||{},'masterSchoolMatched');
      const areaDone=Object.prototype.hasOwnProperty.call(r||{},'areaClass');
      const cargoDone=Object.prototype.hasOwnProperty.call(r||{},'cargoClass');
      const dependencyDone=String(r?.dependency||'').trim()!=='';
      return schoolDone&&areaDone&&cargoDone&&dependencyDone ? r : enrichMasterRow(r,idx);
    };
    dataset.registrations=(dataset.registrations||[]).map(enrichIfNeeded);
    dataset.attendance=(dataset.attendance||[]).map(enrichIfNeeded);
    dataset.bajas=(dataset.bajas||[]).map(enrichIfNeeded);
    dataset.proposals=(dataset.proposals||[]).map(p=>{
      if(onlyMissing && Object.prototype.hasOwnProperty.call(p||{},'areaClass'))return p;
      return {...p,areaClass:classifyArea(p.area)||p.areaClass||''};
    });
    applyTutorsToDataset();
  }

  function tutorNameFromRow(raw,m){
    return String(
      pickExact(raw,['APELLIDO Y NOMBRE','Apellido y Nombre','Apellido y nombre','NOMBRE Y APELLIDO','Nombre y Apellido']) ||
      pick(m,['APELLIDO Y NOMBRE','Apellido y Nombre','Apellido y nombre','Nombre completo']) ||
      [pick(m,['Apellido','Apellido/s']),pick(m,['Nombre','Nombre/s'])].filter(Boolean).join(' ')
    ).trim();
  }

  function tutorNamesFromRow(raw,m){
    const explicit=[];
    for(const [key,value] of Object.entries(raw||{})){
      const nk=normalize(key);
      if((nk.includes('tutor')||nk.includes('capacitador')||nk.includes('formador')||nk.includes('docente a cargo')) &&
         value!==null && value!==undefined && String(value).trim()!==''){
        explicit.push(...splitTutors(value));
      }
    }
    if(explicit.length)return unique(explicit);
    const fallback=tutorNameFromRow(raw,m);
    return fallback?[fallback]:[];
  }

  function tutorCourseValue(raw,m){
    return String(
      pickExact(raw,[
        'CÓDIGO CURSO','CODIGO CURSO','Código curso','Codigo curso',
        'CÓDIGO COMISIÓN','CODIGO COMISION','Código comisión','Codigo comision',
        'ACCIÓN / COMISIÓN','ACCION / COMISION','Acción / Comisión','Accion / Comision',
        'CURSO','Curso','COMISIÓN','COMISION','Comisión','Comision',
        'TALLER','Taller','PROPUESTA','Propuesta','CÓDIGO','CODIGO','Código','Codigo'
      ]) ||
      pick(m,[
        'CÓDIGO CURSO','CODIGO CURSO','CÓDIGO COMISIÓN','CODIGO COMISION',
        'ACCIÓN / COMISIÓN','ACCION / COMISION',
        'CURSO','COMISIÓN','COMISION','TALLER','PROPUESTA','CÓDIGO','CODIGO'
      ]) || ''
    ).trim();
  }

  function tutorCourseName(raw,m){
    return String(
      pickExact(raw,[
        'NOMBRE DEL CURSO','Nombre del curso','NOMBRE CURSO','Nombre curso',
        'CURSO','Curso','NOMBRE COMISIÓN','NOMBRE COMISION','Nombre comisión','Nombre comision',
        'COMISIÓN','COMISION','Comisión','Comision','TALLER','Taller','PROPUESTA','Propuesta'
      ]) ||
      pick(m,[
        'NOMBRE DEL CURSO','NOMBRE CURSO','CURSO','NOMBRE COMISIÓN','NOMBRE COMISION',
        'COMISIÓN','COMISION','TALLER','PROPUESTA'
      ]) || ''
    ).trim();
  }

  function canonicalCommissionKey(value=''){
    const code=codeIn(value);
    if(!code)return normalize(value);
    const parts=code.split('-');
    const action=parts.shift();
    if(!parts.length)return action;
    const suffix=parts.join('-');
    return /^\d+$/.test(suffix) ? action+'-'+String(Number(suffix)) : action+'-'+suffix.toUpperCase();
  }

  function parseTutorRows(rows,fallbackCode='',source='',options={}){
    const year=yearIn(source,rows.slice(0,6));
    const parsed=[];
    for(const raw of rows||[]){
      const m=mapRow(raw);
      const explicitAction=
        pickExact(raw,[
          'ACCIÓN','ACCION','Acción','Accion',
          'CÓDIGO ACCIÓN','CODIGO ACCION','Código acción','Codigo accion',
          'CÓDIGO DE ACCIÓN','CODIGO DE ACCION','Código de acción','Codigo de accion'
        ]) ||
        pick(m,['ACCIÓN','ACCION','CÓDIGO ACCIÓN','CODIGO ACCION','CÓDIGO DE ACCIÓN','CODIGO DE ACCION']);
      const courseValue=tutorCourseValue(raw,m);
      let actionCode=(actionCodeValue(explicitAction)||mainCodeIn(courseValue)||fallbackCode||'').toUpperCase();
      if(!/^C\d{4}$/.test(actionCode))continue;

      let commissionCode=codeIn(courseValue);
      if(!commissionCode && /^\d+$/.test(courseValue)){
        commissionCode=actionCode+'-'+String(Number(courseValue));
      }
      const courseName=tutorCourseName(raw,m);
      const names=tutorNamesFromRow(raw,m);
      const dni=String(pick(m,['DNI'])||'').replace(/\.0$/,'').trim();
      const date=isoDate(pickExact(raw,['FECHA','Fecha'])||pick(m,['FECHA','Fecha']),year);

      for(const name of names){
        parsed.push({
          actionCode,
          commissionCode:commissionCode||'',
          courseName,
          dni,
          name,
          date,
          source,
          sourceKind:options.sourceKind||'',
          authoritative:options.authoritative===true
        });
      }
    }
    return parsed.filter(r=>/^C\d{4}$/.test(r.actionCode)&&idOf(r));
  }

  function tutorDedupeKey(r){
    return [
      r.actionCode,
      canonicalCommissionKey(r.commissionCode||''),
      normalize(r.courseName||''),
      idOf(r),
      r.date||'',
      r.sourceKind||''
    ].join('|');
  }

  function parseSupportBajaRows(rows,fallbackCode='',source=''){
    const year=yearIn(source,rows.slice(0,6));
    return rows.map(raw=>{
      const m=mapRow(raw);
      const actionCode=(mainCodeIn(
        pickExact(raw,['ACCIÓN','ACCION','Acción','Accion']) ||
        pick(m,['ACCIÓN','ACCION','Acción','Accion'])
      ) || fallbackCode || '').toUpperCase();
      const row={
        actionCode,
        dni:String(pick(m,['DNI'])||'').replace(/\.0$/,'').trim(),
        name:tutorNameFromRow(raw,m),
        email:String(pick(m,['Correo','Email'])||'').trim(),
        status:'Baja',
        bajaDate:isoDate(pickExact(raw,['FECHA','Fecha','FECHA BAJA','Fecha de Baja'])||pick(m,['FECHA','Fecha','FECHA BAJA','Fecha de Baja']),year),
        reason:String(pick(m,['MOTIVO','Motivo','Observaciones','Observación','Observacion'])||'').trim(),
        source
      };
      return row;
    }).filter(r=>/^C\d{4}$/.test(r.actionCode)&&idOf(r));
  }

  function addTutorMapping(map,key,t){
    if(!key)return;
    if(!map.has(key))map.set(key,{master:[],other:[]});
    const bucket=map.get(key);
    const target=(t.sourceKind==='tutor_courses'||t.authoritative===true)?bucket.master:bucket.other;
    target.push(t.name);
  }

  function tutorMapping(map,key){
    const bucket=map.get(key);
    if(!bucket)return null;
    const master=unique(bucket.master||[]);
    if(master.length)return {names:master,authoritative:true};
    const other=unique(bucket.other||[]);
    return other.length?{names:other,authoritative:false}:null;
  }

  function applyTutorValue(row,res){
    const out={...row};
    if(res?.authoritative){
      if(out._tutorSource!=='master')out._tutorOriginal=String(out.tutor||'');
      out.tutor=res.names.join(' · ');
      out._tutorSource='master';
      return out;
    }
    if(out._tutorSource==='master'){
      out.tutor=String(out._tutorOriginal||'');
      delete out._tutorOriginal;
      delete out._tutorSource;
    }
    if(!String(out.tutor||'').trim() && res?.names?.length)out.tutor=res.names.join(' · ');
    return out;
  }

  function applyProposalTutors(p,res){
    const out={...p};
    if(res?.authoritative){
      if(out._tutorSource!=='master')out._tutorsOriginal=Array.isArray(out.tutors)?[...out.tutors]:[];
      out.tutors=unique(res.names);
      out._tutorSource='master';
      return out;
    }
    if(out._tutorSource==='master'){
      out.tutors=Array.isArray(out._tutorsOriginal)?[...out._tutorsOriginal]:[];
      delete out._tutorsOriginal;
      delete out._tutorSource;
    }
    if(!(out.tutors||[]).length && res?.names?.length)out.tutors=unique(res.names);
    return out;
  }

  function clearManualTutorLayer(){
    dataset.registrations=(dataset.registrations||[]).map(r=>{
      if(r?._tutorSource!=='manual')return r;
      const out={...r,tutor:String(r._tutorOriginal||'')};
      delete out._tutorOriginal; delete out._tutorSource;
      return out;
    });
    dataset.attendance=(dataset.attendance||[]).map(r=>{
      if(r?._tutorSource!=='manual')return r;
      const out={...r,tutor:String(r._tutorOriginal||'')};
      delete out._tutorOriginal; delete out._tutorSource;
      return out;
    });
    dataset.proposals=(dataset.proposals||[]).map(p=>{
      if(p?._tutorSource!=='manual')return p;
      const out={...p,tutors:Array.isArray(p._tutorsOriginal)?[...p._tutorsOriginal]:[]};
      delete out._tutorsOriginal; delete out._tutorSource;
      return out;
    });
  }

  function manualTutorMapping(map,key,name){
    if(!key||!name)return;
    if(!map.has(key))map.set(key,[]);
    map.get(key).push(name);
  }

  function manualTutorNames(map,key){
    return unique(map.get(key)||[]);
  }

  function applyManualTutorValue(row,names){
    if(!names?.length || String(row?.tutor||'').trim())return row;
    return {...row,_tutorOriginal:String(row?.tutor||''),tutor:unique(names).join(' · '),_tutorSource:'manual'};
  }

  function applyManualProposalTutors(row,names){
    if(!names?.length || (row?.tutors||[]).length)return row;
    return {...row,_tutorsOriginal:Array.isArray(row?.tutors)?[...row.tutors]:[],tutors:unique(names),_tutorSource:'manual'};
  }

  function applyTutorsToDataset(){
    clearManualTutorLayer();

    const byAction=new Map(), byActionDate=new Map(), byCommission=new Map(), byCourseName=new Map();

    for(const t of dataset.tutors||[]){
      if(!t.actionCode||!t.name)continue;
      const action=t.actionCode;
      const commissionKey=canonicalCommissionKey(t.commissionCode||'');
      const courseKey=normalize(t.courseName||'');

      if(commissionKey){
        addTutorMapping(byCommission,action+'|'+commissionKey,t);
      }else if(courseKey){
        addTutorMapping(byCourseName,action+'|'+courseKey,t);
      }else if(t.date){
        addTutorMapping(byActionDate,action+'|'+t.date,t);
      }else{
        addTutorMapping(byAction,action,t);
      }
    }

    const resolveFor=(actionCode,{commissionCode='',courseName='',date=''}={})=>{
      const ck=canonicalCommissionKey(commissionCode);
      if(ck){
        const hit=tutorMapping(byCommission,actionCode+'|'+ck);
        if(hit)return hit;
      }
      const nk=normalize(courseName);
      if(nk){
        const hit=tutorMapping(byCourseName,actionCode+'|'+nk);
        if(hit)return hit;
      }
      if(date){
        const hit=tutorMapping(byActionDate,actionCode+'|'+date);
        if(hit)return hit;
      }
      return tutorMapping(byAction,actionCode);
    };

    // Manual es fallback: sólo entra cuando no hay una asignación automática válida.
    const manualByAction=new Map(), manualByCommission=new Map(), manualByCourseName=new Map();
    for(const a of dataset.manualTutorAssignments||[]){
      if(!/^C\d{4}$/.test(a?.actionCode||'') || !String(a?.tutorName||'').trim())continue;
      const name=String(a.tutorName).trim();
      const ck=canonicalCommissionKey(a.commissionCode||'');
      const nk=normalize(a.courseName||'');
      if(ck)manualTutorMapping(manualByCommission,a.actionCode+'|'+ck,name);
      else if(nk)manualTutorMapping(manualByCourseName,a.actionCode+'|'+nk,name);
      else manualTutorMapping(manualByAction,a.actionCode,name);
    }

    const resolveManual=(actionCode,{commissionCode='',courseName=''}={})=>{
      const ck=canonicalCommissionKey(commissionCode);
      if(ck){
        const names=manualTutorNames(manualByCommission,actionCode+'|'+ck);
        if(names.length)return names;
      }
      const nk=normalize(courseName);
      if(nk){
        const names=manualTutorNames(manualByCourseName,actionCode+'|'+nk);
        if(names.length)return names;
      }
      return manualTutorNames(manualByAction,actionCode);
    };

    dataset.registrations=(dataset.registrations||[]).map(r=>{
      const automatic=applyTutorValue(r,resolveFor(r.actionCode,{commissionCode:r.commissionCode}));
      return applyManualTutorValue(automatic,resolveManual(r.actionCode,{commissionCode:r.commissionCode}));
    });

    dataset.attendance=(dataset.attendance||[]).map(r=>{
      const automatic=applyTutorValue(r,resolveFor(r.actionCode,{commissionCode:r.commissionCode,date:r.eventDate}));
      return applyManualTutorValue(automatic,resolveManual(r.actionCode,{commissionCode:r.commissionCode}));
    });

    dataset.proposals=(dataset.proposals||[]).map(p=>{
      const automatic=applyProposalTutors(p,resolveFor(p.actionCode,{commissionCode:p.code,courseName:p.commission}));
      return applyManualProposalTutors(automatic,resolveManual(p.actionCode,{commissionCode:p.code,courseName:p.commission}));
    });
  }

  function parseSchoolMasterRows(rows=[]){
    return (rows||[]).map(raw=>{
      const m=mapRow(raw);
      const cueanexo=cleanCueAnexo(
        pickExact(raw,['Cueanexo','CUEANEXO','CUE Anexo']) ||
        pick(m,['Cueanexo','CUEANEXO','CUE Anexo'])
      );
      const cue=cleanCue(
        pickExact(raw,['CUE','Cue']) ||
        pick(m,['CUE','Cue']) ||
        cueanexo
      );
      const nombre=String(
        pickExact(raw,['Nombre','NOMBRE','Escuela','ESCUELA']) ||
        pick(m,['Nombre','Escuela']) || ''
      ).trim();
      return {
        cueanexo,
        cue,
        nombre,
        sector:String(pickExact(raw,['Sector','SECTOR'])||pick(m,['Sector'])||'').trim(),
        dependency:String(pickExact(raw,['Dependencia','DEPENDENCIA'])||pick(m,['Dependencia'])||'').trim(),
        departamento:String(pickExact(raw,['Comuna','COMUNA','Departamento'])||pick(m,['Comuna','Departamento'])||'').trim(),
        nombre_norm:normalize(nombre),
        active:true
      };
    }).filter(r=>r.cueanexo&&r.nombre);
  }

  function parseAreaMasterRows(rows=[]){
    return (rows||[]).map((raw,i)=>{
      const m=mapRow(raw);
      const area=String(
        pickExact(raw,['ÀREAS','ÁREAS','AREAS','Área','Area']) ||
        pick(m,['ÀREAS','ÁREAS','AREAS','Área','Area']) || ''
      ).trim();
      return area?{area,area_norm:normalize(area),sort_order:i+1,active:true}:null;
    }).filter(Boolean);
  }

  function parseCargoMasterRows(rows=[]){
    const seen=new Set();
    const out=[];
    for(const raw of rows||[]){
      const m=mapRow(raw);
      const origen=String(pickExact(raw,['Cargo','CARGO'])||pick(m,['Cargo'])||'').trim();
      if(!origen)continue;
      const key=normalize(origen);
      if(seen.has(key))continue;
      seen.add(key);
      const categoria=String(
        pickExact(raw,['Cargo clasif','Cargo Clasif','CARGO CLASIF','Categoría','Categoria']) ||
        pick(m,['Cargo clasif','Categoría','Categoria']) || origen
      ).trim();
      const cargoGeneral=String(
        pickExact(raw,['Cargo gral','Cargo Gral','CARGO GRAL','Cargo general']) ||
        pick(m,['Cargo gral','Cargo general']) || ''
      ).trim();
      const area=String(
        pickExact(raw,['Àrea','Área','Area','ÀREA','ÁREA']) ||
        pick(m,['Àrea','Área','Area']) || ''
      ).trim();
      out.push({
        origen,
        categoria,
        categoria_norm:normalize(origen),
        cargo_general:cargoGeneral,
        area,
        active:true
      });
    }
    return out;
  }

  function parseSupportWorkbook(file,wb){
    const names=wb.SheetNames||[];
    const normalized=names.map(n=>({name:n,norm:normalize(n)}));
    const hasCore=normalized.some(x=>x.norm.includes('propuesta')||x.norm.includes('inscrip')||x.norm.includes('asisten'));
    if(hasCore)return null;

    const sheetRows=(term)=>{
      const found=normalized.find(x=>x.norm.includes(term));
      return found ? XLSX.utils.sheet_to_json(wb.Sheets[found.name],{defval:'',raw:true}) : [];
    };
    const tutorRows=sheetRows('tutor');
    const bajaRows=sheetRows('baja');
    const schoolRows=sheetRows('padron');
    const areaRows=sheetRows('areas');
    const cargoRows=sheetRows('cargos');
    const tutors=parseTutorRows(tutorRows,'',file.name,{sourceKind:'tutor_courses',authoritative:true});
    const bajas=parseSupportBajaRows(bajaRows,'',file.name);
    const masterSchools=parseSchoolMasterRows(schoolRows);
    const masterAreas=parseAreaMasterRows(areaRows);
    const masterCargos=parseCargoMasterRows(cargoRows);
    if(!tutors.length&&!bajas.length&&!masterSchools.length&&!masterAreas.length&&!masterCargos.length)return null;
    return {supportOnly:true,file:file.name,tutors,bajas,masterSchools,masterAreas,masterCargos};
  }

  function mergeSupportWorkbook(parsed){
    const tutorCodes=unique((parsed.tutors||[]).map(x=>x.actionCode));
    const bajaCodes=unique((parsed.bajas||[]).map(x=>x.actionCode));
    const codes=unique([...tutorCodes,...bajaCodes]);

    if((parsed.masterSchools||[]).length){
      const byAnexo=new Map((dataset.masters?.schools||[]).map(x=>[cleanCueAnexo(x.cueanexo),x]));
      for(const school of parsed.masterSchools){
        const key=cleanCueAnexo(school.cueanexo);
        if(!key)continue;
        byAnexo.set(key,{...(byAnexo.get(key)||{}),...school});
      }
      dataset.masters={...(dataset.masters||{}),schools:[...byAnexo.values()]};
      schoolIndexMemoSource=null;
      schoolIndexMemo=null;
    }

    if((parsed.masterAreas||[]).length){
      const byArea=new Map((dataset.masters?.areas||[]).map(x=>[normalize(x.area),x]));
      for(const area of parsed.masterAreas)byArea.set(normalize(area.area),area);
      dataset.masters={...(dataset.masters||{}),areas:[...byArea.values()]};
      areaLookupMemoSource=null;
      areaLookupMemo=null;
    }

    if((parsed.masterCargos||[]).length){
      const byCargo=new Map((dataset.masters?.cargos||[]).map(x=>[normalize(x.origen),x]));
      for(const cargo of parsed.masterCargos)byCargo.set(normalize(cargo.origen),cargo);
      dataset.masters={...(dataset.masters||{}),cargos:[...byCargo.values()]};
      cargoLookupMemoSource=null;
      cargoLookupMemo=null;
    }

    for(const code of tutorCodes){
      dataset.tutors=dataset.tutors.filter(x=>x.actionCode!==code)
        .concat(dedupe(parsed.tutors.filter(x=>x.actionCode===code),tutorDedupeKey));
    }
    for(const code of bajaCodes){
      dataset.bajas=dataset.bajas.filter(x=>x.actionCode!==code)
        .concat(dedupe(parsed.bajas.filter(x=>x.actionCode===code),r=>[r.actionCode,idOf(r),r.bajaDate,r.reason].join('|')));
    }

    for(const code of codes){
      let action=dataset.actions.find(x=>x.code===code);
      if(!action){
        action={code,title:code,year:new Date().getFullYear(),status:'activa',finalizedAt:null,supportOnly:true};
        dataset.actions.push(action);
      }
      applyBajasToRegistrations(
        dataset.registrations.filter(x=>x.actionCode===code),
        dataset.bajas.filter(x=>x.actionCode===code)
      );
    }
    applyTutorsToDataset();
    applyMasterDataToDataset();
    codes.forEach(code=>applyEditorLayer(code));
    return codes;
  }

  function applyBajasToRegistrations(registrations,bajas){
    const byPerson=new Map();
    for(const r of registrations||[]){
      const id=idOf(r);
      if(!id)continue;
      if(!byPerson.has(id))byPerson.set(id,[]);
      byPerson.get(id).push(r);
    }
    for(const b of bajas||[]){
      const id=idOf(b);
      if(!id)continue;
      const matches=(byPerson.get(id)||[]).filter(r=>!b.actionCode||r.actionCode===b.actionCode);
      const preferred=b.commissionCode ? matches.filter(r=>r.commissionCode===b.commissionCode) : matches;
      const targets=preferred.length?preferred:matches;
      for(const r of targets){
        r.status='Baja';
        if(b.bajaDate && (!r.bajaDate || b.bajaDate<r.bajaDate))r.bajaDate=b.bajaDate;
        if(b.bajaDate)r.statusDate=b.bajaDate;
      }
      const ref=targets[0]||matches[0];
      if(ref){
        for(const key of ['name','firstName','surname','email','school','schoolRaw','cue','cueAnexo','dependency','sector','comuna','area','areaClass','cargo','cargoClass','formation','venue','shift','tutor']){
          if(!String(b[key]||'').trim())b[key]=ref[key]||'';
        }
        if(!b.commissionCode)b.commissionCode=ref.commissionCode||'';
      }
    }
  }

  function detectWorkbookActionCode(fileName,allSheets){
    const fileCode=mainCodeIn(fileName);
    const found=new Set();
    for(const rows of Object.values(allSheets)){
      for(const raw of rows.slice(0,1200)){
        for(const [key,value] of Object.entries(raw)){
          const nk=normalize(key);
          if(!(nk.includes('accion')||nk.includes('codigo')))continue;
          const code=nk.includes('accion')?actionCodeValue(value):mainCodeIn(value);
          if(code)found.add(code);
          if(found.size>8)break;
        }
        if(found.size>8)break;
      }
      if(found.size>8)break;
    }
    if(fileCode)return {code:fileCode,found:[...found]};
    if(found.size===1)return {code:[...found][0],found:[...found]};
    if(found.size>1)throw new Error('Se detectaron varios códigos de acción ('+[...found].join(', ')+'). Renombrá el archivo con el código C0000 correcto.');
    throw new Error('No se detectó el código de acción. Usá C0000 en el nombre del archivo o una columna ACCIÓN/CÓDIGO.');
  }

  function parseWorkbook(file, wb){
    const allSheets={};
    wb.SheetNames.forEach(name=>{ allSheets[name]=XLSX.utils.sheet_to_json(wb.Sheets[name],{defval:'',raw:true}) });
    const detection=detectWorkbookActionCode(file.name,allSheets);
    const code=detection.code;
    const sheetBy=(term)=>Object.entries(allSheets).find(([n])=>normalize(n).includes(term))?.[1] || [];
    const proposalsRows=sheetBy('propuesta');
    const regRows=sheetBy('inscrip');
    const attRows=Object.entries(allSheets).find(([n])=>normalize(n)==='asistencias')?.[1] || sheetBy('asisten');
    const bajasRows=sheetBy('baja');
    const tutorRows=sheetBy('tutor');
    const year=yearIn(file.name,[...proposalsRows.slice(0,4),...regRows.slice(0,4)]);
    const title=actionTitle(file.name,code);
    const masterIndex=schoolMasterIndexes();

    const proposals=proposalsRows.map(raw=>{
      const m=mapRow(raw);
      const pcode=(codeIn(pick(m,['Codigo','Código'])) || code).toUpperCase();
      const commission=String(pick(m,['Comisión','Comision','Taller','Propuesta'])||pcode).trim();
      const meetingCols=Object.entries(raw).filter(([k,v])=>/^enc\.?\s*\d+/i.test(String(k)) && v).map(([k,v])=>({label:k,text:String(v),date:isoDate(v,year)}));
      const baseDate=isoDate(pick(m,['Fecha']),year);
      if(baseDate && !meetingCols.length) meetingCols.push({label:'Encuentro',text:formatDate(pick(m,['Fecha'])),date:baseDate});
      return {
        actionCode:code, code:pcode, commission,
        dataYear:rowYear(raw,m,(baseDate||meetingCols[0]?.date||'').slice(0,4)||year),
        universe:rowUniverse(raw,m),
        isDar:rowDar(raw,m),
        area:String(pickExact(raw,['Área','Area'])||pick(m,['Área','Area'])||'').trim(),
        areaClass:classifyArea(pickExact(raw,['Área','Area'])||pick(m,['Área','Area'])||''),
        formation:String(pick(m,['Formación','Formacion'])||'').trim(),
        venue:String(pick(m,['Sede'])||'').trim(),
        shift:String(pickExact(raw,['TURNO','Turno'])||pick(m,['Turno'])||'').trim(),
        capacity:num(pick(m,['Cupo'])),
        registeredReported:num(pick(m,['# Inscr.','# Inscr'])),
        tutors:splitTutors(pickExact(raw,['TUTOR','Tutor','CAPACITADOR','Capacitador'])||pick(m,['Tutor','Capacitador','Capacitadores'])),
        meetings:meetingCols
      };
    }).filter(r=>r.code);

    const pMap=new Map(proposals.map(p=>[p.code,p]));

    const registrations=regRows.map(raw=>{
      const m=mapRow(raw);
      let pcode=codeIn(pick(m,['Codigo','Código','Comision','Comisión','Taller','Propuesta'])) || code;
      pcode=pcode.toUpperCase();
      const p=pMap.get(pcode);
      const schoolRaw=pickExact(raw,['ESCUELA','Escuela','Establecimiento','Escuela / Establecimiento'])||pick(m,['Establecimiento','Escuela / Establecimiento','Escuela']);
      const firstName=String(pickExact(raw,['Nombre','Nombre/s'])||pick(m,['Nombre','Nombre/s'])||'').trim();
      const surname=String(pickExact(raw,['Apellido','Apellido/s'])||pick(m,['Apellido','Apellido/s'])||'').trim();
      const areaValue=String(pickExact(raw,['Área','Area'])||pick(m,['Área','Area'])||p?.area||'').trim();
      const cueAnexo=String(pick(m,['CUEANEXO','Cueanexo','CUE Anexo'])||extractCueAnexo(schoolRaw)||'').trim();
      const registrationDate=isoDate(pick(m,['FECHA','Fecha','Fecha y hora']),year);
      const row={
        actionCode:code, commissionCode:pcode,
        dataYear:rowYear(raw,m,(registrationDate||'').slice(0,4)||year),
        universe:rowUniverse(raw,m),
        isDar:rowDar(raw,m),
        encounter:encounterValue(raw,m),
        dni:String(pick(m,['DNI'])||'').replace(/\.0$/,'').trim(),
        cuil:String(pick(m,['Cuil','CUIL'])||'').trim(),
        firstName,surname,
        name:[firstName,surname].filter(Boolean).join(' ').trim(),
        email:String(pick(m,['Correo','Email'])||'').trim(),
        schoolRaw:String(schoolRaw||'').trim(),
        school:cleanSchool(schoolRaw),
        cueAnexo,
        cue:String(pick(m,['CUE','Codigo CUE','Código CUE'])||cleanCue(cueAnexo)||'').trim(),
        dependency:String(pick(m,['DEPENDENCIA','Dependencia','Dep. Fun'])||'').trim(),
        sector:String(pick(m,['SECTOR DE GESTIÓN','Sector de Gestión','Sector de Gestion','Sector Gestión'])||inferSectorFromSchool(schoolRaw)||'').trim(),
        comuna:String(pick(m,['COMUNA','Comuna'])||'').trim(),
        status:statusNorm(pick(m,['ESTADO','Estado'])||'Activo'),
        statusDate:isoDate(pick(m,['FECHA ESTADO','Fecha Estado','Fecha de Estado']),year),
        bajaDate:isoDate(pick(m,['FECHA BAJA','Fecha Baja','Fecha de Baja']),year),
        region:String(pick(m,['DE','DE/Región','DE o Región'])||'').trim(),
        area:areaValue,
        areaClass:classifyArea(areaValue),
        cargo:String(pickExact(raw,['Cargo','CARGO','Cargo docente'])||pick(m,['Cargo','Cargo docente'])||'').trim(),
        formation:String(pick(m,['Formación','Formacion','Tipo de Formación'])||p?.formation||'').trim(),
        venue:String(pick(m,['Sede'])||p?.venue||'').trim(),
        shift:String(pickExact(raw,['TURNO','Turno'])||pick(m,['Turno'])||p?.shift||'').trim(),
        tutor:String(pickExact(raw,['TUTOR','Tutor','CAPACITADOR','Capacitador'])||pick(m,['Tutor','Capacitador'])||(p?.tutors||[]).join(' · ')||'').trim(),
        registrationDate,
        source:file.name
      };
      row.cargoClass=classifyCargo(row.cargo);
      return enrichMasterRow(row,masterIndex);
    }).filter(r=>idOf(r));

    const attendance=attRows.map(raw=>{
      const m=mapRow(raw);
      let pcode=codeIn(pick(m,['Codigo','Código','Comision','Comisión','Taller','Propuesta'])) || code;
      pcode=pcode.toUpperCase();
      const p=pMap.get(pcode);
      const encounter=encounterValue(raw,m);
      let eventDate='';
      if(p){
        const wantedNumber=encounterNumber(encounter);
        const meet=encounter
          ? p.meetings.find(x=>normalize(x.label)===normalize(encounter) || (wantedNumber&&encounterNumber(x.label)===wantedNumber))
          : p.meetings[0];
        eventDate=meet?.date || '';
      }
      if(!eventDate) eventDate=isoDate(pick(m,['Fecha de encuentro','Fecha']),year);
      const schoolRaw=pickExact(raw,['ESCUELA','Escuela','Establecimiento','Escuela / Establecimiento'])||pick(m,['Establecimiento','Escuela / Establecimiento','Escuela']);
      const firstName=String(pickExact(raw,['Nombre','Nombre/s'])||pick(m,['Nombre','Nombre/s'])||'').trim();
      const surname=String(pickExact(raw,['Apellido','Apellido/s'])||pick(m,['Apellido','Apellido/s'])||'').trim();
      const areaValue=String(pickExact(raw,['Área','Area'])||pick(m,['Área','Area'])||p?.area||'').trim();
      const cueAnexo=String(pick(m,['CUEANEXO','Cueanexo','CUE Anexo'])||extractCueAnexo(schoolRaw)||'').trim();
      const row={
        actionCode:code, commissionCode:pcode,
        dataYear:rowYear(raw,m,(eventDate||'').slice(0,4)||year),
        universe:rowUniverse(raw,m),
        isDar:rowDar(raw,m),
        dni:String(pick(m,['DNI'])||'').replace(/\.0$/,'').trim(),
        firstName,surname,
        name:[firstName,surname].filter(Boolean).join(' ').trim(),
        email:String(pick(m,['Correo','Email'])||'').trim(),
        schoolRaw:String(schoolRaw||'').trim(),
        school:cleanSchool(schoolRaw),
        cueAnexo,
        cue:String(pick(m,['CUE','Codigo CUE','Código CUE'])||cleanCue(cueAnexo)||'').trim(),
        dependency:String(pick(m,['DEPENDENCIA','Dependencia','Dep. Fun'])||'').trim(),
        sector:String(pick(m,['SECTOR DE GESTIÓN','Sector de Gestión','Sector de Gestion','Sector Gestión'])||inferSectorFromSchool(schoolRaw)||'').trim(),
        comuna:String(pick(m,['COMUNA','Comuna'])||'').trim(),
        status:statusNorm(pick(m,['ESTADO','Estado'])||''),
        region:String(pick(m,['DE/Región','DE','DE o Región'])||'').trim(),
        area:areaValue,
        areaClass:classifyArea(areaValue),
        cargo:String(pickExact(raw,['Cargo','CARGO','Cargo docente'])||pick(m,['Cargo','Cargo docente'])||'').trim(),
        formation:String(pick(m,['Formación','Formacion','Tipo de Formación'])||p?.formation||'').trim(),
        venue:String(pick(m,['Sede'])||p?.venue||'').trim(),
        shift:String(pickExact(raw,['TURNO','Turno'])||pick(m,['Turno'])||p?.shift||'').trim(),
        tutor:String(pickExact(raw,['TUTOR','Tutor','CAPACITADOR','Capacitador'])||pick(m,['Tutor','Capacitador'])||(p?.tutors||[]).join(' · ')||'').trim(),
        encounter:encounter || (p?.meetings?.[0]?.label || ''),
        eventDate,
        capturedAt:isoDate(pick(m,['FECHA','Fecha','Fecha y hora']),year),
        source:file.name
      };
      row.cargoClass=classifyCargo(row.cargo);
      return enrichMasterRow(row,masterIndex);
    }).filter(r=>idOf(r));

    const tutors=parseTutorRows(tutorRows,code,file.name);

    const bajas=bajasRows.map(raw=>{
      const m=mapRow(raw);
      const firstName=String(pickExact(raw,['Nombre','Nombre/s'])||pick(m,['Nombre','Nombre/s'])||'').trim();
      const surname=String(pickExact(raw,['Apellido','Apellido/s'])||pick(m,['Apellido','Apellido/s'])||'').trim();
      const schoolRaw=pickExact(raw,['ESCUELA','Escuela','Establecimiento','Escuela / Establecimiento'])||pick(m,['Establecimiento','Escuela / Establecimiento','Escuela']);
      const cueAnexo=String(pick(m,['CUEANEXO','Cueanexo','CUE Anexo'])||extractCueAnexo(schoolRaw)||'').trim();
      const row={
        actionCode:code,
        dataYear:rowYear(raw,m,year),
        universe:rowUniverse(raw,m),
        isDar:rowDar(raw,m),
        commissionCode:(codeIn(pick(m,['Codigo','Código','Comision','Comisión','Taller','Propuesta']))||'').toUpperCase(),
        dni:String(pick(m,['DNI'])||'').replace(/\.0$/,'').trim(),
        firstName,surname,
        name:[firstName,surname].filter(Boolean).join(' ').trim(),
        email:String(pick(m,['Correo','Email'])||'').trim(),
        schoolRaw:String(schoolRaw||'').trim(),
        school:cleanSchool(schoolRaw),
        cueAnexo,
        cue:String(pick(m,['CUE','Codigo CUE','Código CUE'])||cleanCue(cueAnexo)||'').trim(),
        dependency:String(pick(m,['DEPENDENCIA','Dependencia','Dep. Fun'])||'').trim(),
        sector:String(pick(m,['SECTOR DE GESTIÓN','Sector de Gestión','Sector de Gestion','Sector Gestión'])||inferSectorFromSchool(schoolRaw)||'').trim(),
        comuna:String(pick(m,['COMUNA','Comuna'])||'').trim(),
        status:'Baja',
        bajaDate:isoDate(pick(m,['FECHA BAJA','Fecha Baja','Fecha de Baja','Fecha','Fecha y hora']),year),
        reason:String(pick(m,['MOTIVO','Motivo','Motivo de baja','Observaciones','Observación','Observacion'])||'').trim(),
        source:file.name
      };
      return enrichMasterRow(row,masterIndex);
    }).filter(r=>idOf(r));

    applyBajasToRegistrations(registrations,bajas);
    if(tutors.length){
      const actionTutorNames=unique(tutors.map(x=>x.name));
      const byDate=new Map();
      tutors.filter(x=>x.date).forEach(t=>{
        if(!byDate.has(t.date))byDate.set(t.date,[]);
        byDate.get(t.date).push(t.name);
      });
      registrations.forEach(r=>{ if(actionTutorNames.length&&!String(r.tutor||'').trim())r.tutor=actionTutorNames.join(' · ') });
      attendance.forEach(r=>{
        if(String(r.tutor||'').trim())return;
        const names=unique(byDate.get(r.eventDate)||actionTutorNames);
        if(names.length)r.tutor=names.join(' · ');
      });
    }

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
      proposals, registrations, attendance, bajas, tutors,
      importInfo:{file:file.name,code,title,proposals:proposals.length,registrations:registrations.length,attendance:attendance.length,bajas:bajas.length,tutors:tutors.length,bajasOnly:!proposalsRows.length&&!regRows.length&&!attRows.length&&bajas.length>0,hasBajasSheet:bajasRows.length>0,hasTutorSheet:tutorRows.length>0,mismatches:mismatchSummary}
    };
  }

  function dedupe(rows,keyFn){const m=new Map();for(const r of rows){const k=keyFn(r);if(k)m.set(k,r)}return [...m.values()]}
  function mergeParsed(p){
    const code=p.action.code;
    const previousAction=dataset.actions.find(x=>x.code===code);
    p.action={
      ...p.action,
      status:previousAction?.status==='finalizada'?'finalizada':'activa',
      finalizedAt:previousAction?.status==='finalizada'?(previousAction.finalizedAt||null):null
    };
    const mergedAction=p.importInfo?.bajasOnly&&previousAction
      ? {...previousAction,status:p.action.status,finalizedAt:p.action.finalizedAt}
      : (previousAction?{...previousAction,...p.action}:p.action);
    dataset.actions=dataset.actions.filter(x=>x.code!==code).concat(mergedAction);
    if(p.importInfo?.bajasOnly){
      dataset.bajas=dataset.bajas.filter(x=>x.actionCode!==code).concat(dedupe(p.bajas||[],r=>[r.actionCode,idOf(r),r.bajaDate,r.reason].join('|')));
      if(p.importInfo?.hasTutorSheet){
        dataset.tutors=dataset.tutors.filter(x=>x.actionCode!==code).concat(dedupe(p.tutors||[],tutorDedupeKey));
      }
      applyBajasToRegistrations(dataset.registrations.filter(x=>x.actionCode===code),dataset.bajas.filter(x=>x.actionCode===code));
    }else{
      dataset.proposals=dataset.proposals.filter(x=>x.actionCode!==code).concat(p.proposals);
      dataset.registrations=dataset.registrations.filter(x=>x.actionCode!==code).concat(dedupe(p.registrations,r=>[r.actionCode,r.commissionCode,idOf(r)].join('|')));
      dataset.attendance=dataset.attendance.filter(x=>x.actionCode!==code).concat(dedupe(p.attendance,r=>[r.actionCode,r.commissionCode,idOf(r),r.encounter,r.eventDate,r.capturedAt].join('|')));
      if(p.importInfo?.hasBajasSheet){
        dataset.bajas=dataset.bajas.filter(x=>x.actionCode!==code).concat(dedupe(p.bajas||[],r=>[r.actionCode,idOf(r),r.bajaDate,r.reason].join('|')));
      }
      if(p.importInfo?.hasTutorSheet){
        dataset.tutors=dataset.tutors.filter(x=>x.actionCode!==code).concat(dedupe(p.tutors||[],tutorDedupeKey));
      }
      applyBajasToRegistrations(dataset.registrations.filter(x=>x.actionCode===code),dataset.bajas.filter(x=>x.actionCode===code));
    }
    applyTutorsToDataset();
    applyMasterDataToDataset();
    applyEditorLayer(code);
    const existedImport=dataset.imports.some(x=>x.code===code);
    const previousImport=dataset.imports.find(x=>x.code===code);
    const mergedImport=p.importInfo?.bajasOnly&&previousImport
      ? {...previousImport,bajas:p.importInfo.bajas,tutors:p.importInfo.tutors||previousImport.tutors||0,updated:true,when:new Date().toISOString()}
      : {...p.importInfo,updated:existedImport,when:new Date().toISOString()};
    dataset.imports=dataset.imports.filter(x=>x.code!==code).concat(mergedImport);
  }

  async function handleFiles(files){
    if(!files.length)return;
    const allowed=/\.(xlsx|xls|xlsm|xlsb|csv)$/i;
    const rejected=files.filter(file=>!allowed.test(file.name||''));
    if(rejected.length){
      const results=rejected.map(file=>({ok:false,file:file.name,error:'Formato no compatible. Usá Excel (.xlsx, .xls, .xlsm, .xlsb) o CSV.'}));
      renderImportResults(results);
      $('#importSummary').textContent='Hay archivos con formato no compatible.';
      toast('Revisá el formato de los archivos seleccionados.');
      if($('#fileInput'))$('#fileInput').value='';
      return;
    }
    if(!globalThis.XLSX){
      renderImportResults(files.map(file=>({ok:false,file:file.name,error:'No se cargó la biblioteca de Excel. Recargá la página e intentá nuevamente.'})));
      $('#importSummary').textContent='No se pudo iniciar el lector de Excel.';
      toast('No se pudo iniciar el lector de Excel.');
      if($('#fileInput'))$('#fileInput').value='';
      return;
    }
    if(!remoteReady){
      const connected=await ensureRemoteAccess({interactive:true});
      if(!connected){
        setStorageUi('error','No se cargó ningún archivo: primero hay que conectar Supabase.');
        toast('Carga cancelada: Supabase debe estar conectado.');
        if($('#fileInput'))$('#fileInput').value='';
        return;
      }
    }
    $('#importSummary').textContent='Procesando y guardando online...';
    const results=[];
    const successfulCodes=[];
    for(const file of files){
      try{
        $('#importSummary').textContent='Procesando '+file.name+'...';
        await new Promise(resolve=>requestAnimationFrame(()=>resolve()));
        const data=await file.arrayBuffer();
        await new Promise(resolve=>setTimeout(resolve,0));
        const wb=XLSX.read(data,{type:'array',cellDates:true});
        const support=parseSupportWorkbook(file,wb);
        if(support){
          const codes=mergeSupportWorkbook(support);
          successfulCodes.push(...codes);
          if(remoteReady){
            if((support.masterSchools||[]).length)await remoteRequest('upsert_masters',{kind:'schools',rows:support.masterSchools});
            if((support.masterAreas||[]).length)await remoteRequest('upsert_masters',{kind:'areas',rows:support.masterAreas});
            if((support.masterCargos||[]).length)await remoteRequest('upsert_masters',{kind:'cargos',rows:support.masterCargos});
          }
          results.push({
            ok:true,
            updated:true,
            code:codes.join(', ') || 'PADRÓN',
            title:(support.masterSchools||[]).length||(support.masterAreas||[]).length||(support.masterCargos||[]).length?'Base auxiliar · Maestros':'Base auxiliar',
            file:file.name,
            proposals:0,
            registrations:0,
            attendance:0,
            bajas:(support.bajas||[]).length,
            tutors:(support.tutors||[]).length,
            masterSchools:(support.masterSchools||[]).length,
            masterAreas:(support.masterAreas||[]).length,
            masterCargos:(support.masterCargos||[]).length,
            supportOnly:true,
            when:new Date().toISOString(),
            mismatches:[]
          });
          continue;
        }
        const parsed=parseWorkbook(file,wb);
        const existed=dataset.actions.some(x=>x.code===parsed.action.code);
        mergeParsed(parsed);
        successfulCodes.push(parsed.action.code);
        results.push({ok:true,updated:existed,...parsed.importInfo});
      }catch(e){
        console.error('Error importando',file.name,e);
        const message=e?.message||'No se pudo leer el archivo.';
        results.push({ok:false,file:file.name,error:message});
      }
    }
    await saveState();

    let remoteSaved=0;
    let remoteError=null;
    const codesToSave=unique(successfulCodes);
    for(const code of codesToSave){
      try{
        if(await saveRemoteAction(code)) remoteSaved++;
      }catch(e){
        console.error('Error guardando '+code+' en Supabase',e);
        remoteError=e;
        remoteReady=false;
        setStorageUi('error','Hay una carga pendiente: no se pudo verificar '+code+' en Supabase.');
        break;
      }
    }

    renderImportResults(results);

    const okCount=results.filter(x=>x.ok).length;
    if(okCount){
      clearAllMultiFilters();
      syncActionFilterInput();
      ['filterAction','filterSchool','filterDependency','filterSector','filterComuna','filterStatus','filterYear','filterEncounter','filterTutor','filterArea','filterVenue','filterShift','filterCargo','filterDar','excludeDate'].forEach(id=>{const el=$('#'+id);if(el)el.value=''});
      setSelectedValues($('#filterDate'),[]);if($('#filterDateManual'))$('#filterDateManual').value='';
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
      if(remoteError || remoteSaved!==codesToSave.length){
        switchView('imports');
        toast('ATENCIÓN: la carga quedó pendiente de guardado online. Reconectá Supabase y volvé a sincronizar.');
      }else{
        setStorageUi('connected',dataset.actions.length+' acción(es) guardada(s) online y verificadas.');
        toast((parts.join(' · ')||okCount+' archivo(s) procesado(s)')+' · guardado online verificado.');
      }
    }else{
      switchView('imports');
      $('#importSummary').textContent='No se pudo cargar ningún archivo. Revisá el detalle que aparece abajo.';
      // No llamar renderAll() acá: reemplazaría el error recién mostrado por el historial anterior.
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
      if(r.supportOnly){
        return `<div class="import-card">
          <div class="row">
            <div><span class="import-code">${esc(r.code||'AUX')}</span> · <strong>${esc(r.title||'Base auxiliar')}</strong></div>
            <span class="badge">Auxiliar</span>
          </div>
          <div class="import-meta">${r.bajas||0} bajas · ${r.tutors||0} tutores/capacitadores${r.masterSchools?' · '+r.masterSchools+' escuelas':''}${r.masterAreas?' · '+r.masterAreas+' áreas':''}${r.masterCargos?' · '+r.masterCargos+' cargos':''}${when?' · '+esc(when):''}</div>
        </div>`;
      }
      const action=dataset.actions.find(a=>a.code===r.code)||{};
      const isFinal=action.status==='finalizada';
      const statusLabel=isFinal?'FINALIZADA':'ACTIVA';
      const finalized=isFinal&&action.finalizedAt?' · finalizada '+new Date(action.finalizedAt).toLocaleString('es-AR'):'';
      return `<div class="import-card">
        <div class="row">
          <div><span class="import-code">${esc(r.code)}</span> · <strong>${esc(r.title)}</strong></div>
          <div class="action-card-badges"><span class="action-status-badge ${isFinal?'finished':'active'}">${statusLabel}</span><span class="badge">${badge}</span></div>
        </div>
        <div class="import-meta">${r.proposals||0} comisiones · ${r.registrations||0} inscripciones · ${r.attendance||0} asistencias · ${r.bajas||0} bajas · ${r.tutors||0} tutores/capacitadores${when?' · '+esc(when):''}${esc(finalized)}</div>
        <div class="action-card-controls">
          <button type="button" class="btn ghost compact" data-toggle-action-status="${esc(r.code)}">${isFinal?'Reabrir acción':'Marcar como finalizada'}</button>
        </div>
        ${warns}
      </div>`;
    }).join('');
  }

  function fillDatalist(id,values,formatter=v=>v,labels=null){
    const list=$('#'+id);
    if(!list)return;
    const vals=sortAlpha(unique(values));
    list.innerHTML=vals.map(v=>{
      const label=labels?.[v] || formatter(v);
      return `<option value="${esc(v)}"${label&&label!==v?' label="'+esc(label)+'"':''}></option>`;
    }).join('');
  }
  function selectedValues(sel){ return sel?[...sel.selectedOptions].map(o=>o.value).filter(Boolean):[]; }
  function setSelectedValues(sel,values=[]){
    if(!sel)return;
    const wanted=new Set((Array.isArray(values)?values:[values]).filter(Boolean));
    [...sel.options].forEach(o=>{o.selected=wanted.has(o.value)});
  }
  function fillMultiSelect(sel,values,formatter=v=>v){
    if(!sel)return;
    const old=new Set(selectedValues(sel));
    sel.innerHTML=sortAlpha(unique(values)).map(v=>'<option value="'+esc(v)+'">'+esc(formatter(v))+'</option>').join('');
    [...sel.options].forEach(o=>{o.selected=old.has(o.value)});
  }
  function splitManualList(v=''){
    return unique(String(v||'').split(/[;,\n]+/).map(x=>x.trim()).filter(Boolean));
  }
  function normalizeManualDate(v=''){
    const s=String(v||'').trim();
    if(/^\d{4}-\d{2}-\d{2}$/.test(s))return s;
    const m=s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/);
    if(!m)return '';
    const y=m[3].length===2?'20'+m[3]:m[3];
    return `${y}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`;
  }
  function setManualList(el,values=[]){
    if(!el)return;
    el.value=(Array.isArray(values)?values:[values]).filter(Boolean).join(', ');
  }
  function textMatch(value,filter){
    const f=normalize(filter||'');
    if(!f)return true;
    return normalize(value||'').includes(f);
  }

  function ensureCargoFilterPlaceholder(){
    if($('#filterCargo'))return;
    const shift=$('#filterShift')?.closest('label');
    if(!shift)return;
    const label=document.createElement('label');
    label.innerHTML='Cargo<input id="filterCargo" list="filterCargoList" type="text" autocomplete="off" placeholder="Escribí o elegí..." /><datalist id="filterCargoList"></datalist>';
    shift.insertAdjacentElement('afterend',label);
  }

  function initMultiFilterWidgets(){
    ensureCargoFilterPlaceholder();
    for(const [id,def] of Object.entries(MULTI_FILTER_DEFS)){
      const input=$('#'+id);
      if(!input || document.querySelector('[data-multi-filter="'+id+'"]'))continue;
      const oldLabel=input.closest('label');
      if(!oldLabel)continue;
      const wrap=document.createElement('div');
      wrap.className='multi-filter-field';
      wrap.innerHTML='<span class="multi-filter-caption">'+esc(def.label)+'</span>'+
        '<details class="multi-filter" data-multi-filter="'+id+'">'+
          '<summary><span class="multi-filter-summary">Todas</span><b>⌄</b></summary>'+
          '<div class="multi-filter-popover">'+
            '<input type="search" class="multi-filter-search" placeholder="Buscar opción..." />'+
            '<div class="multi-filter-actions">'+
              '<button type="button" data-multi-all>Seleccionar todo</button>'+
              '<button type="button" data-multi-clear>Limpiar</button>'+
            '</div>'+
            '<div class="multi-filter-options"></div>'+
          '</div>'+
        '</details>';
      if(id==='filterAction'){
        input.type='hidden';
        input.removeAttribute('list');
        input.removeAttribute('autocomplete');
        input.removeAttribute('placeholder');
        wrap.appendChild(input);
      }
      oldLabel.replaceWith(wrap);
      multiFilterState[id]=new Set();
    }
  }

  function multiFilterValues(id){
    return [...(multiFilterState[id]||new Set())];
  }

  function syncActionFilterInput(){
    const input=$('#filterAction');
    if(!input)return;
    const selected=multiFilterValues('filterAction');
    input.value=selected.length===1?selected[0]:'';
  }

  function multiFilterMatch(value,selected){
    if(!selected?.length)return true;
    return selected.some(x=>textMatch(value,x));
  }

  function updateMultiFilterSummary(id){
    const details=document.querySelector('[data-multi-filter="'+id+'"]');
    if(!details)return;
    const selected=multiFilterValues(id);
    const total=details.querySelectorAll('.multi-filter-options input[type="checkbox"]').length;
    const summary=details.querySelector('.multi-filter-summary');
    if(!summary)return;
    if(!selected.length)summary.textContent='Todas';
    else if(total && selected.length===total)summary.textContent='Todas ('+total+')';
    else if(selected.length===1)summary.textContent=selected[0];
    else summary.textContent=selected.length+' seleccionadas';
  }

  function setMultiFilterOptions(id,values){
    const details=document.querySelector('[data-multi-filter="'+id+'"]');
    if(!details)return;
    const options=sortAlpha(unique(values));
    const previous=multiFilterState[id]||new Set();
    const valid=new Set(options);
    multiFilterState[id]=new Set([...previous].filter(x=>valid.has(x)));
    const host=details.querySelector('.multi-filter-options');
    host.innerHTML=options.map((value,i)=>{
      const checked=multiFilterState[id].has(value)?' checked':'';
      return '<label class="multi-filter-option"><input type="checkbox" value="'+esc(value)+'"'+checked+' /><span>'+esc(value)+'</span></label>';
    }).join('') || '<div class="multi-filter-empty">Sin opciones</div>';
    updateMultiFilterSummary(id);
  }

  function clearAllMultiFilters(){
    for(const id of Object.keys(MULTI_FILTER_DEFS)){
      multiFilterState[id]=new Set();
      const details=document.querySelector('[data-multi-filter="'+id+'"]');
      details?.querySelectorAll('input[type="checkbox"]').forEach(x=>x.checked=false);
      updateMultiFilterSummary(id);
    }
  }

  function currentFilters(){
    const actions=multiFilterValues('filterAction');
    const action=actions.length===1?actions[0]:'';
    return {
      action,
      actions,
      schools:multiFilterValues('filterSchool'),
      dependencies:multiFilterValues('filterDependency'),
      sectors:multiFilterValues('filterSector'),
      comunas:multiFilterValues('filterComuna'),
      statuses:multiFilterValues('filterStatus'),
      years:multiFilterValues('filterYear'),
      encounters:multiFilterValues('filterEncounter'),
      dates:unique([
        ...selectedValues($('#filterDate')),
        ...splitManualList($('#filterDateManual').value).map(normalizeManualDate).filter(Boolean)
      ]).sort(),
      tutors:multiFilterValues('filterTutor'),
      areas:multiFilterValues('filterArea'),
      venues:multiFilterValues('filterVenue'),
      shifts:multiFilterValues('filterShift'),
      cargos:multiFilterValues('filterCargo'),
      darValues:multiFilterValues('filterDar'),
      excludeSurnames:[],
      excludeDates:[],
      q:normalize($('#globalSearch').value)
    };
  }
  function rowDate(r){ return r.eventDate || r.registrationDate || r.capturedAt || ''; }
  function matchesBase(r,f){
    if((f.actions||[]).length && !(f.actions||[]).includes(r.actionCode))return false;
    if(!(f.actions||[]).length && f.action && !textMatch(r.actionCode,f.action))return false;
    if(!multiFilterMatch(r.school,f.schools))return false;
    if(!multiFilterMatch(r.dependency,f.dependencies))return false;
    if(!multiFilterMatch(r.sector,f.sectors))return false;
    if(!multiFilterMatch(r.comuna,f.comunas))return false;
    if(!multiFilterMatch(statusNorm(r.status),f.statuses))return false;
    if(!multiFilterMatch(String(r.dataYear||r.year||''),f.years))return false;
    if(!multiFilterMatch(r.tutor,f.tutors))return false;
    if(!multiFilterMatch(r.area,f.areas))return false;
    if(!multiFilterMatch(r.venue,f.venues))return false;
    if(!multiFilterMatch(r.shift,f.shifts))return false;
    if(!multiFilterMatch(r.cargoClass||r.cargo,f.cargos))return false;
    if(!multiFilterMatch(r.isDar,f.darValues))return false;
    if(f.q){
      const hay=normalize([r.dni,r.name,r.email,r.school,r.cue,r.dependency,r.sector,r.comuna,r.status,rowDate(r),r.region,r.area,r.cargo,r.cargoClass,r.commissionCode,r.tutor,r.venue,r.shift,r.dataYear,r.encounter,r.universe,r.isDar].join(' '));
      if(!hay.includes(f.q))return false;
    }
    return true;
  }
  function matchesRegistration(r,f){
    if(!matchesBase(r,f))return false;
    // FECHA del tablero representa el encuentro. Para el padrón de inscriptos
    // se conserva a quienes estaban activos en esa fecha, no solo a quienes se inscribieron ese día.
    if((f.dates||[]).length && !(f.dates||[]).some(date=>activeAtDate(r,date)))return false;
    return true;
  }
  function matchesAttendance(r,f){
    if(!matchesBase(r,f))return false;
    if(!multiFilterMatch(r.encounter,f.encounters))return false;
    if((f.dates||[]).length && !(f.dates||[]).includes(r.eventDate))return false;
    if((f.excludeDates||[]).includes(r.eventDate))return false;
    return true;
  }

  function buildRegistrationIndex(){
    const exact=new Map(), byActionPerson=new Map();
    for(const r of dataset.registrations){
      const person=idOf(r);
      if(!person)continue;
      exact.set([r.actionCode,r.commissionCode,person].join('|'),r);
      const k=[r.actionCode,person].join('|');
      if(!byActionPerson.has(k))byActionPerson.set(k,r);
    }
    return {exact,byActionPerson};
  }

  function enrichAttendanceFromRegistration(r,index){
    const person=idOf(r);
    const reg=index.exact.get([r.actionCode,r.commissionCode,person].join('|'))
      || index.byActionPerson.get([r.actionCode,person].join('|'));
    if(!reg)return r;
    const out={...r};
    for(const key of ['school','schoolRaw','cue','cueAnexo','dependency','sector','comuna','status','region','area','areaClass','cargo','cargoClass','formation','venue','shift','tutor','firstName','surname','dataYear','universe','isDar']){
      if(out[key]===null || out[key]===undefined || String(out[key]).trim()==='') out[key]=reg[key]||'';
    }
    return out;
  }

  function refreshFilterOptions(){
    const actionLabels={};
    dataset.actions.forEach(a=>{actionLabels[a.code]=a.code+' · '+(a.status==='finalizada'?'Finalizada':'Activa')});
    setMultiFilterOptions('filterAction',dataset.actions.map(x=>x.code));
    syncActionFilterInput();

    const selectedActions=multiFilterValues('filterAction');
    const actionSet=new Set(selectedActions);
    const regs=selectedActions.length ? dataset.registrations.filter(x=>actionSet.has(x.actionCode)) : dataset.registrations;
    const atts=selectedActions.length ? dataset.attendance.filter(x=>actionSet.has(x.actionCode)) : dataset.attendance;
    const peopleRows=[...regs,...atts];
    const props=selectedActions.length ? dataset.proposals.filter(x=>actionSet.has(x.actionCode)) : dataset.proposals;
    setMultiFilterOptions('filterSchool',peopleRows.map(x=>x.school));
    setMultiFilterOptions('filterDependency',peopleRows.map(x=>x.dependency));
    setMultiFilterOptions('filterSector',peopleRows.map(x=>x.sector));
    setMultiFilterOptions('filterComuna',peopleRows.map(x=>x.comuna));
    setMultiFilterOptions('filterStatus',peopleRows.map(x=>statusNorm(x.status)).filter(Boolean));
    setMultiFilterOptions('filterYear',peopleRows.map(x=>x.dataYear||x.year).concat(props.map(x=>x.dataYear||x.year)));
    setMultiFilterOptions('filterEncounter',atts.map(x=>x.encounter).filter(Boolean));
    setMultiFilterOptions('filterTutor',peopleRows.map(x=>x.tutor).concat(props.flatMap(x=>x.tutors||[])));
    setMultiFilterOptions('filterArea',peopleRows.map(x=>x.area).concat(props.map(x=>x.area)));
    setMultiFilterOptions('filterVenue',peopleRows.map(x=>x.venue).concat(props.map(x=>x.venue)));
    setMultiFilterOptions('filterShift',peopleRows.map(x=>x.shift).concat(props.map(x=>x.shift)));
    setMultiFilterOptions('filterCargo',peopleRows.map(x=>x.cargoClass||x.cargo));
    setMultiFilterOptions('filterDar',peopleRows.map(x=>x.isDar).filter(Boolean));
    fillMultiSelect($('#filterDate'),atts.map(x=>x.eventDate).filter(Boolean),formatDate);
  }
  function selectedAction(){
    const selected=multiFilterValues('filterAction');
    if(selected.length!==1)return null;
    return dataset.actions.find(x=>x.code===selected[0])||null;
  }

  function renderActionLifecycle(){
    const bar=$('#actionLifecycleBar');
    if(!bar)return;
    const action=selectedAction();
    if(!action){
      bar.hidden=true;
      return;
    }
    const isFinal=action.status==='finalizada';
    bar.hidden=false;
    $('#actionLifecycleName').textContent=(action.code||'')+(action.title?' · '+action.title:'');
    const badge=$('#actionLifecycleBadge');
    badge.textContent=isFinal?'FINALIZADA':'ACTIVA';
    badge.className='action-status-badge '+(isFinal?'finished':'active');
    $('#actionLifecycleDate').textContent=isFinal&&action.finalizedAt
      ? 'Finalizada: '+new Date(action.finalizedAt).toLocaleString('es-AR')
      : 'La acción continúa abierta.';
    $('#toggleActionStatusBtn').textContent=isFinal?'Reabrir acción':'Marcar como finalizada';
  }

  async function toggleActionStatus(code=''){
    const selected=multiFilterValues('filterAction');
    const actionCode=code||(selected.length===1?selected[0]:'');
    const action=dataset.actions.find(x=>x.code===actionCode);
    if(!action)return;
    const closing=action.status!=='finalizada';
    const promptText=closing
      ? `¿Marcar ${actionCode} como FINALIZADA? Los datos no se borran y la acción se puede reabrir.`
      : `¿Reabrir ${actionCode}?`;
    if(!confirm(promptText))return;

    action.status=closing?'finalizada':'activa';
    action.finalizedAt=closing?new Date().toISOString():null;
    await saveState();

    if(!remoteReady) await ensureRemoteAccess({interactive:true});
    if(remoteReady){
      try{
        await saveRemoteAction(actionCode);
        toast(closing?'Acción finalizada y guardada en Supabase':'Acción reabierta y guardada en Supabase');
      }catch(e){
        console.error('No se pudo guardar el estado de la acción en Supabase',e);
        toast('El estado quedó local; reconectá Supabase para persistirlo.');
      }
    }else{
      toast('El estado quedó local; conectá Supabase para persistirlo.');
    }

    renderImportResults();
    refreshFilterOptions();
    multiFilterState.filterAction=new Set([actionCode]);
    syncActionFilterInput();
    refreshFilterOptions();
    applyFilters();
  }

  function applyFilters(){
    const f=currentFilters();
    const registrationIndex=buildRegistrationIndex();
    filtered.registrations=dataset.registrations.filter(r=>matchesRegistration(r,f));
    filtered.attendance=dataset.attendance
      .map(r=>enrichAttendanceFromRegistration(r,registrationIndex))
      .filter(r=>matchesAttendance(r,f));
    filtered.bajas=(dataset.bajas||[])
      .map(r=>enrichAttendanceFromRegistration(r,registrationIndex))
      .filter(r=>matchesBase(r,f));

    // Las propuestas/comisiones deben quedar acotadas a lo que sobrevivió
    // a los filtros de personas (escuela, dependencia, comuna, estado, etc.).
    const scopedCommissionCodes=new Set(
      filtered.registrations.map(r=>r.commissionCode)
        .concat(filtered.attendance.map(r=>r.commissionCode))
        .filter(Boolean)
    );

    filtered.proposals=dataset.proposals.filter(p=>{
      if((f.actions||[]).length && !(f.actions||[]).includes(p.actionCode))return false;
      if(!(f.actions||[]).length && f.action && !textMatch(p.actionCode,f.action))return false;
      if((f.years||[]).length && !multiFilterMatch(String(p.dataYear||p.year||''),f.years))return false;
      if((f.darValues||[]).length && !multiFilterMatch(p.isDar,f.darValues))return false;
      if((f.tutors||[]).length && !f.tutors.some(v=>(p.tutors||[]).some(x=>textMatch(x,v))))return false;
      if((f.areas||[]).length && !f.areas.some(v=>textMatch(p.area,v)))return false;
      if((f.venues||[]).length && !f.venues.some(v=>textMatch(p.venue,v)))return false;
      if((f.shifts||[]).length && !f.shifts.some(v=>textMatch(p.shift,v)))return false;

      const hasPeopleLevelFilter=!!(
        (f.schools||[]).length || (f.dependencies||[]).length || (f.sectors||[]).length ||
        (f.comunas||[]).length || (f.statuses||[]).length || (f.cargos||[]).length ||
        (f.years||[]).length || (f.encounters||[]).length || (f.darValues||[]).length ||
        (f.dates||[]).length || f.q
      );
      if(hasPeopleLevelFilter && !scopedCommissionCodes.has(p.code))return false;
      return true;
    });
    renderDashboard(); renderDetail(); renderActionLifecycle();
    if($('#view-reports')?.classList.contains('active')){
      renderCustomReportConfigurator();
      renderCustomReportPreview();
      renderReportPreview();
    }
  }

  function filterSnapshot(){ return {...currentFilters()}; }
  function applyFilterSnapshot(f={}){
    if($('#filterAction'))$('#filterAction').value=f.action||'';
    refreshFilterOptions();
    const map={school:'filterSchool',dependency:'filterDependency',sector:'filterSector',comuna:'filterComuna',status:'filterStatus',tutor:'filterTutor',area:'filterArea',venue:'filterVenue',shift:'filterShift',q:'globalSearch'};
    for(const [k,id] of Object.entries(map)){const el=$('#'+id); if(el) el.value=f[k]||''}
    const savedMainDates=Array.isArray(f.dates)?f.dates:(f.date?[f.date]:[]);
    setSelectedValues($('#filterDate'),savedMainDates);
    $('#filterDateManual').value='';
    const savedSurnames=Array.isArray(f.excludeSurnames)?f.excludeSurnames:(f.excludeSurname?[f.excludeSurname]:[]);
    const savedDates=Array.isArray(f.excludeDates)?f.excludeDates:(f.excludeDate?[f.excludeDate]:[]);
    setManualList($('#excludeSurname'),savedSurnames);
    setManualList($('#excludeDate'),savedDates.map(v=>/^\d{4}-\d{2}-\d{2}$/.test(v)?formatDate(v):v));
    applyFilters();
  }
  function savedFilterActionCode(item){
    return String(item?.actionCode||item?.config?.action||'').trim().toUpperCase();
  }
  function renderSavedFilters(){
    const sel=$('#savedFilterSelect'); if(!sel)return;
    const action=$('#filterAction')?.value.trim().toUpperCase()||'';
    const exactAction=/^C\d{4}$/.test(action) && dataset.actions.some(x=>x.code===action) ? action : '';
    const old=sel.value;
    const scoped=(dataset.savedFilters||[]).filter(x=>savedFilterActionCode(x)===exactAction);
    sel.innerHTML=exactAction
      ? '<option value="">Filtro guardado de '+esc(exactAction)+'...</option>'+scoped.map(x=>`<option value="${esc(x.id)}">${esc(x.name)}</option>`).join('')
      : '<option value="">Elegí una acción para usar filtros guardados</option>';
    if(scoped.some(x=>x.id===old))sel.value=old;
    else sel.value='';
    $('#saveFilterBtn').disabled=!exactAction;
    $('#deleteFilterBtn').disabled=!sel.value;
    for(const id of ['excludeSurname','excludeDate']){
      const el=$('#'+id);
      if(!el)continue;
      el.disabled=!exactAction;
      el.title=exactAction?'Exclusión aplicada solo a '+exactAction:'Elegí una acción para usar exclusiones';
    }
  }
  async function saveCurrentFilter(){
    const action=$('#filterAction')?.value.trim().toUpperCase()||'';
    if(!/^C\d{4}$/.test(action) || !dataset.actions.some(x=>x.code===action)){
      toast('Elegí una acción antes de guardar el filtro.');
      return;
    }
    const name=prompt('Nombre para este filtro de '+action+':');
    if(!name?.trim())return;
    const item={
      id:(globalThis.crypto?.randomUUID?.()||'flt-'+Date.now()),
      actionCode:action,
      name:name.trim(),
      config:{...filterSnapshot(),action},
      createdAt:new Date().toISOString()
    };
    dataset.savedFilters=[
      ...(dataset.savedFilters||[]).filter(x=>!(savedFilterActionCode(x)===action && normalize(x.name)===normalize(item.name))),
      item
    ];
    await saveState();  $('#savedFilterSelect').value=item.id; $('#deleteFilterBtn').disabled=false; toast('Filtro guardado solo para '+action);
  }
  async function deleteSavedFilter(){
    const id=$('#savedFilterSelect').value;if(!id)return;
    dataset.savedFilters=(dataset.savedFilters||[]).filter(x=>x.id!==id);
    await saveState();toast('Filtro eliminado');
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
    if(st==='Baja' && r.statusDate) return date < r.statusDate;
    if(st==='Baja') return false;
    return true;
  }
  function eventMetrics(regs,atts){
    const groups=new Map();
    for(const a of atts||[]){
      const key=[a.encounter||'',a.eventDate||'',a.universe||'',a.dataYear||''].join('|');
      if(!groups.has(key))groups.set(key,[]);
      groups.get(key).push(a);
    }
    const observedBase=new Set((atts||[]).map(idOf).filter(Boolean));
    return [...groups.values()].map(group=>{
      const sample=group[0]||{};
      const date=sample.eventDate||'';
      const encounter=sample.encounter||'';
      const universe=String(sample.universe||'').trim();
      const dataYear=String(sample.dataYear||'').trim();
      const attendees=new Set(group.map(idOf).filter(Boolean));

      let denominatorRows=(regs||[]).filter(r=>activeAtDate(r,date));
      let baseKind='registrations';
      if(universe){
        const universeRows=denominatorRows.filter(r=>normalize(r.universe)===normalize(universe));
        if(universeRows.length)denominatorRows=universeRows;
      }else if(dataYear){
        const yearRows=denominatorRows.filter(r=>String(r.dataYear||r.year||'')===dataYear);
        if(yearRows.length)denominatorRows=yearRows;
      }
      let active=new Set(denominatorRows.map(idOf).filter(Boolean));
      if(!active.size){
        active=observedBase;
        baseKind='observed';
      }else if(universe)baseKind='universe';
      else if(dataYear)baseKind='year';

      return {
        date,encounter,universe,dataYear,
        label:encounterLabel(encounter,date),
        attendees:attendees.size,
        active:active.size,
        presentism:rate(attendees.size,active.size),
        baseKind
      };
    }).sort((a,b)=>(a.date||'').localeCompare(b.date||'') || (encounterNumber(a.encounter)||'999').localeCompare(encounterNumber(b.encounter)||'999',{numeric:true}));
  }

  function renderDashboard(){
    const regs=filtered.registrations, atts=filtered.attendance;
    const regIds=new Set(regs.map(idOf).filter(Boolean)); const attIds=new Set(atts.map(idOf).filter(Boolean));
    $('#kpiRegistered').textContent=regIds.size.toLocaleString('es-AR');
    $('#kpiAttendees').textContent=attIds.size.toLocaleString('es-AR');
    $('#kpiRate').textContent=regIds.size ? rate(attIds.size,regIds.size).toLocaleString('es-AR')+'%' : (attIds.size ? '—' : '0%');
    $('#kpiSchools').textContent=unique((regs.length?regs:atts).map(schoolKey).filter(Boolean)).length.toLocaleString('es-AR');
    $('#kpiParticipatingSchools').textContent=unique(atts.map(schoolKey).filter(Boolean)).length.toLocaleString('es-AR');
    $('#kpiCommissions').textContent=unique((regs.length?regs:atts).map(x=>x.commissionCode)).length.toLocaleString('es-AR');
    $('#kpiAttendanceRows').textContent=atts.length.toLocaleString('es-AR');
    const linkedAttIds=new Set([...attIds].filter(x=>regIds.has(x)));
    const schoolsReg=unique(regs.map(schoolKey).filter(Boolean));
    const schoolsAtt=new Set(atts.map(schoolKey).filter(Boolean));
    $('#insightActions').textContent=unique(regs.map(x=>x.actionCode).concat(atts.map(x=>x.actionCode))).length.toLocaleString('es-AR');
    $('#insightNoShow').textContent=[...regIds].filter(x=>!linkedAttIds.has(x)).length.toLocaleString('es-AR');
    $('#insightSchoolsNoShow').textContent=schoolsReg.filter(x=>x&&!schoolsAtt.has(x)).length.toLocaleString('es-AR');
    $('#insightBajas').textContent=(filtered.bajas||[]).length.toLocaleString('es-AR');
    const noAnalysisData=!regs.length&&!atts.length;
    $('#exportBtn').disabled=noAnalysisData;
    $('#excelBtn').disabled=noAnalysisData;
    $('#printBtn').disabled=noAnalysisData;

    const selectedActions=multiFilterValues('filterAction');
    const act=selectedActions.length===1?dataset.actions.find(x=>x.code===selectedActions[0]):null;
    $('#subtitle').textContent=act
      ? `${act.code} · ${act.title} · ${act.status==='finalizada'?'FINALIZADA':'ACTIVA'}`
      : (selectedActions.length>1
          ? `${selectedActions.length} acciones seleccionadas · filtros interactivos`
          : (dataset.actions.length ? `${dataset.actions.length} acciones cargadas · filtros interactivos` : 'Carga una base para empezar a analizar.'));

    const metrics=eventMetrics(regs,atts);
    const selectedDates=currentFilters().dates||[];
    const selectedMetrics=selectedDates.length?metrics.filter(x=>selectedDates.includes(x.date)):metrics;
    const currentMetric=selectedMetrics.length===1 ? selectedMetrics[0] : (selectedMetrics.length ? selectedMetrics[selectedMetrics.length-1] : null);
    const avgPresentism=selectedMetrics.length?Math.round(selectedMetrics.reduce((a,x)=>a+x.presentism,0)/selectedMetrics.length*10)/10:null;
    $('#kpiPresentism').textContent=selectedMetrics.length>1 ? avgPresentism.toLocaleString('es-AR')+'%' : (currentMetric ? currentMetric.presentism.toLocaleString('es-AR')+'%' : '—');
    const observedPresentism=selectedMetrics.length && selectedMetrics.every(x=>x.baseKind==='observed');
    $('#kpiPresentismHint').textContent=selectedMetrics.length>1
      ? ('Promedio de '+selectedMetrics.length+' fechas seleccionadas'+(observedPresentism?' · base: participantes observados (sin padrón de inscriptos)':''))
      : (currentMetric
          ? formatDate(currentMetric.date)+' · '+currentMetric.attendees+'/'+currentMetric.active+
            (currentMetric.baseKind==='observed'?' participantes observados':currentMetric.baseKind==='universe'?' del universo '+currentMetric.universe:currentMetric.baseKind==='year'?' del año '+currentMetric.dataYear:' activos')
          : 'por encuentro: asistentes / activos');
    chart('attendanceChart','line',metrics.map(x=>x.label||formatDate(x.date)),[
      {label:'Docentes asistentes',data:metrics.map(x=>x.attendees),tension:.28,fill:false}
    ],{
      scales:{
        x:{grid:{display:false},ticks:{color:'#7a8790',font:{size:9}}},
        y:{beginAtZero:true,grid:{color:'#edf1f3'},ticks:{color:'#7a8790',font:{size:9},precision:0}}
      }
    });

    chart('presentismPercentChart','bar',metrics.map(x=>x.label||formatDate(x.date)),[
      {label:'Presentismo %',data:metrics.map(x=>x.presentism),tension:.28,fill:false}
    ],{
      scales:{
        x:{grid:{display:false},ticks:{color:'#7a8790',font:{size:9}}},
        y:{beginAtZero:true,suggestedMax:100,grid:{color:'#edf1f3'},ticks:{callback:v=>v+'%',color:'#7a8790',font:{size:9}}}
      }
    });

    const areaBase=regs.length?regs:atts;
    const areaRegs=groupUnique(areaBase,r=>r.area||'Sin área').sort((a,b)=>b.value-a.value);
    const areaAttMap=new Map(groupUnique(atts,r=>r.area||'Sin área').map(x=>[x.label,x.value]));
    const areaCompare=areaRegs;
    chart('areaCompareChart','bar',areaCompare.map(x=>x.label),[
      {label:'Inscriptos',data:areaCompare.map(x=>x.value)},
      {label:'Asistentes',data:areaCompare.map(x=>areaAttMap.get(x.label)||0)}
    ],{indexAxis:'y'});

    const areaClass=groupUnique(areaBase,r=>r.areaClass||classifyArea(r.area)||'Otros / sin clasificación').sort((a,b)=>b.value-a.value);
    chart('areaChart','bar',areaClass.map(x=>x.label),[{label:'Docentes',data:areaClass.map(x=>x.value)}],{indexAxis:'y'});

    const dependencyBase=regs.length?regs:atts;
    const byDep=groupUnique(dependencyBase,r=>r.dependency||'Sin dependencia').sort((a,b)=>b.value-a.value).slice(0,10);
    chart('dependencyChart','bar',byDep.map(x=>x.label),[{label:regs.length?'Inscriptos':'Participantes',data:byDep.map(x=>x.value)}],{indexAxis:'y'});

    const commissionBase=regs.length?regs:atts;
    const commRegs=groupUnique(commissionBase,r=>r.commissionCode).sort((a,b)=>b.value-a.value);
    const attByComm=new Map(groupUnique(atts,r=>r.commissionCode).map(x=>[x.label,x.value]));
    chart('commissionChart','bar',commRegs.map(x=>x.label),[
      {label:'Inscriptos',data:commRegs.map(x=>x.value)},
      {label:'Asistentes',data:commRegs.map(x=>attByComm.get(x.label)||0)}
    ]);

    const schoolNames=new Map();
    [...regs,...atts].filter(r=>schoolKey(r)).forEach(r=>{const k=schoolKey(r);if(k&&!schoolNames.has(k))schoolNames.set(k,r.school||r.cue||'Sin escuela')});
    const schoolAtt=groupUnique(atts.filter(r=>schoolKey(r)),r=>schoolKey(r)).sort((a,b)=>b.value-a.value).slice(0,10);
    chart('schoolChart','bar',schoolAtt.map(x=>schoolNames.get(x.label)||x.label),[{label:'Asistentes únicos',data:schoolAtt.map(x=>x.value)}],{indexAxis:'y'});

    const venueAtt=groupUnique(atts,r=>r.venue||'Sin sede').sort((a,b)=>b.value-a.value).slice(0,10);
    chart('venueChart','bar',venueAtt.map(x=>x.label),[{label:'Asistentes',data:venueAtt.map(x=>x.value)}],{indexAxis:'y'});

    const tutorAtt=groupUnique(atts,r=>r.tutor||'Sin tutor').sort((a,b)=>b.value-a.value).slice(0,10);
    chart('tutorChart','bar',tutorAtt.map(x=>x.label),[{label:'Asistentes',data:tutorAtt.map(x=>x.value)}],{indexAxis:'y'});

    const cargoRows=(regs.length?regs:atts).filter(r=>String(r.cargoClass||r.cargo||'').trim());
    const cargoData=groupUnique(cargoRows,r=>r.cargoClass||classifyCargo(r.cargo)||r.cargo||'Sin cargo').sort((a,b)=>b.value-a.value).slice(0,14);
    const cargoEmpty=$('#cargoEmpty'), cargoCanvas=$('#cargoChart');
    if(cargoData.length){
      if(cargoEmpty)cargoEmpty.hidden=true;
      if(cargoCanvas)cargoCanvas.style.display='';
      chart('cargoChart','bar',cargoData.map(x=>x.label),[{label:'Docentes',data:cargoData.map(x=>x.value)}],{indexAxis:'y'});
    }else{
      if(charts.cargoChart){charts.cargoChart.destroy();delete charts.cargoChart}
      if(cargoCanvas)cargoCanvas.style.display='none';
      if(cargoEmpty)cargoEmpty.hidden=false;
    }

    const shiftAtt=groupUnique(atts,r=>r.shift||'Sin turno').sort((a,b)=>b.value-a.value).slice(0,8);
    chart('shiftChart','doughnut',shiftAtt.map(x=>x.label),[{label:'Asistentes',data:shiftAtt.map(x=>x.value)}]);

    const schoolBase=regs.length?regs:[];
    const schools=groupUnique(schoolBase.filter(r=>schoolKey(r)),r=>schoolKey(r)).sort((a,b)=>b.value-a.value);
    const attSchool=new Map(groupUnique(atts.filter(r=>schoolKey(r)),r=>schoolKey(r)).map(x=>[x.label,x.value]));
    const schoolMeta=new Map();
    schoolBase.forEach(r=>{const k=schoolKey(r);if(k&&!schoolMeta.has(k))schoolMeta.set(k,r)});
    const schoolsWithoutAttendance=schools.filter(x=>(attSchool.get(x.label)||0)===0);
    $('#schoolTable').innerHTML=schoolsWithoutAttendance.slice(0,120).map(s=>{
      const m=schoolMeta.get(s.label)||{};
      return `<tr><td>${esc(m.cue||'Sin CUE')}</td><td>${esc(upper(m.school)||'—')}</td><td>${esc(upper(m.dependency)||'—')}</td><td>${s.value}</td></tr>`
    }).join('') || '<tr><td colspan="4" class="empty">No hay escuelas sin asistencia con estos filtros.</td></tr>';

    const absentById=new Map();
    regs.filter(r=>!attIds.has(idOf(r))).forEach(r=>{const id=idOf(r);if(id&&!absentById.has(id))absentById.set(id,r)});
    const absent=[...absentById.values()];
    $('#absentTable').innerHTML=absent.slice(0,250).map(r=>`<tr><td>${esc(cleanDni(r.dni)||'—')}</td><td>${esc(r.name||r.email||'—')}</td><td>${esc(upper(r.school)||'—')}</td><td>${esc(formatDate(r.registrationDate)||'—')}</td><td>${esc(upper(r.dependency)||'—')}</td><td>${esc(upper(statusNorm(r.status))||'—')}</td><td>${esc(r.commissionCode||'—')}</td></tr>`).join('') || '<tr><td colspan="7" class="empty">No hay inscriptos ausentes con estos filtros.</td></tr>';

    const bajas=(filtered.bajas||[]).slice().sort((a,b)=>String(b.bajaDate||'').localeCompare(String(a.bajaDate||'')));
    $('#bajasTable').innerHTML=bajas.slice(0,500).map(r=>`<tr><td>${esc(cleanDni(r.dni)||'—')}</td><td>${esc(r.name||r.email||'—')}</td><td>${esc(formatDate(r.bajaDate)||'—')}</td><td>${esc(upper(r.school)||'—')}</td><td>${esc(r.actionCode||'—')}</td><td>${esc(r.commissionCode||'—')}</td><td>${esc(r.reason||'—')}</td></tr>`).join('') || '<tr><td colspan="7" class="empty">No hay bajas para los filtros actuales.</td></tr>';
  }

  function chart(id,type,labels,datasets,extra={}){
    try{
      if(charts[id])charts[id].destroy();
      const ctx=document.getElementById(id); if(!ctx)return;
      const meta=CHART_META[id]||{};
      const selected=chartPrefs[id]||meta.defaultType||type;
      const actualType=selected==='hbar'?'bar':selected;
      const radial=['doughnut','pie','polarArea'].includes(actualType);
      const radar=actualType==='radar';
      const styled=datasets.map((d,i)=>{
        if(radial) return {...d,backgroundColor:labels.map((_,j)=>PALETTE[j%PALETTE.length]),borderWidth:0,hoverOffset:4};
        if(radar) return {...d,borderColor:PALETTE[i%PALETTE.length],backgroundColor:'rgba(22,117,102,.08)',pointBackgroundColor:PALETTE[i%PALETTE.length],pointRadius:2,borderWidth:2,fill:true};
        if(actualType==='line') return {...d,borderColor:PALETTE[i%PALETTE.length],backgroundColor:'rgba(22,117,102,.08)',pointBackgroundColor:PALETTE[i%PALETTE.length],pointRadius:3,borderWidth:2.2};
        return {...d,backgroundColor:PALETTE[i%PALETTE.length],borderRadius:6,borderSkipped:false,maxBarThickness:38};
      });
      const defaultScales={
        x:{grid:{display:false},ticks:{maxRotation:45,minRotation:0,color:'#7a8790',font:{size:9}}},
        y:{beginAtZero:true,grid:{color:'#edf1f3'},ticks:{color:'#7a8790',font:{size:9}}}
      };
      const options={
        responsive:true,
        maintainAspectRatio:false,
        interaction:{mode:'nearest',intersect:false},
        plugins:{
          legend:{position:'bottom',labels:{boxWidth:8,usePointStyle:true,padding:14,color:'#6d7983',font:{size:10,weight:600}}},
          tooltip:{backgroundColor:'#10262b',titleColor:'#fff',bodyColor:'#dfe9e7',padding:10,cornerRadius:8}
        }
      };
      if(!radial&&!radar){
        options.scales=extra.scales||defaultScales;
        if(selected==='hbar')options.indexAxis='y';
        else if(extra.indexAxis && !chartPrefs[id])options.indexAxis=extra.indexAxis;
      }
      for(const [k,v] of Object.entries(extra||{})){
        if(k==='scales'||k==='indexAxis')continue;
        options[k]=v;
      }
      charts[id]=new Chart(ctx,{type:actualType,data:{labels,datasets:styled},options});
      const selector=document.querySelector('[data-chart-type="'+id+'"]');
      if(selector && selector.value!==selected)selector.value=selected;
    }catch(e){
      console.error('Error renderizando gráfico '+id,e);
    }
  }

  function initChartControls(){
    for(const [id,meta] of Object.entries(CHART_META)){
      const canvas=document.getElementById(id);
      const panel=canvas?.closest('.panel');
      const head=panel?.querySelector('.panel-head');
      if(!canvas||!panel||!head||head.querySelector('[data-chart-tools="'+id+'"]'))continue;
      panel.dataset.reportKey='chart:'+id;
      const tools=document.createElement('div');
      tools.className='chart-card-tools';
      tools.dataset.chartTools=id;
      const select=document.createElement('select');
      select.className='chart-type-select';
      select.dataset.chartType=id;
      select.title='Tipo de gráfico';
      for(const value of meta.allowed){
        const opt=document.createElement('option');
        opt.value=value;opt.textContent=CHART_TYPE_LABELS[value]||value;
        select.appendChild(opt);
      }
      select.value=chartPrefs[id]||meta.defaultType;
      const add=document.createElement('button');
      add.type='button';add.className='chart-tool-btn';add.dataset.addReport='chart:'+id;add.textContent='+ Informe';
      const print=document.createElement('button');
      print.type='button';print.className='chart-tool-btn';print.dataset.printChart=id;print.textContent='PDF';
      tools.append(select,add,print);
      head.appendChild(tools);
    }
  }

  function initReportPickers(){
    for(const [id,title] of Object.entries(KPI_META)){
      const value=document.getElementById(id);
      const card=value?.closest('.kpi, .insight-strip article');
      if(!value||!card||card.querySelector('[data-report-picker="'+id+'"]'))continue;
      const btn=document.createElement('button');
      btn.type='button';
      btn.className='report-mini-add';
      btn.dataset.reportPicker=id;
      btn.dataset.addReport='kpi:'+id;
      btn.title='Agregar '+title+' al informe';
      btn.textContent='+ Informe';
      card.appendChild(btn);
    }
    for(const [id,title] of Object.entries(TABLE_META)){
      const body=document.getElementById(id);
      const panel=body?.closest('.panel');
      const head=panel?.querySelector('.panel-head');
      if(!body||!panel||!head||head.querySelector('[data-report-picker="'+id+'"]'))continue;
      const tools=document.createElement('div');
      tools.className='chart-card-tools';
      tools.dataset.reportPicker=id;
      const add=document.createElement('button');
      add.type='button';
      add.className='chart-tool-btn';
      add.dataset.addReport='table:'+id;
      add.textContent='+ Informe';
      tools.appendChild(add);
      head.appendChild(tools);
    }
  }

  function setChartType(id,type){
    const meta=CHART_META[id];if(!meta||!meta.allowed.includes(type))return;
    chartPrefs[id]=type;saveChartPrefs();
    applyFilters();
    if($('#view-reports')?.classList.contains('active'))renderReportPreview();
  }

  function reportCatalog(){
    const customTitle=$('#customReportTitle')?.value.trim()||'Participación personalizada';
    return [
      ...Object.entries(KPI_META).map(([id,title])=>({key:'kpi:'+id,kind:'Indicador',title})),
      ...Object.entries(CHART_META).map(([id,meta])=>({key:'chart:'+id,kind:'Gráfico',title:meta.title})),
      ...Object.entries(TABLE_META).map(([id,title])=>({key:'table:'+id,kind:'Tabla',title})),
      {key:'custom:table',kind:'Tabla',title:customTitle}
    ];
  }

  function reportItemMeta(key){
    return reportCatalog().find(x=>x.key===key)||{key,kind:'Contenido',title:key};
  }

  function syncReportInputs(){
    if(!$('#reportDocTitle'))return;
    $('#reportDocTitle').value=reportDraft.title||'Informe de acciones formativas';
    $('#reportDocSubtitle').value=reportDraft.subtitle||'';
    $('#reportDocNotes').value=reportDraft.notes||'';
    $('#reportIncludeFilters').checked=reportDraft.includeFilters!==false;
  }

  function captureReportInputs(){
    if(!$('#reportDocTitle'))return;
    reportDraft.title=$('#reportDocTitle').value.trim()||'Informe de acciones formativas';
    reportDraft.subtitle=$('#reportDocSubtitle').value.trim();
    reportDraft.notes=$('#reportDocNotes').value.trim();
    reportDraft.includeFilters=$('#reportIncludeFilters').checked;
    saveReportDraft();
  }

  function addReportItem(key,{quiet=false}={}){
    if(!reportItemMeta(key)?.title)return;
    if(!reportDraft.items.includes(key))reportDraft.items.push(key);
    saveReportDraft();
    renderReportBuilder();
    if(!quiet)toast('Agregado al informe.');
  }

  function removeReportItem(key){
    reportDraft.items=reportDraft.items.filter(x=>x!==key);
    saveReportDraft();renderReportBuilder();
  }

  function moveReportItem(key,delta){
    const i=reportDraft.items.indexOf(key);if(i<0)return;
    const j=i+delta;if(j<0||j>=reportDraft.items.length)return;
    [reportDraft.items[i],reportDraft.items[j]]=[reportDraft.items[j],reportDraft.items[i]];
    saveReportDraft();renderReportBuilder();
  }

  function cleanClone(node){
    const clone=node.cloneNode(true);
    if(clone.removeAttribute)clone.removeAttribute('id');
    clone.querySelectorAll?.('[id]').forEach(x=>x.removeAttribute('id'));
    clone.querySelectorAll?.('button,select,input,textarea').forEach(x=>x.remove());
    return clone;
  }

  function reportBlockHtml(key){
    const meta=reportItemMeta(key);
    const [kind,id]=key.split(':');
    if(kind==='chart'){
      const canvas=document.getElementById(id);
      let image='';
      try{image=canvas?.toDataURL('image/png',1)||''}catch{}
      return '<section class="report-output-block report-chart-block"><h2>'+esc(meta.title)+'</h2>'+
        (image?'<img src="'+image+'" alt="'+esc(meta.title)+'" />':'<div class="empty">Gráfico sin datos para los filtros actuales.</div>')+
        '</section>';
    }
    if(kind==='kpi'){
      const value=document.getElementById(id)?.textContent?.trim()||'—';
      return '<section class="report-output-block report-kpi-block"><span>'+esc(meta.title)+'</span><strong>'+esc(value)+'</strong></section>';
    }
    if(kind==='table'){
      const tbody=document.getElementById(id);
      const table=tbody?.closest('table');
      return '<section class="report-output-block report-table-block"><h2>'+esc(meta.title)+'</h2>'+
        (table?cleanClone(table).outerHTML:'<div class="empty">Sin datos.</div>')+'</section>';
    }
    if(kind==='custom'&&id==='table')return customReportTableHtml();
    return '';
  }

  function reportHeaderHtml({title,subtitle,notes,includeFilters}){
    const filters=includeFilters?filterSummaryPairs():[];
    return '<header class="report-output-header">'+
      '<div class="report-output-eyebrow">ANÁLISIS DE ACCIONES</div>'+
      '<h1>'+esc(title||'Informe de acciones formativas')+'</h1>'+
      (subtitle?'<p class="report-output-subtitle">'+esc(subtitle)+'</p>':'')+
      '<div class="report-output-date">Generado: '+esc(new Date().toLocaleString('es-AR'))+'</div>'+
      (notes?'<p class="report-output-notes">'+esc(notes)+'</p>':'')+
      (filters.length?'<div class="report-output-filters">'+filters.map(([k,v])=>'<span><b>'+esc(k)+':</b> '+esc(v)+'</span>').join('')+'</div>':'')+
      '</header>';
  }

  function reportDocumentHtml(items=reportDraft.items,overrides={}){
    const cfg={
      title:overrides.title??reportDraft.title,
      subtitle:overrides.subtitle??reportDraft.subtitle,
      notes:overrides.notes??reportDraft.notes,
      includeFilters:overrides.includeFilters??reportDraft.includeFilters
    };
    const blocks=items.map(reportBlockHtml).filter(Boolean).join('');
    return reportHeaderHtml(cfg)+(blocks||'<div class="report-empty-state">Agregá indicadores, gráficos o tablas para construir el informe.</div>');
  }

  function renderReportBuilder(){
    const catalogHost=$('#reportCatalog'),selectedHost=$('#reportSelectedItems');
    if(!catalogHost||!selectedHost)return;
    syncReportInputs();
    const catalog=reportCatalog();
    const groups=['Indicador','Gráfico','Tabla'];
    catalogHost.innerHTML=groups.map(group=>{
      const items=catalog.filter(x=>x.kind===group);
      return '<div class="report-catalog-group"><h4>'+group+'s</h4>'+
        items.map(x=>'<button type="button" class="report-catalog-item '+(reportDraft.items.includes(x.key)?'selected':'')+'" data-add-report="'+esc(x.key)+'">'+
          '<span>'+esc(x.title)+'</span><b>'+(reportDraft.items.includes(x.key)?'Agregado':'Agregar')+'</b></button>').join('')+
        '</div>';
    }).join('');
    selectedHost.innerHTML=reportDraft.items.map((key,i)=>{
      const meta=reportItemMeta(key);
      return '<div class="report-selected-item" data-report-item="'+esc(key)+'"><div><span>'+(i+1)+'</span><strong>'+esc(meta.title)+'</strong><small>'+esc(meta.kind)+'</small></div>'+
        '<div class="report-order-actions">'+
        '<button type="button" data-report-move="'+esc(key)+'" data-delta="-1" '+(i===0?'disabled':'')+'>↑</button>'+
        '<button type="button" data-report-move="'+esc(key)+'" data-delta="1" '+(i===reportDraft.items.length-1?'disabled':'')+'>↓</button>'+
        '<button type="button" data-report-remove="'+esc(key)+'">×</button></div></div>';
    }).join('')||'<div class="report-empty-state">Todavía no agregaste contenido. Podés hacerlo desde el tablero o desde la lista de la izquierda.</div>';
  }

  function renderReportPreview(){
    captureReportInputs();
    const root=$('#reportPreviewRoot');if(!root)return;
    root.innerHTML=reportDocumentHtml();
  }

  function printReport(items=reportDraft.items,overrides={}){
    if(!items?.length){toast('Agregá al menos un elemento al informe.');return}
    captureReportInputs();
    const root=$('#reportPrintRoot');if(!root)return;
    root.innerHTML=reportDocumentHtml(items,overrides);
    root.setAttribute('aria-hidden','false');
    document.body.classList.add('report-printing');
    const cleanup=()=>{
      document.body.classList.remove('report-printing');
      root.setAttribute('aria-hidden','true');
      window.removeEventListener('afterprint',cleanup);
    };
    window.addEventListener('afterprint',cleanup);
    requestAnimationFrame(()=>setTimeout(()=>window.print(),120));
  }

  function printSingleChart(id){
    const meta=CHART_META[id];if(!meta)return;
    printReport(['chart:'+id],{title:meta.title,subtitle:'Gráfico de acciones formativas',notes:'',includeFilters:true});
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

  function base64ToBytes(value=''){
    const binary=atob(value);
    const out=new Uint8Array(binary.length);
    for(let i=0;i<binary.length;i++)out[i]=binary.charCodeAt(i);
    return out;
  }

  async function workbookFromGoogleSource(source){
    const spreadsheetId=source.spreadsheetId||spreadsheetIdFromUrl(source.url);
    if(!spreadsheetId) throw new Error('Link de Google Sheets inválido.');

    // Camino principal: Supabase descarga el XLSX del enlace desde backend.
    // Evita CORS/JSONP y no requiere login de Google dentro de la aplicación.
    if(remoteReady){
      try{
        const remote=await remoteRequest('fetch_sheet_xlsx',{spreadsheetId});
        if(remote?.data){
          const bytes=base64ToBytes(remote.data);
          return XLSX.read(bytes,{type:'array',cellDates:true});
        }
      }catch(e){
        if(e?.code==='google_auth_required' || /requiere iniciar sesión|cualquier persona con el enlace/i.test(e?.message||'')){
          throw e;
        }
        console.warn('Falló lectura backend; pruebo compatibilidad pública',e);
      }
    }

    // Respaldo sólo para Sheets realmente públicas.
    const wb=XLSX.utils.book_new();
    let found=0;
    const messages=[];
    for(const sheetName of ['Propuestas','Inscripciones','Asistencias','Bajas','Tutor']){
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

    if(!found) throw new Error(messages.join(' · ') || 'No pude leer la Google Sheet.');
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

  function ensureTutorCourseSource(){
    const sources=dataset.sources||[];
    let src=sources.find(x=>x.sourceKind==='tutor_courses' || x.id===TUTOR_COURSE_SOURCE.id);
    if(!src){
      src={...TUTOR_COURSE_SOURCE,status:'pending_backend',lastSyncAt:null,createdAt:new Date().toISOString()};
      dataset.sources=[...sources,src];
    }else{
      Object.assign(src,{
        sourceKind:TUTOR_COURSE_SOURCE.sourceKind,
        actionCode:TUTOR_COURSE_SOURCE.actionCode,
        name:TUTOR_COURSE_SOURCE.name,
        url:TUTOR_COURSE_SOURCE.url,
        spreadsheetId:TUTOR_COURSE_SOURCE.spreadsheetId,
        gid:TUTOR_COURSE_SOURCE.gid,
        authMode:'backend_link',
        intervalMinutes:5,
        active:true,
        locked:true
      });
    }
    return src;
  }

  function tutorRowsFromWorkbook(wb,sourceName){
    let best={score:-1,rows:[]};
    for(const sheetName of wb.SheetNames||[]){
      const rows=XLSX.utils.sheet_to_json(wb.Sheets[sheetName],{defval:'',raw:true});
      if(!rows.length)continue;
      const parsed=parseTutorRows(rows,'',sourceName,{sourceKind:'tutor_courses',authoritative:true});
      if(!parsed.length)continue;
      const specific=parsed.filter(x=>x.commissionCode||x.courseName).length;
      const nameBoost=/tutor|capacit|curso|comision/i.test(normalize(sheetName))?10:0;
      const score=parsed.length+(specific*4)+nameBoost;
      if(score>best.score)best={score,rows};
    }
    return best.rows;
  }

  async function syncTutorCourseSource(src,{silent=false}={}){
    if(!src || src.status==='syncing')return;
    src.status='syncing';
    src.authMode='backend_link';
    src.lastSyncMessage='Leyendo tutores y cursos...';
    renderSources();

    try{
      let rows=[];
      let firstError=null;

      try{
        rows=await loadGvizSheet(src.spreadsheetId,{gid:src.gid});
      }catch(e){
        firstError=e;
      }

      let tutors=parseTutorRows(rows,'',src.name,{sourceKind:'tutor_courses',authoritative:true});

      if(!tutors.length && remoteReady){
        try{
          const remote=await remoteRequest('fetch_sheet_xlsx',{spreadsheetId:src.spreadsheetId});
          if(remote?.data){
            const bytes=base64ToBytes(remote.data);
            const wb=XLSX.read(bytes,{type:'array',cellDates:true});
            const fallbackRows=tutorRowsFromWorkbook(wb,src.name);
            tutors=parseTutorRows(fallbackRows,'',src.name,{sourceKind:'tutor_courses',authoritative:true});
          }
        }catch(e){
          firstError=firstError||e;
        }
      }

      if(!tutors.length){
        throw firstError || new Error('No encontré filas con acción/curso y tutor o capacitador en la hoja configurada.');
      }

      const previousCodes=unique((dataset.tutors||[])
        .filter(x=>x.sourceKind==='tutor_courses')
        .map(x=>x.actionCode));
      const newCodes=unique(tutors.map(x=>x.actionCode));
      const affectedCodes=unique([...previousCodes,...newCodes]);

      dataset.tutors=(dataset.tutors||[])
        .filter(x=>x.sourceKind!=='tutor_courses')
        .concat(dedupe(tutors,tutorDedupeKey));

      applyTutorsToDataset();

      src.status='ok';
      src.lastSyncAt=new Date().toISOString();
      src.lastSyncMessage=tutors.length+' asignación(es) de tutor/capacitador · '+newCodes.length+' acción(es)';
      await saveState();

      if(remoteReady){
        for(const code of affectedCodes){
          if(!dataset.actions.some(a=>a.code===code))continue;
          try{await saveRemoteAction(code)}
          catch(e){console.error('No se pudo persistir la asignación de tutores de '+code,e)}
        }
      }

      renderAll();
      if(!silent)toast('Tutores y cursos sincronizados.');
    }catch(e){
      console.error('Error sincronizando tutores y cursos',e);
      src.status='error';
      const msg=e?.message||'No se pudo sincronizar tutores y cursos.';
      if(e?.code==='google_auth_required' || /requiere iniciar sesión|cualquier persona con el enlace|HTTP 401|HTTP 403/i.test(msg)){
        src.lastSyncMessage='La hoja de tutores requiere acceso por enlace. Compartila como “Cualquier persona con el enlace”.';
      }else{
        src.lastSyncMessage=msg;
      }
      await saveState();
      renderSources();
      if(!silent)toast('No se pudieron sincronizar tutores y cursos.');
    }
  }

  async function syncSourceNow(sourceId,{silent=false}={}){
    const src=(dataset.sources||[]).find(x=>x.id===sourceId);
    if(!src || src.status==='syncing') return;
    if(src.sourceKind==='tutor_courses')return syncTutorCourseSource(src,{silent});
    src.status='syncing';
    src.authMode='backend_link';
    src.lastSyncMessage='Leyendo Google Sheets desde backend...';
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
      if(e?.code==='google_auth_required' || /requiere iniciar sesión|cualquier persona con el enlace|HTTP 401|HTTP 403/i.test(msg)){
        src.status='error';
        src.authMode='backend_link';
        src.lastSyncMessage='Google exige inicio de sesión. Compartí la planilla como “Cualquier persona con el enlace” para sincronizarla sin OAuth.';
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
      (dataset.sources||[]).filter(s=>s.active!==false).forEach(s=>{
        const intervalMs=(Number(s.intervalMinutes)||5)*60000;
        const last=s.lastSyncAt ? new Date(s.lastSyncAt).getTime() : 0;
        const pending=!s.lastSyncAt || s.status==='pending_backend' || s.status==='error' || !s.status;
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
    $('#sourcePendingCount').textContent=sources.filter(x=>x.status==='pending_backend'||x.status==='error'||!x.status).length.toLocaleString('es-AR');

    $('#sourceTable').innerHTML=sources.slice().sort((a,b)=>(b.createdAt||'').localeCompare(a.createdAt||'')).map(s=>{
      const sid=s.spreadsheetId||spreadsheetIdFromUrl(s.url);
      const status=s.status||'pending_backend';
      const globalSource=s.sourceKind==='tutor_courses';
      return `<tr>
        <td><strong>${esc(globalSource?'GLOBAL':(s.actionCode||'—'))}</strong></td>
        <td><span class="source-name">${esc(s.name||'Google Sheet')}</span><span class="source-id">${esc(sid||s.url||'')}</span></td>
        <td>${esc(globalSource?'Fuente maestra':sourceAuthLabel(s.authMode))}</td>
        <td>cada ${Number(s.intervalMinutes)||5} min</td>
        <td><span class="source-status ${status==='ok'?'ok':status==='error'?'error':'pending'}">${esc(sourceStatusLabel(status))}</span>${s.lastSyncMessage?`<span class="source-id" title="${esc(s.lastSyncMessage)}">${esc(s.lastSyncMessage)}</span>`:''}</td>
        <td>${s.lastSyncAt?new Date(s.lastSyncAt).toLocaleString('es-AR'):'—'}</td>
        <td><button class="source-action-btn" data-sync-source="${esc(s.id)}">Sincronizar</button>${globalSource?'':' <button class="source-action-btn" data-remove-source="'+esc(s.id)+'">Quitar</button>'}</td>
      </tr>`;
    }).join('') || '<tr><td colspan="7" class="empty">Todavía no registraste fuentes. Podés asociar el link de cada Google Sheet desde el formulario.</td></tr>';

    document.querySelectorAll('[data-sync-source]').forEach(btn=>btn.addEventListener('click',()=>syncSourceNow(btn.dataset.syncSource)));
    document.querySelectorAll('[data-remove-source]').forEach(btn=>btn.addEventListener('click',async()=>{
      const id=btn.dataset.removeSource;
      const src=(dataset.sources||[]).find(x=>x.id===id);
      if(!src || src.sourceKind==='tutor_courses') return;
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
      authMode:'backend_link',
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
    toast('Link registrado. Probando sincronización por backend...');
    await syncSourceNow(source.id);
  }


  const EDITOR_TYPES={
    registrations:{label:'Personas / inscripciones',singular:'persona / inscripción'},
    attendance:{label:'Asistencias',singular:'asistencia'},
    bajas:{label:'Bajas',singular:'baja'},
    tutors:{label:'Tutores / capacitadores',singular:'tutor / capacitador'},
    proposals:{label:'Comisiones / propuestas',singular:'comisión / propuesta'}
  };
  const FIELD_LABELS={
    actionCode:'Acción',commissionCode:'Comisión / código',code:'Código',commission:'Comisión',
    dni:'DNI',cuil:'CUIL',firstName:'Nombre',surname:'Apellido',name:'Apellido y nombre',
    email:'Correo',schoolRaw:'Escuela original',school:'Escuela',cueAnexo:'CUE anexo',cue:'CUE',
    dependency:'Dependencia',sector:'Sector de gestión',comuna:'Comuna',status:'Estado',
    statusDate:'Fecha de estado',bajaDate:'Fecha de baja',region:'DE / Región',area:'Área',
    areaClass:'Área clasificada',cargo:'Cargo',cargoClass:'Cargo clasificado',formation:'Formación',
    venue:'Sede',shift:'Turno',tutor:'Tutor / capacitador',registrationDate:'Fecha de inscripción',
    dataYear:'Año',universe:'Universo',isDar:'Es DAR',
    encounter:'Encuentro',eventDate:'Fecha de encuentro',capturedAt:'Fecha del registro',
    reason:'Motivo / observación',date:'Fecha',courseName:'Curso / comisión',source:'Fuente',capacity:'Cupo',
    registeredReported:'Inscriptos informados',tutors:'Tutores / capacitadores',meetings:'Encuentros'
  };
  const PREFERRED_FIELDS={
    registrations:['dni','surname','firstName','name','email','commissionCode','dataYear','universe','isDar','school','cue','cueAnexo','dependency','sector','comuna','status','statusDate','bajaDate','region','area','areaClass','cargo','cargoClass','formation','venue','shift','tutor','registrationDate','source'],
    attendance:['dni','surname','firstName','name','email','commissionCode','dataYear','universe','isDar','encounter','eventDate','capturedAt','school','cue','cueAnexo','dependency','sector','comuna','status','region','area','areaClass','cargo','cargoClass','formation','venue','shift','tutor','source'],
    bajas:['dni','surname','firstName','name','email','commissionCode','dataYear','universe','isDar','bajaDate','school','cue','cueAnexo','dependency','sector','comuna','status','reason','source'],
    tutors:['dni','name','commissionCode','courseName','date','source'],
    proposals:['code','commission','dataYear','universe','isDar','area','areaClass','formation','venue','shift','capacity','registeredReported','tutors','meetings']
  };
  let editorState={recordRef:null,isNew:false,reportRows:[],reportColumns:[]};

  function editorActionCode(){
    return String($('#editorAction')?.value||'').trim().toUpperCase();
  }
  function editorType(){
    return $('#editorDataset')?.value||'registrations';
  }
  function actionEditorConfig(code){
    const action=dataset.actions.find(a=>a.code===code);
    if(!action)return null;
    if(!action.editor || typeof action.editor!=='object')action.editor={};
    const e=action.editor;
    if(!Array.isArray(e.customFields))e.customFields=[];
    if(!e.overrides || typeof e.overrides!=='object')e.overrides={};
    if(!e.originals || typeof e.originals!=='object')e.originals={};
    if(!e.additions || typeof e.additions!=='object')e.additions={};
    if(!e.deletions || typeof e.deletions!=='object')e.deletions={};
    for(const type of Object.keys(EDITOR_TYPES)){
      if(!e.overrides[type] || typeof e.overrides[type]!=='object')e.overrides[type]={};
      if(!e.originals[type] || typeof e.originals[type]!=='object')e.originals[type]={};
      if(!Array.isArray(e.additions[type]))e.additions[type]=[];
      if(!Array.isArray(e.deletions[type]))e.deletions[type]=[];
    }
    return e;
  }
  function editorId(){
    return globalThis.crypto?.randomUUID?.() || ('edit-'+Date.now()+'-'+Math.random().toString(36).slice(2));
  }
  function recordIdentity(type,row){
    if(row?._recordKey)return row._recordKey;
    if(row?._manualId)return 'manual:'+row._manualId;
    if(type==='registrations')return [row.actionCode,row.commissionCode,idOf(row)].join('|');
    if(type==='attendance')return [row.actionCode,row.commissionCode,idOf(row),row.encounter,row.eventDate,row.capturedAt].join('|');
    if(type==='bajas')return [row.actionCode,idOf(row),row.bajaDate,row.reason].join('|');
    if(type==='tutors')return tutorDedupeKey(row);
    if(type==='proposals')return [row.actionCode,row.code||row.commission].join('|');
    return [row?.actionCode,JSON.stringify(row||{})].join('|');
  }
  function stripEditorMeta(row){
    const out={};
    for(const [k,v] of Object.entries(row||{})){
      if(k.startsWith('_'))continue;
      out[k]=v;
    }
    return out;
  }
  function applyEditorLayer(code){
    const cfg=actionEditorConfig(code);
    if(!cfg)return;
    for(const type of Object.keys(EDITOR_TYPES)){
      const all=Array.isArray(dataset[type])?dataset[type]:[];
      const others=all.filter(r=>r.actionCode!==code);
      let base=all.filter(r=>r.actionCode===code && !r._manualAdded);
      const deleted=new Set(cfg.deletions[type]||[]);
      base=base.filter(r=>!deleted.has(recordIdentity(type,r)));
      base=base.map(r=>{
        const key=recordIdentity(type,r);
        const patch=cfg.overrides[type]?.[key];
        return patch?{...r,...structuredClone(patch),actionCode:code,_recordKey:key}:r;
      });
      const additions=(cfg.additions[type]||[]).map(r=>({...structuredClone(r),actionCode:code,_manualAdded:true}));
      dataset[type]=others.concat(base,additions);
    }
  }
  function applyAllEditorLayers(){
    for(const a of dataset.actions||[])applyEditorLayer(a.code);
  }
  function customFieldDefs(code,type){
    const global=(dataset.customFields||[]).filter(f=>f.dataset===type && f.active!==false);
    const local=(actionEditorConfig(code)?.customFields||[]).filter(f=>f.dataset===type && f.active!==false);
    const map=new Map();
    [...global,...local].forEach(f=>map.set(f.key,f));
    return [...map.values()];
  }
  function recordFieldsFor(code,type){
    const rows=(dataset[type]||[]).filter(r=>r.actionCode===code).slice(0,500);
    const keys=new Set(PREFERRED_FIELDS[type]||[]);
    rows.forEach(r=>Object.keys(r||{}).forEach(k=>{
      if(k==='actionCode'||k.startsWith('_'))return;
      if(k.startsWith('custom_'))return;
      keys.add(k);
    }));
    const defs=customFieldDefs(code,type);
    defs.forEach(f=>keys.add(f.key));
    const preferred=PREFERRED_FIELDS[type]||[];
    return [...keys].filter(Boolean).sort((a,b)=>{
      const ai=preferred.indexOf(a),bi=preferred.indexOf(b);
      if(ai>=0||bi>=0)return (ai<0?999:ai)-(bi<0?999:bi);
      return (FIELD_LABELS[a]||a).localeCompare(FIELD_LABELS[b]||b,'es');
    }).map(key=>{
      const custom=defs.find(f=>f.key===key);
      return custom || {key,label:FIELD_LABELS[key]||key,type:inferFieldType(key,rows)};
    });
  }
  function inferFieldType(key,rows=[]){
    if(/capturedat|createdat|updatedat|finalizedat/i.test(String(key||'')))return 'datetime';
    if(/date|fecha/i.test(key))return 'date';
    const sample=rows.map(r=>r?.[key]).find(v=>v!==''&&v!==null&&v!==undefined);
    if(typeof sample==='number')return 'number';
    if(typeof sample==='boolean')return 'boolean';
    if(Array.isArray(sample)||sample&&typeof sample==='object')return 'json';
    return 'text';
  }
  function displayEditorValue(v){
    if(v===null||v===undefined||v==='')return '—';
    if(Array.isArray(v))return v.map(x=>typeof x==='object'?JSON.stringify(x):x).join(' · ');
    if(typeof v==='object')return JSON.stringify(v);
    return String(v);
  }
  function editorSearchMatch(row,q){
    if(!q)return true;
    return normalize(Object.entries(row||{}).filter(([k])=>!k.startsWith('_')).map(([,v])=>displayEditorValue(v)).join(' ')).includes(q);
  }
  function renderEditor(){
    const actionSel=$('#editorAction');
    if(!actionSel)return;
    const previous=actionSel.value;
    actionSel.innerHTML=(dataset.actions||[]).slice().sort((a,b)=>a.code.localeCompare(b.code)).map(a=>'<option value="'+esc(a.code)+'">'+esc(a.code+' · '+(a.title||''))+'</option>').join('');
    if(dataset.actions.some(a=>a.code===previous))actionSel.value=previous;
    else if($('#filterAction')?.value && dataset.actions.some(a=>a.code===$('#filterAction').value))actionSel.value=$('#filterAction').value;
    const code=editorActionCode();
    const type=editorType();
    if(!code){
      $('#editorCount').textContent='0 registros';
      $('#editorTableHead').innerHTML='';
      $('#editorTableBody').innerHTML='<tr><td class="empty">No hay acciones cargadas.</td></tr>';
      renderEditorFields();
      renderReportBuilder();
      return;
    }
    actionEditorConfig(code);
    const q=normalize($('#editorSearch')?.value||'');
    const rows=(dataset[type]||[]).filter(r=>r.actionCode===code && editorSearchMatch(r,q));
    const fields=recordFieldsFor(code,type);
    const fieldByKey=new Map(fields.map(f=>[f.key,f]));
    const attendanceKeys=['dni','surname','firstName','name','email','commissionCode','dataYear','universe','eventDate','encounter'];
    const visible=type==='attendance'
      ? attendanceKeys.map(key=>fieldByKey.get(key)).filter(Boolean)
      : fields.slice(0,7);
    const tableLabel=f=>{
      if(type==='attendance'&&f.key==='eventDate')return 'Fecha de asistencia';
      return f.label||FIELD_LABELS[f.key]||f.key;
    };
    const tableValue=(r,f)=>{
      const value=r[f.key];
      if(type==='attendance'&&f.key==='eventDate')return value?formatDate(value):'—';
      if(type==='attendance'&&f.key==='capturedAt'&&value){
        const d=new Date(value);
        return Number.isNaN(d.getTime())?displayEditorValue(value):d.toLocaleString('es-AR');
      }
      return displayEditorValue(value);
    };
    $('#editorCount').textContent=rows.length.toLocaleString('es-AR')+' registro(s) · '+EDITOR_TYPES[type].label;
    $('#editorTableHead').innerHTML='<tr>'+visible.map(f=>'<th>'+esc(tableLabel(f))+'</th>').join('')+'<th></th></tr>';
    $('#editorTableBody').innerHTML=rows.slice(0,1000).map((r,i)=>{
      const key=recordIdentity(type,r);
      return '<tr data-editor-row="'+esc(key)+'">'+visible.map(f=>'<td>'+esc(tableValue(r,f))+'</td>').join('')+
        '<td><button type="button" class="source-action-btn" data-edit-record="'+esc(key)+'">Editar</button></td></tr>';
    }).join('') || '<tr><td colspan="'+(visible.length+1)+'" class="empty">No hay registros para esta selección.</td></tr>';
    renderEditorFields();
    renderReportBuilder();
  }
  function renderEditorFields(){
    const host=$('#editorFieldsList'); if(!host)return;
    const code=editorActionCode(),type=editorType();
    if(!code){host.innerHTML='<div class="empty">Elegí una acción.</div>';return}
    const global=(dataset.customFields||[]).filter(f=>f.dataset===type);
    const local=(actionEditorConfig(code)?.customFields||[]).filter(f=>f.dataset===type);
    const defs=[...global.map(f=>({...f,_scope:'global'})),...local.map(f=>({...f,_scope:'action'}))];
    host.innerHTML=defs.map(f=>'<div class="editor-field-item">'+
      '<div><strong>'+esc(f.label)+'</strong><span>'+esc(f.key)+' · '+esc(f.type)+(f._scope==='global'?' · todas las acciones':' · '+code)+'</span></div>'+
      '<div><button type="button" class="source-action-btn" data-edit-field="'+esc(f.id)+'" data-field-scope="'+f._scope+'">Editar</button> '+
      '<button type="button" class="source-action-btn" data-toggle-field="'+esc(f.id)+'" data-field-scope="'+f._scope+'">'+(f.active===false?'Activar':'Desactivar')+'</button></div>'+
      '</div>').join('') || '<div class="empty">Todavía no agregaste campos personalizados.</div>';
  }
  function fieldDefinitionById(id,scope,code){
    if(scope==='global')return (dataset.customFields||[]).find(f=>f.id===id);
    return (actionEditorConfig(code)?.customFields||[]).find(f=>f.id===id);
  }
  function openFieldModal(existing=null,scope='action'){
    const code=editorActionCode(); if(!code){toast('Elegí una acción.');return}
    $('#editorFieldId').value=existing?.id||'';
    $('#editorFieldTitle').textContent=existing?'Editar campo':'Agregar campo';
    $('#editorFieldLabel').value=existing?.label||'';
    $('#editorFieldKey').value=existing?.key||'';
    $('#editorFieldDataset').value=existing?.dataset||editorType();
    $('#editorFieldScope').value=scope;
    $('#editorFieldType').value=existing?.type||'text';
    $('#editorFieldOptions').value=(existing?.options||[]).join('\n');
    $('#editorFieldOptionsWrap').hidden=$('#editorFieldType').value!=='select';
    $('#editorFieldModal').hidden=false;
    setTimeout(()=>$('#editorFieldLabel')?.focus(),30);
  }
  function closeFieldModal(){ if($('#editorFieldModal'))$('#editorFieldModal').hidden=true; }
  function fieldKeyFromLabel(v=''){
    const base=normalize(v).replace(/\s+/g,'_').replace(/[^a-z0-9_]/g,'').slice(0,40)||'campo';
    return 'custom_'+base;
  }
  async function saveEditorField(e){
    e.preventDefault();
    const code=editorActionCode(); if(!code)return;
    const id=$('#editorFieldId').value||editorId();
    const label=$('#editorFieldLabel').value.trim();
    let key=$('#editorFieldKey').value.trim();
    if(!key)key=fieldKeyFromLabel(label);
    key=key.startsWith('custom_')?key:fieldKeyFromLabel(key);
    const datasetType=$('#editorFieldDataset').value;
    const scope=$('#editorFieldScope').value;
    const type=$('#editorFieldType').value;
    const options=type==='select'?unique($('#editorFieldOptions').value.split(/\n|;/).map(x=>x.trim()).filter(Boolean)):[];
    const item={id,key,label,type,options,dataset:datasetType,active:true,updatedAt:new Date().toISOString()};
    if(scope==='global'){
      dataset.customFields=[...(dataset.customFields||[]).filter(f=>f.id!==id),item];
      await saveState();
      if(!remoteReady){
        const ok=await ensureRemoteAccess({interactive:true});
        if(!ok)throw new Error('Supabase no está conectado.');
      }
      await saveRemoteConfig();
    }else{
      const cfg=actionEditorConfig(code);
      cfg.customFields=[...(cfg.customFields||[]).filter(f=>f.id!==id),item];
      await persistEditorAction(code);
    }
    closeFieldModal(); renderEditor(); toast('Campo guardado.');
  }
  async function toggleEditorField(id,scope){
    const code=editorActionCode();
    const field=fieldDefinitionById(id,scope,code); if(!field)return;
    field.active=field.active===false?true:false;
    field.updatedAt=new Date().toISOString();
    if(scope==='global'){
      await saveState();
      if(!remoteReady){
        const ok=await ensureRemoteAccess({interactive:true});
        if(!ok)throw new Error('Supabase no está conectado.');
      }
      await saveRemoteConfig();
    }else await persistEditorAction(code);
    renderEditor();
    toast(field.active===false?'Campo desactivado; los datos se conservan.':'Campo activado.');
  }
  function editorDateTimeLocalValue(value){
    if(!value)return '';
    const d=new Date(value);
    if(Number.isNaN(d.getTime()))return String(value).slice(0,16);
    const pad=n=>String(n).padStart(2,'0');
    return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate())+'T'+pad(d.getHours())+':'+pad(d.getMinutes());
  }

  function meetingEditorText(meetings=[]){
    return (meetings||[]).map((m,i)=>{
      const label=String(m?.label||('Encuentro '+(i+1))).trim();
      const date=String(m?.date||'').trim();
      const text=String(m?.text||'').trim();
      return label+' | '+(date||text);
    }).join('\n');
  }

  function fieldInputHtml(field,value){
    const id='editfld_'+field.key;
    const val=value??'';
    if(field.key==='meetings'){
      return '<label class="editor-field-input full"><span>'+esc(field.label)+'</span>'+
        '<textarea name="'+esc(field.key)+'" data-editor-kind="meetings" rows="6" placeholder="Encuentro 1 | 2026-08-12">'+esc(meetingEditorText(Array.isArray(val)?val:[]))+'</textarea>'+
        '<small>Una fecha por línea: nombre del encuentro | AAAA-MM-DD</small></label>';
    }
    if(field.type==='boolean')return '<label class="editor-field-input"><span>'+esc(field.label)+'</span><select name="'+esc(field.key)+'" id="'+esc(id)+'"><option value=""></option><option value="true" '+(val===true||String(val)==='true'?'selected':'')+'>Sí</option><option value="false" '+(val===false||String(val)==='false'?'selected':'')+'>No</option></select></label>';
    if(field.type==='select')return '<label class="editor-field-input"><span>'+esc(field.label)+'</span><select name="'+esc(field.key)+'" id="'+esc(id)+'"><option value=""></option>'+(field.options||[]).map(o=>'<option value="'+esc(o)+'" '+(String(val)===String(o)?'selected':'')+'>'+esc(o)+'</option>').join('')+'</select></label>';
    if(field.type==='json'||(Array.isArray(val)&&val.some(x=>x&&typeof x==='object'))||(val&&typeof val==='object'&&!Array.isArray(val))){
      const text=JSON.stringify(val??'',null,2);
      return '<label class="editor-field-input full"><span>'+esc(field.label)+'</span><textarea name="'+esc(field.key)+'" data-editor-kind="json" rows="6">'+esc(text)+'</textarea></label>';
    }
    if(field.type==='textarea'||Array.isArray(val)){
      const text=Array.isArray(val)?val.join('\n'):String(val||'');
      return '<label class="editor-field-input full"><span>'+esc(field.label)+'</span><textarea name="'+esc(field.key)+'" data-editor-kind="'+(Array.isArray(val)?'array':'text')+'" rows="4">'+esc(text)+'</textarea></label>';
    }
    const inputType=field.type==='number'?'number':field.type==='date'?'date':field.type==='datetime'?'datetime-local':'text';
    const inputValue=field.type==='datetime'?editorDateTimeLocalValue(val):val;
    return '<label class="editor-field-input"><span>'+esc(field.label)+'</span><input name="'+esc(field.key)+'" type="'+inputType+'" value="'+esc(inputValue)+'" /></label>';
  }

  function openRecordModal(row=null){
    const code=editorActionCode(),type=editorType(); if(!code)return;
    editorState.recordRef=row;
    editorState.isNew=!row;
    const record=row||{actionCode:code};
    const fields=recordFieldsFor(code,type);
    $('#editorRecordTitle').textContent=(row?'Editar ':'Agregar ')+EDITOR_TYPES[type].singular+' · '+code;
    $('#editorRecordFields').innerHTML=fields.map(f=>fieldInputHtml(f,record[f.key])).join('');
    $('#editorDeleteRecord').hidden=!row;
    const key=row?recordIdentity(type,row):'';
    const cfg=actionEditorConfig(code);
    const canRestore=!!(row && !row._manualAdded && !row._manualId && cfg?.overrides?.[type]?.[key]);
    if($('#editorRestoreRecord'))$('#editorRestoreRecord').hidden=!canRestore;
    $('#editorRecordModal').hidden=false;
  }
  function closeRecordModal(){if($('#editorRecordModal'))$('#editorRecordModal').hidden=true;editorState.recordRef=null;editorState.isNew=false;}
  function parseEditorFieldValue(field,control,existing){
    if(!control)return existing??'';
    let value=control.value;
    if(field.type==='number')return value===''?'':num(value);
    if(field.type==='boolean')return value===''?'':value==='true';
    if(field.type==='datetime')return value===''?'':new Date(value).toISOString();
    const kind=control.dataset?.editorKind;
    if(kind==='meetings'){
      return value.split(/\n+/).map((line,i)=>{
        const parts=line.split('|').map(x=>x.trim());
        const label=parts.shift()||('Encuentro '+(i+1));
        const raw=parts.join('|').trim();
        if(!raw)return null;
        const date=/^\d{4}-\d{2}-\d{2}$/.test(raw)?raw:isoDate(raw,new Date().getFullYear());
        return {label,text:date?formatDate(date):raw,date:date||''};
      }).filter(Boolean);
    }
    if(kind==='array')return unique(value.split(/\n|;/).map(x=>x.trim()).filter(Boolean));
    if(kind==='json'){
      if(!value.trim())return Array.isArray(existing)?[]:{};
      try{return JSON.parse(value)}catch(e){throw new Error('JSON inválido en '+field.label)}
    }
    return value;
  }
  async function persistEditorAction(code){
    await saveState();
    if(!remoteReady){
      const ok=await ensureRemoteAccess({interactive:true});
      if(!ok)throw new Error('Supabase no está conectado.');
    }
    await saveRemoteAction(code);
    setStorageUi('connected',dataset.actions.length+' acción(es) guardada(s) online y verificadas.');
  }
  async function saveEditorRecord(e){
    e.preventDefault();
    const code=editorActionCode(),type=editorType(); if(!code)return;
    const fields=recordFieldsFor(code,type);
    const current=editorState.recordRef;
    const base=current?{...current}:{actionCode:code};
    try{
      for(const field of fields){
        const control=$('#editorRecordForm [name="'+CSS.escape(field.key)+'"]');
        base[field.key]=parseEditorFieldValue(field,control,current?.[field.key]);
      }
      base.actionCode=code;
      if(type==='registrations' && !base.status)base.status='Activo';
      if(type==='bajas')base.status='Baja';
      const areaChanged=!current || String(base.area??'')!==String(current?.area??'');
      const areaClassChanged=!current || String(base.areaClass??'')!==String(current?.areaClass??'');
      const cargoChanged=!current || String(base.cargo??'')!==String(current?.cargo??'');
      const cargoClassChanged=!current || String(base.cargoClass??'')!==String(current?.cargoClass??'');
      if(base.area!==undefined && areaChanged && !areaClassChanged)base.areaClass=classifyArea(base.area)||base.areaClass||'';
      if(base.cargo!==undefined && cargoChanged && !cargoClassChanged)base.cargoClass=classifyCargo(base.cargo)||base.cargoClass||'';
      const cfg=actionEditorConfig(code);
      if(editorState.isNew){
        base._manualId=editorId();
        base._manualAdded=true;
        cfg.additions[type].push({...stripEditorMeta(base),_manualId:base._manualId});
        dataset[type].push(base);
      }else{
        const key=recordIdentity(type,current);
        base._recordKey=key;
        if(current._manualAdded || current._manualId){
          const mid=current._manualId;
          const idx=cfg.additions[type].findIndex(x=>x._manualId===mid);
          const stored={...stripEditorMeta(base),_manualId:mid};
          if(idx>=0)cfg.additions[type][idx]=stored; else cfg.additions[type].push(stored);
        }else{
          if(!cfg.originals[type][key])cfg.originals[type][key]=stripEditorMeta(current);
          cfg.overrides[type][key]=stripEditorMeta(base);
        }
        const idx=dataset[type].indexOf(current);
        if(idx>=0)dataset[type][idx]=base;
      }
      await persistEditorAction(code);
      closeRecordModal();
      applyFilters();renderEditor();
      toast('Registro guardado online.');
    }catch(err){
      console.error(err);toast(err?.message||'No se pudo guardar el registro.');
    }
  }
  async function restoreEditorRecord(){
    const code=editorActionCode(),type=editorType(),row=editorState.recordRef;
    if(!code||!row)return;
    const cfg=actionEditorConfig(code);
    const key=recordIdentity(type,row);
    const original=cfg?.originals?.[type]?.[key];
    if(!original){
      toast('No hay una copia original disponible para este registro.');
      return;
    }
    if(!confirm('¿Restaurar este registro al valor original importado?'))return;
    delete cfg.overrides[type][key];
    delete cfg.originals[type][key];
    const idx=(dataset[type]||[]).indexOf(row);
    if(idx>=0)dataset[type][idx]={...structuredClone(original),actionCode:code};
    try{
      applyTutorsToDataset();
      applyEditorLayer(code);
      await persistEditorAction(code);
      closeRecordModal();
      applyFilters();renderEditor();
      toast('Registro restaurado al valor original.');
    }catch(e){
      console.error(e);toast('No se pudo verificar la restauración en Supabase.');
    }
  }

  async function deleteEditorRecord(){
    const code=editorActionCode(),type=editorType(),row=editorState.recordRef;
    if(!code||!row)return;
    if(!confirm('¿Eliminar este registro de '+EDITOR_TYPES[type].label+'?'))return;
    const cfg=actionEditorConfig(code);
    if(row._manualAdded||row._manualId){
      cfg.additions[type]=cfg.additions[type].filter(x=>x._manualId!==row._manualId);
    }else{
      const key=recordIdentity(type,row);
      cfg.deletions[type]=unique([...(cfg.deletions[type]||[]),key]);
      delete cfg.overrides[type][key];
      delete cfg.originals[type][key];
    }
    dataset[type]=dataset[type].filter(x=>x!==row);
    try{
      await persistEditorAction(code);
      closeRecordModal();applyFilters();renderEditor();toast('Registro eliminado y guardado online.');
    }catch(e){console.error(e);toast('No se pudo verificar la eliminación en Supabase.');}
  }
  function rowByEditorKey(type,code,key){
    return (dataset[type]||[]).find(r=>r.actionCode===code && recordIdentity(type,r)===key);
  }
  function reportRowsFor(type,code,q=''){
    const nq=normalize(q);
    return (dataset[type]||[]).filter(r=>r.actionCode===code && (!nq||editorSearchMatch(r,nq)));
  }
  function renderReportBuilder(){
    const code=editorActionCode();if(!$('#reportColumns'))return;
    const type=$('#reportDataset')?.value||editorType();
    if(!code){$('#reportColumns').innerHTML='';return}
    const fields=recordFieldsFor(code,type);
    const selected=new Set(editorState.reportColumns||[]);
    if(!selected.size)fields.slice(0,8).forEach(f=>selected.add(f.key));
    $('#reportColumns').innerHTML=fields.map(f=>'<label class="report-column"><input type="checkbox" value="'+esc(f.key)+'" '+(selected.has(f.key)?'checked':'')+' /> '+esc(f.label)+'</label>').join('');
    const group=$('#reportGroupBy'),old=group.value;
    group.innerHTML='<option value="">Sin agrupación</option>'+fields.map(f=>'<option value="'+esc(f.key)+'">'+esc(f.label)+'</option>').join('');
    if(fields.some(f=>f.key===old))group.value=old;
  }
  function buildCustomReport(){
    const code=editorActionCode(); if(!code)return {rows:[],fields:[]};
    const type=$('#reportDataset').value;
    const fields=recordFieldsFor(code,type);
    const selected=[...$('#reportColumns').querySelectorAll('input:checked')].map(x=>x.value);
    editorState.reportColumns=selected;
    const fieldMap=new Map(fields.map(f=>[f.key,f]));
    const rows=reportRowsFor(type,code,$('#reportSearch').value);
    const groupBy=$('#reportGroupBy').value;
    if(groupBy){
      const groups=new Map();
      for(const r of rows){
        const label=displayEditorValue(r[groupBy]);
        if(!groups.has(label))groups.set(label,{records:0,people:new Set()});
        const g=groups.get(label);g.records++;
        const person=idOf(r);if(person)g.people.add(person);
      }
      const gf=fieldMap.get(groupBy)||{label:FIELD_LABELS[groupBy]||groupBy};
      return {rows:[...groups.entries()].map(([label,g])=>({[gf.label]:label,REGISTROS:g.records,PERSONAS:g.people.size||g.records})),fields:[]};
    }
    const chosen=selected.length?selected:fields.slice(0,8).map(f=>f.key);
    return {rows:rows.map(r=>Object.fromEntries(chosen.map(k=>[fieldMap.get(k)?.label||FIELD_LABELS[k]||k,displayEditorValue(r[k])==='—'?'':r[k]]))),fields:chosen};
  }
  function previewCustomReport(){
    const report=buildCustomReport();editorState.reportRows=report.rows;
    const cols=report.rows.length?Object.keys(report.rows[0]):[];
    $('#reportPreviewHead').innerHTML=cols.length?'<tr>'+cols.map(c=>'<th>'+esc(c)+'</th>').join('')+'</tr>':'';
    $('#reportPreviewBody').innerHTML=report.rows.slice(0,300).map(r=>'<tr>'+cols.map(c=>'<td>'+esc(displayEditorValue(r[c]))+'</td>').join('')+'</tr>').join('') || '<tr><td class="empty">Sin resultados.</td></tr>';
  }
  function exportCustomReport(){
    const report=buildCustomReport();
    if(!report.rows.length){toast('No hay datos para exportar.');return}
    const wb=XLSX.utils.book_new();
    appendJsonSheet(wb,'Informe',report.rows);
    XLSX.writeFile(wb,'Informe_'+editorActionCode()+'_'+editorType()+'.xlsx',{compression:true});
    toast('Informe personalizado exportado.');
  }

  let customReportColumns=[];

  function filteredRowsForCustomReport(type){
    const rows=Array.isArray(filtered[type])?filtered[type]:[];
    const q=normalize($('#customReportSearch')?.value||'');
    if(!q)return rows;
    return rows.filter(r=>normalize(Object.entries(r||{})
      .filter(([k])=>!k.startsWith('_'))
      .map(([,v])=>displayEditorValue(v)).join(' ')).includes(q));
  }

  function customReportFields(type){
    const rows=filteredRowsForCustomReport(type).slice(0,500);
    const preferred=PREFERRED_FIELDS[type]||[];
    const keys=new Set(preferred);
    rows.forEach(r=>Object.keys(r||{}).forEach(k=>{
      if(k.startsWith('_'))return;
      keys.add(k);
    }));
    return [...keys].filter(Boolean).sort((a,b)=>{
      const ai=preferred.indexOf(a),bi=preferred.indexOf(b);
      if(ai>=0||bi>=0)return (ai<0?999:ai)-(bi<0?999:bi);
      return (FIELD_LABELS[a]||a).localeCompare(FIELD_LABELS[b]||b,'es');
    }).map(key=>({key,label:FIELD_LABELS[key]||key}));
  }

  function renderCustomReportConfigurator(){
    const host=$('#customReportColumns');
    if(!host)return;
    const type=$('#customReportDataset')?.value||'registrations';
    const fields=customReportFields(type);
    const valid=new Set(fields.map(f=>f.key));
    customReportColumns=customReportColumns.filter(x=>valid.has(x));
    if(!customReportColumns.length)customReportColumns=fields.slice(0,8).map(f=>f.key);
    const selected=new Set(customReportColumns);
    host.innerHTML=fields.map(f=>'<label class="report-column"><input type="checkbox" value="'+esc(f.key)+'" '+(selected.has(f.key)?'checked':'')+' /> '+esc(f.label)+'</label>').join('')||'<div class="empty">No hay columnas disponibles con los filtros actuales.</div>';
    const group=$('#customReportGroupBy');
    if(group){
      const old=group.value;
      group.innerHTML='<option value="">Sin agrupación</option>'+fields.map(f=>'<option value="'+esc(f.key)+'">'+esc(f.label)+'</option>').join('');
      if(fields.some(f=>f.key===old))group.value=old;
    }
  }

  function buildFilteredCustomReport(){
    const type=$('#customReportDataset')?.value||'registrations';
    const fields=customReportFields(type);
    const fieldMap=new Map(fields.map(f=>[f.key,f]));
    const checked=$('#customReportColumns')
      ? [...$('#customReportColumns').querySelectorAll('input:checked')].map(x=>x.value)
      : customReportColumns;
    const chosen=checked.length?checked:fields.slice(0,8).map(f=>f.key);
    customReportColumns=chosen;
    const rows=filteredRowsForCustomReport(type);
    const groupBy=$('#customReportGroupBy')?.value||'';
    const title=$('#customReportTitle')?.value.trim()||'Participación personalizada';

    if(groupBy){
      const groups=new Map();
      for(const r of rows){
        const raw=r?.[groupBy];
        const label=displayEditorValue(raw);
        if(!groups.has(label))groups.set(label,{records:0,people:new Set()});
        const g=groups.get(label);
        g.records++;
        const person=idOf(r);if(person)g.people.add(person);
      }
      const groupLabel=fieldMap.get(groupBy)?.label||FIELD_LABELS[groupBy]||groupBy;
      return {
        title,type,
        rows:[...groups.entries()].map(([label,g])=>({
          [groupLabel]:label==='—'?'Sin dato':label,
          REGISTROS:g.records,
          PERSONAS:g.people.size||g.records
        }))
      };
    }

    return {
      title,type,
      rows:rows.map(r=>Object.fromEntries(chosen.map(k=>{
        const label=fieldMap.get(k)?.label||FIELD_LABELS[k]||k;
        const value=displayEditorValue(r?.[k]);
        return [label,value==='—'?'':value];
      })))
    };
  }

  function renderCustomReportPreview(){
    const report=buildFilteredCustomReport();
    const head=$('#customReportPreviewHead'),body=$('#customReportPreviewBody');
    if(!head||!body)return report;
    const cols=report.rows.length?Object.keys(report.rows[0]):[];
    head.innerHTML=cols.length?'<tr>'+cols.map(c=>'<th>'+esc(c)+'</th>').join('')+'</tr>':'';
    body.innerHTML=report.rows.slice(0,300).map(r=>'<tr>'+cols.map(c=>'<td>'+esc(displayEditorValue(r[c]))+'</td>').join('')+'</tr>').join('')
      || '<tr><td class="empty">Sin resultados con los filtros actuales.</td></tr>';
    if(report.rows.length>300){
      body.insertAdjacentHTML('beforeend','<tr><td colspan="'+Math.max(cols.length,1)+'" class="empty">Vista previa limitada a 300 filas · la exportación incluye '+report.rows.length.toLocaleString('es-AR')+'.</td></tr>');
    }
    return report;
  }

  function exportFilteredCustomReportExcel(){
    const report=buildFilteredCustomReport();
    if(!report.rows.length){toast('No hay datos para exportar.');return}
    const wb=XLSX.utils.book_new();
    appendJsonSheet(wb,'Informe',report.rows);
    XLSX.writeFile(wb,exportFileStem()+'_personalizado.xlsx',{compression:true});
    toast('Informe personalizado exportado a Excel.');
  }

  function exportFilteredCustomReportCsv(){
    const report=buildFilteredCustomReport();
    if(!report.rows.length){toast('No hay datos para exportar.');return}
    const ws=XLSX.utils.json_to_sheet(report.rows);
    const csv=XLSX.utils.sheet_to_csv(ws);
    const blob=new Blob(['\ufeff'+csv],{type:'text/csv;charset=utf-8'});
    const url=URL.createObjectURL(blob);
    const a=document.createElement('a');
    a.href=url;a.download=exportFileStem()+'_personalizado.csv';a.click();
    URL.revokeObjectURL(url);
  }

  function customReportTableHtml(){
    const report=buildFilteredCustomReport();
    const cols=report.rows.length?Object.keys(report.rows[0]):[];
    if(!cols.length)return '<div class="empty">Sin datos para la tabla personalizada.</div>';
    return '<section class="report-output-block report-table-block"><h2>'+esc(report.title)+'</h2>'+
      '<table><thead><tr>'+cols.map(c=>'<th>'+esc(c)+'</th>').join('')+'</tr></thead><tbody>'+
      report.rows.map(r=>'<tr>'+cols.map(c=>'<td>'+esc(displayEditorValue(r[c]))+'</td>').join('')+'</tr>').join('')+
      '</tbody></table></section>';
  }

  function splitTutorDisplay(value=''){
    return unique(String(value||'').split(/\s*[·;\n]\s*/).map(x=>x.trim()).filter(Boolean));
  }

  function discoveredTutorPeople(){
    const map=new Map();
    const add=(name,origin='Automático')=>{
      const clean=String(name||'').trim(); if(!clean)return;
      const key=normalize(clean); if(!key)return;
      if(!map.has(key))map.set(key,{key:'auto:'+key,name:clean,dni:'',email:'',origin});
    };
    for(const t of dataset.tutors||[])add(t.name,t.sourceKind==='tutor_courses'?'Planilla maestra':'Automático');
    for(const r of dataset.registrations||[])splitTutorDisplay(r.tutor).forEach(n=>add(n));
    for(const r of dataset.attendance||[])splitTutorDisplay(r.tutor).forEach(n=>add(n));
    for(const p of dataset.proposals||[])(p.tutors||[]).forEach(n=>add(n));
    return [...map.values()];
  }

  function tutorPeopleCatalog(){
    const automatic=discoveredTutorPeople();
    const byName=new Map(automatic.map(x=>[normalize(x.name),x]));
    for(const p of dataset.manualTutorCatalog||[]){
      const name=String(p?.name||'').trim(); if(!name)continue;
      const key=normalize(name);
      byName.set(key,{
        key:'manual:'+p.id,
        id:p.id,
        name,
        dni:String(p.dni||''),
        email:String(p.email||''),
        origin:'Manual',
        manual:true
      });
    }
    return [...byName.values()].sort((a,b)=>a.name.localeCompare(b.name,'es',{sensitivity:'base'}));
  }

  function actionCommissionOptions(actionCode){
    const map=new Map();
    for(const p of dataset.proposals||[]){
      if(p.actionCode!==actionCode)continue;
      const code=String(p.code||'').trim();
      const name=String(p.commission||'').trim();
      const key=code||name; if(!key)continue;
      map.set(key,{code,name,label:[code,name&&name!==code?name:''].filter(Boolean).join(' · ')});
    }
    for(const r of dataset.registrations||[]){
      if(r.actionCode!==actionCode)continue;
      const code=String(r.commissionCode||'').trim(); if(!code)continue;
      if(!map.has(code))map.set(code,{code,name:'',label:code});
    }
    for(const r of dataset.attendance||[]){
      if(r.actionCode!==actionCode)continue;
      const code=String(r.commissionCode||'').trim(); if(!code)continue;
      if(!map.has(code))map.set(code,{code,name:'',label:code});
    }
    return [...map.values()].sort((a,b)=>a.label.localeCompare(b.label,'es',{numeric:true,sensitivity:'base'}));
  }

  function renderManualTutorCommissionOptions(){
    const action=$('#manualTutorAction')?.value||'';
    const select=$('#manualTutorCommission'); if(!select)return;
    const old=select.value;
    const options=actionCommissionOptions(action);
    select.innerHTML='<option value="">Toda la acción</option>'+options.map(o=>
      '<option value="'+esc(o.code)+'" data-course-name="'+esc(o.name)+'">'+esc(o.label)+'</option>'
    ).join('');
    if(options.some(o=>o.code===old))select.value=old;
  }

  function renderTutorAdmin(){
    if(!$('#view-tutors'))return;
    if(!Array.isArray(dataset.manualTutorCatalog))dataset.manualTutorCatalog=[];
    if(!Array.isArray(dataset.manualTutorAssignments))dataset.manualTutorAssignments=[];

    const people=tutorPeopleCatalog();
    const actions=(dataset.actions||[]).slice().sort((a,b)=>a.code.localeCompare(b.code,'es',{numeric:true}));

    if($('#tutorPeopleCount'))$('#tutorPeopleCount').textContent=people.length.toLocaleString('es-AR');
    if($('#tutorAssignmentCount'))$('#tutorAssignmentCount').textContent=(dataset.manualTutorAssignments||[]).length.toLocaleString('es-AR');
    if($('#tutorActionCount'))$('#tutorActionCount').textContent=new Set((dataset.manualTutorAssignments||[]).map(x=>x.actionCode)).size.toLocaleString('es-AR');

    const actionSel=$('#manualTutorAction');
    if(actionSel){
      const old=actionSel.value;
      actionSel.innerHTML='<option value="">Seleccionar acción...</option>'+actions.map(a=>
        '<option value="'+esc(a.code)+'">'+esc(a.code+' · '+(a.title||a.code))+'</option>'
      ).join('');
      if(actions.some(a=>a.code===old))actionSel.value=old;
    }
    renderManualTutorCommissionOptions();

    const peopleSel=$('#manualTutorPeople');
    if(peopleSel){
      const selected=new Set([...peopleSel.selectedOptions].map(o=>o.value));
      peopleSel.innerHTML=people.map(p=>
        '<option value="'+esc(p.key)+'" '+(selected.has(p.key)?'selected':'')+'>'+esc(p.name+(p.origin==='Manual'?' · manual':' · detectado'))+'</option>'
      ).join('');
    }

    const catalog=$('#manualTutorCatalogTable');
    if(catalog){
      catalog.innerHTML=people.map(p=>'<tr>'+
        '<td><strong>'+esc(p.name)+'</strong>'+(p.email?'<div class="source-id">'+esc(p.email)+'</div>':'')+'</td>'+
        '<td>'+esc(p.dni||'—')+'</td>'+
        '<td><span class="badge">'+esc(p.origin)+'</span></td>'+
        '<td>'+(p.manual?'<button type="button" class="source-action-btn" data-remove-manual-tutor="'+esc(p.id)+'">Quitar</button>':'')+'</td>'+
      '</tr>').join('')||'<tr><td colspan="4" class="empty">Todavía no hay tutores detectados ni cargados.</td></tr>';
    }

    const rows=(dataset.manualTutorAssignments||[]).slice().sort((a,b)=>
      String(a.actionCode).localeCompare(String(b.actionCode),'es',{numeric:true}) ||
      String(a.commissionCode||'').localeCompare(String(b.commissionCode||''),'es',{numeric:true}) ||
      String(a.tutorName||'').localeCompare(String(b.tutorName||''),'es')
    );
    const host=$('#manualTutorAssignmentsTable');
    if(host){
      host.innerHTML=rows.map(a=>'<tr>'+
        '<td><strong>'+esc(a.actionCode)+'</strong></td>'+
        '<td>'+esc(a.commissionCode||a.courseName||'Toda la acción')+'</td>'+
        '<td>'+esc(a.tutorName||'—')+'</td>'+
        '<td><span class="badge">Manual</span></td>'+
        '<td><button type="button" class="source-action-btn" data-remove-tutor-assignment="'+esc(a.id)+'">Quitar</button></td>'+
      '</tr>').join('')||'<tr><td colspan="5" class="empty">No hay asignaciones manuales. Si la fuente automática ya trae tutores, no hace falta cargar nada acá.</td></tr>';
    }
  }

  async function persistTutorAdmin(){
    applyTutorsToDataset();
    await saveState();
    if(remoteReady)await saveRemoteConfig();
    renderAll();
    switchView('tutors');
  }

  async function addManualTutor(e){
    e.preventDefault();
    const name=String($('#manualTutorName')?.value||'').trim();
    const dni=cleanDni($('#manualTutorDni')?.value||'');
    const email=String($('#manualTutorEmail')?.value||'').trim();
    if(!name){toast('Ingresá el nombre del tutor.');return}

    const exists=tutorPeopleCatalog().some(p=>
      normalize(p.name)===normalize(name) || (dni&&cleanDni(p.dni)===dni)
    );
    if(exists){toast('Ese tutor ya está disponible en el catálogo.');return}

    dataset.manualTutorCatalog.push({
      id:globalThis.crypto?.randomUUID?.()||('tutor-'+Date.now()),
      name,dni,email,createdAt:new Date().toISOString()
    });
    $('#manualTutorForm')?.reset();
    try{
      await persistTutorAdmin();
      toast('Tutor agregado al catálogo.');
    }catch(err){
      console.error(err);toast('El tutor quedó localmente, pero no se pudo verificar el guardado online.');
    }
  }

  async function assignManualTutors(e){
    e.preventDefault();
    const actionCode=$('#manualTutorAction')?.value||'';
    if(!/^C\d{4}$/.test(actionCode)){toast('Seleccioná una acción.');return}
    const people=tutorPeopleCatalog();
    const byKey=new Map(people.map(p=>[p.key,p]));
    const selected=[...($('#manualTutorPeople')?.selectedOptions||[])].map(o=>byKey.get(o.value)).filter(Boolean);
    if(!selected.length){toast('Seleccioná al menos un tutor.');return}

    const commissionSelect=$('#manualTutorCommission');
    const commissionCode=String(commissionSelect?.value||'').trim();
    const courseName=commissionSelect?.selectedOptions?.[0]?.dataset?.courseName||'';
    const existing=new Set((dataset.manualTutorAssignments||[]).map(a=>
      [a.actionCode,canonicalCommissionKey(a.commissionCode||''),normalize(a.courseName||''),normalize(a.tutorName||'')].join('|')
    ));
    let added=0;
    for(const p of selected){
      const key=[actionCode,canonicalCommissionKey(commissionCode),normalize(courseName),normalize(p.name)].join('|');
      if(existing.has(key))continue;
      dataset.manualTutorAssignments.push({
        id:globalThis.crypto?.randomUUID?.()||('assign-'+Date.now()+'-'+Math.random().toString(36).slice(2)),
        actionCode,
        commissionCode,
        courseName,
        tutorId:p.id||p.key,
        tutorName:p.name,
        createdAt:new Date().toISOString()
      });
      existing.add(key); added++;
    }
    if(!added){toast('Esas asignaciones ya existían.');return}

    try{
      await persistTutorAdmin();
      toast(added===1?'Tutor asignado.':added+' tutores asignados.');
    }catch(err){
      console.error(err);toast('La asignación quedó localmente, pero no se pudo verificar el guardado online.');
    }
  }

  async function removeManualTutor(id){
    const person=(dataset.manualTutorCatalog||[]).find(x=>x.id===id); if(!person)return;
    const linked=(dataset.manualTutorAssignments||[]).filter(x=>x.tutorId===id || normalize(x.tutorName)===normalize(person.name));
    if(!confirm('¿Quitar a '+person.name+' del catálogo manual?'+(linked.length?' También se quitarán '+linked.length+' asignación(es) manual(es).':'')))return;
    dataset.manualTutorCatalog=dataset.manualTutorCatalog.filter(x=>x.id!==id);
    dataset.manualTutorAssignments=dataset.manualTutorAssignments.filter(x=>x.tutorId!==id && normalize(x.tutorName)!==normalize(person.name));
    try{await persistTutorAdmin();toast('Tutor manual quitado.')}catch(err){console.error(err);toast('Cambio local realizado; no se pudo verificar Supabase.')}
  }

  async function removeManualTutorAssignment(id){
    if(!(dataset.manualTutorAssignments||[]).some(x=>x.id===id))return;
    dataset.manualTutorAssignments=dataset.manualTutorAssignments.filter(x=>x.id!==id);
    try{await persistTutorAdmin();toast('Asignación manual quitada.')}catch(err){console.error(err);toast('Cambio local realizado; no se pudo verificar Supabase.')}
  }

  function renderAll(){
    applyTutorsToDataset();
    applyAllEditorLayers();
    refreshFilterOptions(); renderImportResults(); renderSources(); renderTutorAdmin(); renderEditor(); applyFilters();
    initChartControls(); initReportPickers(); renderCustomReportConfigurator(); renderReportBuilder();
  }

  function switchView(name){
    document.querySelectorAll('.view').forEach(x=>x.classList.remove('active'));
    document.querySelectorAll('.nav-item').forEach(x=>x.classList.remove('active'));
    $('#view-'+name)?.classList.add('active');
    document.querySelector(`.nav-item[data-view="${name}"]`)?.classList.add('active');
    if(name==='tutors')renderTutorAdmin();
    if(name==='editor')renderEditor();
    if(name==='reports'){
      renderCustomReportConfigurator();
      renderReportBuilder();
      requestAnimationFrame(()=>{renderCustomReportPreview();renderReportPreview()});
    }
  }

  function exportFileStem(){
    const f=currentFilters();
    const action=(f.actions||[]).length ? (f.actions.length<=3?f.actions.join('-'):f.actions.length+'-acciones') : 'todas';
    const date=(f.dates?.length===1?f.dates[0]:'') || new Date().toISOString().slice(0,10);
    return ('Analisis_de_acciones_'+action+'_'+date).replace(/[^A-Za-z0-9_-]+/g,'_');
  }

  function filterSummaryPairs(){
    const f=currentFilters();
    const joined=(arr)=>(arr||[]).join(' · ');
    const pairs=[
      ['Acción',joined(f.actions)],['Escuela',joined(f.schools)],['Dependencia',joined(f.dependencies)],
      ['Sector de gestión',joined(f.sectors)],['Comuna',joined(f.comunas)],['Estado',joined(f.statuses)],
      ['Año',joined(f.years)],['Encuentro',joined(f.encounters)],
      ['Fechas de encuentro',(f.dates||[]).map(formatDate).join(' · ')],['Tutor / capacitador',joined(f.tutors)],
      ['Área',joined(f.areas)],['Sede',joined(f.venues)],['Turno',joined(f.shifts)],['Cargo',joined(f.cargos)],['Es DAR',joined(f.darValues)],
      ['Búsqueda',f.q]
    ];
    return pairs.filter(([,v])=>String(v||'').trim()!=='');
  }
  function updatePrintMeta(){
    if(!$('#printGenerated'))return;
    $('#printGenerated').textContent='Generado: '+new Date().toLocaleString('es-AR');
    const pairs=filterSummaryPairs();
    $('#printFilters').innerHTML=pairs.length
      ? pairs.map(([k,v])=>'<span><b>'+esc(k)+':</b> '+esc(v)+'</span>').join('')
      : '<span>Sin filtros adicionales · todas las acciones cargadas</span>';
  }

  function uniqueFilteredRegistrations(){
    const byId=new Map();
    for(const r of filtered.registrations){
      const key=[r.actionCode,r.commissionCode,idOf(r)].join('|');
      if(key&&!byId.has(key))byId.set(key,r);
    }
    return [...byId.values()];
  }

  function schoolExportRows(){
    const regs=filtered.registrations, atts=filtered.attendance;
    const schools=groupUnique(regs.filter(r=>schoolKey(r)),r=>schoolKey(r)).sort((a,b)=>b.value-a.value);
    const attSchool=new Map(groupUnique(atts.filter(r=>schoolKey(r)),r=>schoolKey(r)).map(x=>[x.label,x.value]));
    const meta=new Map();
    regs.forEach(r=>{const k=schoolKey(r);if(k&&!meta.has(k))meta.set(k,r)});
    return schools.map(s=>{
      const m=meta.get(s.label)||{}, a=attSchool.get(s.label)||0;
      return {
        CUE:m.cue||'',
        ESCUELA:upper(m.school)||'',
        DEPENDENCIA:upper(m.dependency)||'',
        'INSCRIPTOS':s.value,
        'ASISTENTES':a,
        'ASISTENCIA %':rate(a,s.value)
      };
    });
  }

  function absentExportRows(){
    const attIds=new Set(filtered.attendance.map(idOf).filter(Boolean));
    const byId=new Map();
    filtered.registrations.filter(r=>!attIds.has(idOf(r))).forEach(r=>{
      const k=[r.actionCode,r.commissionCode,idOf(r)].join('|');
      if(k&&!byId.has(k))byId.set(k,r);
    });
    return [...byId.values()].map(r=>({
      DNI:cleanDni(r.dni)||'',
      DOCENTE:r.name||r.email||'',
      ACCIÓN:r.actionCode||'',
      COMISIÓN:r.commissionCode||'',
      AÑO:r.dataYear||'',
      UNIVERSO:r.universe||'',
      'ES DAR':r.isDar||'',
      ESCUELA:upper(r.school)||'',
      CUE:r.cue||'',
      CUEANEXO:r.cueAnexo||'',
      DEPENDENCIA:upper(r.dependency)||'',
      'SECTOR DE GESTIÓN':upper(r.sector)||'',
      COMUNA:upper(r.comuna)||'',
      ESTADO:upper(statusNorm(r.status))||'',
      ÁREA:r.area||'',
      'ÁREA CLASIFICADA':r.areaClass||'',
      CARGO:r.cargo||'',
      'CARGO CLASIFICADO':r.cargoClass||'',
      'FECHA INSCRIPCIÓN':formatDate(r.registrationDate)||''
    }));
  }

  function detailExportRows(){
    const attSet=new Set(filtered.attendance.map(idOf).filter(Boolean));
    return uniqueFilteredRegistrations().map(r=>({
      DNI:cleanDni(r.dni)||'',
      DOCENTE:r.name||r.email||'',
      EMAIL:r.email||'',
      ACCIÓN:r.actionCode||'',
      COMISIÓN:r.commissionCode||'',
      AÑO:r.dataYear||'',
      UNIVERSO:r.universe||'',
      'ES DAR':r.isDar||'',
      ESCUELA:upper(r.school)||'',
      CUE:r.cue||'',
      CUEANEXO:r.cueAnexo||'',
      DEPENDENCIA:upper(r.dependency)||'',
      'SECTOR DE GESTIÓN':upper(r.sector)||'',
      COMUNA:upper(r.comuna)||'',
      ESTADO:upper(statusNorm(r.status))||'',
      ÁREA:r.area||'',
      'ÁREA CLASIFICADA':r.areaClass||'',
      CARGO:r.cargo||'',
      'CARGO CLASIFICADO':r.cargoClass||'',
      FORMACIÓN:r.formation||'',
      SEDE:r.venue||'',
      TURNO:r.shift||'',
      TUTOR:r.tutor||'',
      'FECHA INSCRIPCIÓN':formatDate(r.registrationDate)||'',
      ASISTIÓ:attSet.has(idOf(r))?'SI':'NO'
    }));
  }

  function attendanceExportRows(){
    return filtered.attendance.map(r=>({
      DNI:cleanDni(r.dni)||'',
      DOCENTE:r.name||r.email||'',
      EMAIL:r.email||'',
      ACCIÓN:r.actionCode||'',
      COMISIÓN:r.commissionCode||'',
      AÑO:r.dataYear||'',
      UNIVERSO:r.universe||'',
      'ES DAR':r.isDar||'',
      ENCUENTRO:r.encounter||'',
      FECHA:formatDate(r.eventDate)||'',
      ESCUELA:upper(r.school)||'',
      CUE:r.cue||'',
      CUEANEXO:r.cueAnexo||'',
      DEPENDENCIA:upper(r.dependency)||'',
      'SECTOR DE GESTIÓN':upper(r.sector)||'',
      COMUNA:upper(r.comuna)||'',
      ÁREA:r.area||'',
      'ÁREA CLASIFICADA':r.areaClass||'',
      CARGO:r.cargo||'',
      'CARGO CLASIFICADO':r.cargoClass||'',
      SEDE:r.venue||'',
      TURNO:r.shift||'',
      TUTOR:r.tutor||''
    }));
  }

  function bajasExportRows(){
    return (filtered.bajas||[]).map(r=>({
      DNI:cleanDni(r.dni)||'',
      DOCENTE:r.name||r.email||'',
      EMAIL:r.email||'',
      'FECHA BAJA':formatDate(r.bajaDate)||'',
      ACCIÓN:r.actionCode||'',
      COMISIÓN:r.commissionCode||'',
      ESCUELA:upper(r.school)||'',
      CUE:r.cue||'',
      DEPENDENCIA:upper(r.dependency)||'',
      MOTIVO:r.reason||''
    }));
  }

  function commissionExportRows(){
    const baseRows=filtered.registrations.length?filtered.registrations:filtered.attendance;
    const regs=groupUnique(baseRows,r=>r.commissionCode).sort((a,b)=>b.value-a.value);
    const attMap=new Map(groupUnique(filtered.attendance,r=>r.commissionCode).map(x=>[x.label,x.value]));
    const props=new Map(filtered.proposals.map(p=>[p.code,p]));
    return regs.map(x=>{
      const p=props.get(x.label)||{}, a=attMap.get(x.label)||0;
      return {
        COMISIÓN:x.label,
        ÁREA:p.area||'',
        FORMACIÓN:p.formation||'',
        SEDE:p.venue||'',
        TURNO:p.shift||'',
        TUTORES:(p.tutors||[]).join(' · '),
        INSCRIPTOS:x.value,
        ASISTENTES:a,
        'ASISTENCIA %':rate(a,x.value)
      };
    });
  }

  function autoWidth(ws,rows){
    if(!rows.length)return;
    const headers=Object.keys(rows[0]);
    ws['!cols']=headers.map(h=>({
      wch:Math.min(45,Math.max(10,h.length+2,...rows.slice(0,300).map(r=>String(r[h]??'').length+2)))
    }));
    ws['!autofilter']={ref:ws['!ref']};
  }

  function appendJsonSheet(wb,name,rows){
    const safeRows=rows.length?rows:[{INFO:'Sin datos para los filtros actuales'}];
    const ws=XLSX.utils.json_to_sheet(safeRows);
    autoWidth(ws,safeRows);
    XLSX.utils.book_append_sheet(wb,ws,name.slice(0,31));
  }

  function exportExcel(){
    const regs=filtered.registrations, atts=filtered.attendance;
    if(!regs.length && !atts.length)return;

    const regIds=new Set(regs.map(idOf).filter(Boolean));
    const attIds=new Set(atts.map(idOf).filter(Boolean));
    const metrics=eventMetrics(regs,atts);
    const filters=filterSummaryPairs();
    const selectedDates=currentFilters().dates||[];
    const selectedMetrics=selectedDates.length?metrics.filter(x=>selectedDates.includes(x.date)):metrics;
    const currentMetric=selectedMetrics.length===1?selectedMetrics[0]:(selectedMetrics.at(-1)||null);

    const summary=[
      {INDICADOR:'Generado',VALOR:new Date().toLocaleString('es-AR')},
      ...(selectedAction()?[
        {INDICADOR:'Estado de la acción',VALOR:selectedAction().status==='finalizada'?'FINALIZADA':'ACTIVA'},
        {INDICADOR:'Fecha de finalización',VALOR:selectedAction().finalizedAt?new Date(selectedAction().finalizedAt).toLocaleString('es-AR'):''}
      ]:[]),
      ...filters.map(([k,v])=>({INDICADOR:'Filtro · '+k,VALOR:v})),
      {INDICADOR:'Docentes inscriptos',VALOR:regIds.size},
      {INDICADOR:'Docentes asistentes',VALOR:attIds.size},
      {INDICADOR:'Asistencia %',VALOR:regIds.size?rate(attIds.size,regIds.size):''},
      {INDICADOR:'Presentismo %',VALOR:currentMetric?.presentism??''},
      {INDICADOR:'Escuelas representadas',VALOR:unique((regs.length?regs:atts).map(schoolKey).filter(Boolean)).length},
      {INDICADOR:'Escuelas participantes',VALOR:unique(atts.map(schoolKey).filter(Boolean)).length},
      {INDICADOR:'Bajas cruzadas',VALOR:(filtered.bajas||[]).length},
      {INDICADOR:'Comisiones',VALOR:unique((regs.length?regs:atts).map(x=>x.commissionCode)).length},
      {INDICADOR:'Registros de asistencia',VALOR:atts.length}
    ];

    const wb=XLSX.utils.book_new();
    appendJsonSheet(wb,'Resumen',summary);
    appendJsonSheet(wb,'Por fecha',metrics.map(x=>({
      ENCUENTRO:x.encounter||'',
      FECHA:formatDate(x.date),
      AÑO:x.dataYear||'',
      UNIVERSO:x.universe||'',
      BASE:x.baseKind==='observed'?'Participantes observados':x.baseKind==='universe'?'Universo '+x.universe:x.baseKind==='year'?'Año '+x.dataYear:'Activos',
      ACTIVOS:x.active,
      ASISTENTES:x.attendees,
      'PRESENTISMO %':x.presentism
    })));
    appendJsonSheet(wb,'Comisiones',commissionExportRows());
    appendJsonSheet(wb,'Por área',(()=>{
      const rs=groupUnique(regs,r=>r.area||'Sin área').sort((a,b)=>b.value-a.value);
      const am=new Map(groupUnique(atts,r=>r.area||'Sin área').map(x=>[x.label,x.value]));
      return rs.map(x=>({ÁREA:x.label,INSCRIPTOS:x.value,ASISTENTES:am.get(x.label)||0,'ASISTENCIA %':rate(am.get(x.label)||0,x.value)}));
    })());
    appendJsonSheet(wb,'Por cargo',(()=>{
      const cr=groupUnique(regs.filter(r=>r.cargoClass||r.cargo),r=>r.cargoClass||classifyCargo(r.cargo)||r.cargo).sort((a,b)=>b.value-a.value);
      return cr.map(x=>({CARGO:x.label,DOCENTES:x.value}));
    })());
    appendJsonSheet(wb,'Escuelas',schoolExportRows());
    appendJsonSheet(wb,'Ausentes',absentExportRows());
    appendJsonSheet(wb,'Detalle',detailExportRows());
    appendJsonSheet(wb,'Asistencias',attendanceExportRows());
    appendJsonSheet(wb,'Bajas',bajasExportRows());

    XLSX.writeFile(wb,exportFileStem()+'.xlsx',{compression:true});
    toast('Excel exportado con los filtros actuales');
  }

  function printDashboard(){
    if(!filtered.registrations.length && !filtered.attendance.length)return;
    switchView('reports');
    renderReportBuilder();
    renderReportPreview();
  }

  function exportCsv(){
    const rows=detailExportRows();
    if(!rows.length)return;
    const ws=XLSX.utils.json_to_sheet(rows);
    const csv=XLSX.utils.sheet_to_csv(ws);
    const blob=new Blob(['\ufeff'+csv],{type:'text/csv;charset=utf-8'});
    const url=URL.createObjectURL(blob);
    const a=document.createElement('a');
    a.href=url;
    a.download=exportFileStem()+'_detalle.csv';
    a.click();
    URL.revokeObjectURL(url);
  }

  let filterApplyTimer=null;
  function scheduleApplyFilters(delay=220){
    clearTimeout(filterApplyTimer);
    filterApplyTimer=setTimeout(()=>applyFilters(),delay);
  }

  function bind(){
    $$('.nav-item').forEach(b=>b.addEventListener('click',()=>switchView(b.dataset.view)));
    $('#pickFiles').addEventListener('click',()=>{
      const input=$('#fileInput');
      if(!input)return;
      input.value='';
      input.click();
    });
    $('#fileInput').addEventListener('change',e=>handleFiles([...e.target.files]));
    const dz=$('#dropzone');
    ['dragenter','dragover'].forEach(ev=>dz.addEventListener(ev,e=>{e.preventDefault();dz.classList.add('drag')}));
    ['dragleave','drop'].forEach(ev=>dz.addEventListener(ev,e=>{e.preventDefault();dz.classList.remove('drag')}));
    dz.addEventListener('drop',e=>handleFiles([...e.dataTransfer.files]));
    document.addEventListener('change',e=>{
      const checkbox=e.target.closest?.('.multi-filter-options input[type="checkbox"]');
      if(!checkbox)return;
      const details=checkbox.closest('[data-multi-filter]');
      const id=details?.dataset.multiFilter;
      if(!id)return;
      const set=multiFilterState[id]||(multiFilterState[id]=new Set());
      if(checkbox.checked)set.add(checkbox.value);else set.delete(checkbox.value);
      updateMultiFilterSummary(id);
      if(id==='filterAction'){syncActionFilterInput();refreshFilterOptions()}
      applyFilters();
    });
    document.addEventListener('input',e=>{
      const search=e.target.closest?.('.multi-filter-search');
      if(!search)return;
      const details=search.closest('[data-multi-filter]');
      const q=normalize(search.value);
      details?.querySelectorAll('.multi-filter-option').forEach(opt=>{
        opt.hidden=!!q&&!normalize(opt.textContent).includes(q);
      });
    });
    document.addEventListener('click',e=>{
      const all=e.target.closest?.('[data-multi-all]');
      const clear=e.target.closest?.('[data-multi-clear]');
      if(!all&&!clear)return;
      e.preventDefault();
      const details=e.target.closest('[data-multi-filter]');
      const id=details?.dataset.multiFilter;if(!id)return;
      const set=multiFilterState[id]||(multiFilterState[id]=new Set());
      details.querySelectorAll('.multi-filter-options input[type="checkbox"]').forEach(cb=>{
        cb.checked=!!all;
        if(all)set.add(cb.value);else set.delete(cb.value);
      });
      updateMultiFilterSummary(id);
      if(id==='filterAction'){syncActionFilterInput();refreshFilterOptions()}
      applyFilters();
    });
    $('#filterDate').addEventListener('change',applyFilters);
    $('#filterDateManual').addEventListener('input',()=>scheduleApplyFilters());
    $('#filterAction').addEventListener('input',()=>{
      const el=$('#filterAction');
      const raw=el.value.trim();
      const canonical=actionCodeValue(raw);
      const exists=canonical&&dataset.actions.some(x=>x.code===canonical);
      if(!raw){
        refreshFilterOptions();applyFilters();return;
      }
      if(exists){
        if(el.value!==canonical)el.value=canonical;
        refreshFilterOptions();applyFilters();
      }else{
        
      }
    });
    $('#filterAction').addEventListener('change',()=>{
      const el=$('#filterAction');
      const canonical=actionCodeValue(el.value);
      if(canonical&&dataset.actions.some(x=>x.code===canonical))el.value=canonical;
      refreshFilterOptions();applyFilters();
    });
    $('#globalSearch').addEventListener('input',()=>scheduleApplyFilters());
    $('#detailSearch').addEventListener('input',()=>{clearTimeout(renderDetail.t);renderDetail.t=setTimeout(renderDetail,180)});
    $('#clearFilters').addEventListener('click',()=>{
      clearAllMultiFilters();
      syncActionFilterInput();
      setSelectedValues($('#filterDate'),[]);
      $('#filterDateManual').value='';
      $('#globalSearch').value='';
      refreshFilterOptions();
      applyFilters();
    });
    $('#printBtn').addEventListener('click',()=>{
      switchView('reports');
      renderReportBuilder();
      requestAnimationFrame(()=>renderReportPreview());
    });
    document.addEventListener('change',e=>{
      const select=e.target.closest?.('[data-chart-type]');
      if(select)setChartType(select.dataset.chartType,select.value);
    });
    document.addEventListener('click',e=>{
      const add=e.target.closest?.('[data-add-report]');
      if(add){addReportItem(add.dataset.addReport);return}
      const print=e.target.closest?.('[data-print-chart]');
      if(print){printSingleChart(print.dataset.printChart);return}
      const remove=e.target.closest?.('[data-report-remove]');
      if(remove){removeReportItem(remove.dataset.reportRemove);return}
      const move=e.target.closest?.('[data-report-move]');
      if(move){moveReportItem(move.dataset.reportMove,Number(move.dataset.delta));return}
    });
    ['reportDocTitle','reportDocSubtitle','reportDocNotes'].forEach(id=>$('#'+id)?.addEventListener('input',()=>{captureReportInputs()}));
    $('#reportIncludeFilters')?.addEventListener('change',()=>{captureReportInputs();renderReportPreview()});
    $('#reportAddAllCharts')?.addEventListener('click',()=>{
      Object.keys(CHART_META).forEach(id=>addReportItem('chart:'+id,{quiet:true}));
      renderReportBuilder();renderReportPreview();toast('Todos los gráficos fueron agregados.');
    });
    $('#reportClear')?.addEventListener('click',()=>{
      reportDraft.items=[];saveReportDraft();renderReportBuilder();renderReportPreview();
    });
    $('#reportPreview')?.addEventListener('click',renderReportPreview);
    $('#reportPrint')?.addEventListener('click',()=>printReport());
    $('#customReportDataset')?.addEventListener('change',()=>{customReportColumns=[];renderCustomReportConfigurator();renderCustomReportPreview()});
    $('#customReportGroupBy')?.addEventListener('change',renderCustomReportPreview);
    $('#customReportSearch')?.addEventListener('input',()=>{clearTimeout(renderCustomReportPreview.t);renderCustomReportPreview.t=setTimeout(()=>{renderCustomReportConfigurator();renderCustomReportPreview()},180)});
    $('#customReportColumns')?.addEventListener('change',e=>{
      if(e.target.matches('input[type="checkbox"]')){
        customReportColumns=[...$('#customReportColumns').querySelectorAll('input:checked')].map(x=>x.value);
        renderCustomReportPreview();
      }
    });
    $('#customReportTitle')?.addEventListener('input',()=>{renderReportBuilder();if(reportDraft.items.includes('custom:table'))renderReportPreview()});
    $('#customReportPreviewBtn')?.addEventListener('click',renderCustomReportPreview);
    $('#customReportAddBtn')?.addEventListener('click',()=>{renderCustomReportPreview();addReportItem('custom:table')});
    $('#customReportExcelBtn')?.addEventListener('click',exportFilteredCustomReportExcel);
    $('#customReportCsvBtn')?.addEventListener('click',exportFilteredCustomReportCsv);
    $('#excelBtn').addEventListener('click',exportExcel);
    $('#exportBtn').addEventListener('click',exportCsv);
    window.addEventListener('beforeprint',updatePrintMeta);
    $('#resetBtn').addEventListener('click',async()=>{
      if(confirm('¿Limpiar solamente los datos de este navegador? Los datos guardados en Supabase NO se eliminan.')){
        await clearState();
        toast('Copia local limpiada. Podés recargar desde Supabase.');
        if(remoteReady) await initRemotePersistence();
      }
    });
    $('#storageStatusBtn')?.addEventListener('click',async()=>{
      const btn=$('#storageStatusBtn');
      if(btn?.disabled)return;
      if(btn)btn.disabled=true;
      try{
        const ok=await initRemotePersistence();
        renderAll();
        if(ok)toast('Supabase sincronizado y verificado.');
      }finally{
        if(btn)btn.disabled=false;
      }
    });
    $('#storageKeyForm')?.addEventListener('submit',e=>{
      e.preventDefault();
      closeStorageModal($('#storageKeyInput').value);
    });
    $('#storageKeyCancel')?.addEventListener('click',()=>closeStorageModal(''));
    $('#toggleActionStatusBtn')?.addEventListener('click',()=>toggleActionStatus());
    $('#importResults')?.addEventListener('click',e=>{
      const btn=e.target.closest('[data-toggle-action-status]');
      if(btn)toggleActionStatus(btn.dataset.toggleActionStatus);
    });
    $('#sourceForm')?.addEventListener('submit',saveSourceFromForm);
    $('#sourceAction')?.addEventListener('input',e=>{e.target.value=e.target.value.toUpperCase().replace(/[^C0-9 _-]/g,'').slice(0,8)});
    $('#sourceAction')?.addEventListener('change',e=>{const c=actionCodeValue(e.target.value);if(c)e.target.value=c});
    $('#manualTutorForm')?.addEventListener('submit',addManualTutor);
    $('#manualTutorAssignmentForm')?.addEventListener('submit',assignManualTutors);
    $('#manualTutorAction')?.addEventListener('change',renderManualTutorCommissionOptions);
    $('#manualTutorCatalogTable')?.addEventListener('click',e=>{
      const btn=e.target.closest('[data-remove-manual-tutor]');
      if(btn)removeManualTutor(btn.dataset.removeManualTutor);
    });
    $('#manualTutorAssignmentsTable')?.addEventListener('click',e=>{
      const btn=e.target.closest('[data-remove-tutor-assignment]');
      if(btn)removeManualTutorAssignment(btn.dataset.removeTutorAssignment);
    });
    $('#editorAction')?.addEventListener('change',renderEditor);
    $('#editorDataset')?.addEventListener('change',renderEditor);
    $('#editorSearch')?.addEventListener('input',()=>{clearTimeout(renderEditor.t);renderEditor.t=setTimeout(renderEditor,160)});
    $('#editorTableBody')?.addEventListener('click',e=>{
      const btn=e.target.closest('[data-edit-record]');
      if(!btn)return;
      const row=rowByEditorKey(editorType(),editorActionCode(),btn.dataset.editRecord);
      if(row)openRecordModal(row);
    });
    $('#editorRecordForm')?.addEventListener('submit',saveEditorRecord);
    $('#editorDeleteRecord')?.addEventListener('click',deleteEditorRecord);
    $('#editorRestoreRecord')?.addEventListener('click',restoreEditorRecord);
    $('#editorRecordClose')?.addEventListener('click',closeRecordModal);
    $('#editorRecordCancel')?.addEventListener('click',closeRecordModal);
    $('#editorRecordModal')?.addEventListener('click',e=>{if(e.target===$('#editorRecordModal'))closeRecordModal()});
  }

  async function init(){
    initMultiFilterWidgets();
    syncActionFilterInput();
    bind();
    await loadState();
    renderAll();
    const loaded=await initRemotePersistence();
    ensureTutorCourseSource();
    await saveState();
    renderAll();
    if(loaded)startSourceAutoSync();
    if(!dataset.actions.length) switchView('imports');
  }
  init();
})();