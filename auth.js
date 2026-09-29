(() => {
  const CONFIG = {
    supabaseUrl: 'https://qchnawvoensqnynsuhfu.supabase.co',
    publishableKey: 'sb_publishable_Df2_KJEhi8vRsVuqbBjRbg_iLQMtbIw',
    appUrl: 'https://sebastiangiampani-create.github.io/analizador_copes/',
    sheetsScope: 'https://www.googleapis.com/auth/spreadsheets.readonly'
  };

  let client = null;
  let session = null;
  let googleToken = sessionStorage.getItem('copes_google_provider_token') || '';
  let initPromise = null;

  const $ = (s) => document.querySelector(s);
  const normalize = (v='') => String(v ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();

  function authMessage(message='', tone=''){
    const el=$('#authStatus');
    if(!el)return;
    el.textContent=message;
    el.dataset.tone=tone;
  }

  function rememberProviderToken(nextSession){
    if(nextSession?.provider_token){
      googleToken=nextSession.provider_token;
      sessionStorage.setItem('copes_google_provider_token',googleToken);
    }
  }

  function clearProviderToken(){
    googleToken='';
    sessionStorage.removeItem('copes_google_provider_token');
  }

  function updateUi(message=''){
    const gate=$('#authGate');
    const userBox=$('#userSession');
    const email=session?.user?.email || '';
    const meta=session?.user?.user_metadata || {};
    if(session){
      document.body.classList.remove('auth-locked');
      if(gate)gate.hidden=true;
      if(userBox)userBox.hidden=false;
      if($('#userName'))$('#userName').textContent=meta.full_name || meta.name || email.split('@')[0] || 'Usuario';
      if($('#userEmail'))$('#userEmail').textContent=email;
      if($('#userAvatar')){
        const src=meta.avatar_url || meta.picture || '';
        $('#userAvatar').src=src;
        $('#userAvatar').hidden=!src;
      }
      if($('#googleAccessState'))$('#googleAccessState').textContent=googleToken ? 'Sheets conectado' : 'Reconectar Sheets';
      if(message) authMessage(message,'ok');
    }else{
      document.body.classList.add('auth-locked');
      if(gate)gate.hidden=false;
      if(userBox)userBox.hidden=true;
      if(message)authMessage(message,'error');
    }
  }

  async function googleProviderEnabled(){
    try{
      const res=await fetch(CONFIG.supabaseUrl+'/auth/v1/settings',{
        headers:{apikey:CONFIG.publishableKey},
        cache:'no-store'
      });
      const data=await res.json();
      return !!data?.external?.google;
    }catch(e){
      console.warn('No pude verificar Google Auth',e);
      return false;
    }
  }

  async function signIn(){
    if(!client) await init();
    const enabled=await googleProviderEnabled();
    if(!enabled){
      authMessage('Falta activar Google en Supabase. Configurá Client ID y Client Secret en Authentication → Providers → Google.','error');
      const help=$('#googleSetupHelp');
      if(help) help.hidden=false;
      return;
    }
    authMessage('Abriendo Google…');
    const {error}=await client.auth.signInWithOAuth({
      provider:'google',
      options:{
        redirectTo:CONFIG.appUrl,
        scopes:`openid email profile ${CONFIG.sheetsScope}`,
        queryParams:{
          access_type:'offline',
          prompt:'consent',
          include_granted_scopes:'true'
        }
      }
    });
    if(error){
      console.error(error);
      authMessage('No se pudo iniciar Google. Falta habilitar el proveedor OAuth en Supabase/Google Cloud.','error');
    }
  }

  async function signOut(){
    if(!client)return;
    clearProviderToken();
    await client.auth.signOut({scope:'local'});
    session=null;
    updateUi('Sesión cerrada.');
  }

  async function init(){
    if(initPromise)return initPromise;
    initPromise=(async()=>{
      if(!globalThis.supabase?.createClient){
        updateUi('No se pudo cargar el cliente de Supabase.');
        return null;
      }
      client=globalThis.supabase.createClient(CONFIG.supabaseUrl,CONFIG.publishableKey,{
        auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}
      });

      client.auth.onAuthStateChange((_event,nextSession)=>{
        session=nextSession;
        if(nextSession)rememberProviderToken(nextSession); else clearProviderToken();
        updateUi();
      });

      const {data,error}=await client.auth.getSession();
      if(error)console.error(error);
      session=data?.session || null;
      rememberProviderToken(session);

      if(location.hash && /access_token|refresh_token|error/.test(location.hash)){
        history.replaceState({},document.title,CONFIG.appUrl);
      }

      $('#googleLoginBtn')?.addEventListener('click',signIn);
      $('#logoutBtn')?.addEventListener('click',signOut);
      $('#reconnectGoogleBtn')?.addEventListener('click',signIn);

      const enabled=await googleProviderEnabled();
      const help=$('#googleSetupHelp');
      if(help) help.hidden=enabled;
      if(!enabled && !session) authMessage('Falta activar Google en Supabase.','error');
      updateUi();
      return session;
    })();
    return initPromise;
  }

  function isSignedIn(){ return !!session; }
  function hasGoogleToken(){ return !!googleToken; }
  function getSession(){ return session; }

  function spreadsheetIdFromUrl(url=''){
    return String(url).match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/)?.[1] || '';
  }

  function gidFromUrl(url=''){
    return String(url).match(/[?#&]gid=(\d+)/)?.[1] || '';
  }

  function kindFromTitle(title=''){
    const n=normalize(title);
    if(n.includes('propuesta'))return 'Propuestas';
    if(n.includes('inscrip'))return 'Inscripciones';
    if(n.includes('asisten'))return 'Asistencias';
    return '';
  }

  function kindFromRows(rows=[]){
    if(!rows.length)return '';
    const headers=(rows[0]||[]).map(normalize).join(' | ');
    if(headers.includes('cupo') && (headers.includes('capacitador') || headers.includes('formacion'))) return 'Propuestas';
    if(headers.includes('dni') && (headers.includes('encuentro') || headers.includes('presente') || headers.includes('asistencia'))) return 'Asistencias';
    if(headers.includes('dni') && (headers.includes('escuela') || headers.includes('establecimiento') || headers.includes('correo'))) return 'Inscripciones';
    return '';
  }

  async function googleJson(url){
    if(!session)throw new Error('Ingresá con Google para sincronizar.');
    if(!googleToken)throw new Error('Reconectá Google para autorizar la lectura de Sheets.');

    const res=await fetch(url,{
      headers:{Authorization:'Bearer '+googleToken},
      cache:'no-store'
    });

    let payload=null;
    try{payload=await res.json()}catch(_){payload=null}

    if(!res.ok){
      const msg=payload?.error?.message || ('Google respondió HTTP '+res.status);
      if(res.status===401){
        clearProviderToken();
        updateUi();
        throw new Error('El permiso de Google venció. Tocá “Reconectar Google”.');
      }
      if(res.status===403){
        throw new Error('Google rechazó el acceso a la Sheet. Verificá que tu cuenta tenga permiso y que Google Sheets API esté habilitada. '+msg);
      }
      throw new Error(msg);
    }
    return payload;
  }

  async function getSheetValues(spreadsheetId,title,range='A1:ZZ30000'){
    const safeTitle=String(title).replace(/'/g,"''");
    const a1=`'${safeTitle}'!${range}`;
    const url='https://sheets.googleapis.com/v4/spreadsheets/'+encodeURIComponent(spreadsheetId)+'/values/'+encodeURIComponent(a1)
      +'?majorDimension=ROWS&valueRenderOption=FORMATTED_VALUE&dateTimeRenderOption=FORMATTED_STRING';
    const data=await googleJson(url);
    return data.values || [];
  }

  async function workbookFromGoogleSheet(url){
    if(!globalThis.XLSX)throw new Error('El lector de planillas todavía no cargó.');
    const spreadsheetId=spreadsheetIdFromUrl(url);
    if(!spreadsheetId)throw new Error('El link no parece ser una Google Sheet válida.');

    const meta=await googleJson(
      'https://sheets.googleapis.com/v4/spreadsheets/'+encodeURIComponent(spreadsheetId)
      +'?fields=properties.title,sheets.properties(sheetId,title,index,gridProperties)'
    );

    const sheets=(meta.sheets||[]).map(x=>x.properties).sort((a,b)=>(a.index||0)-(b.index||0));
    if(!sheets.length)throw new Error('La Google Sheet no contiene pestañas.');

    const wb=XLSX.utils.book_new();
    const usedKinds=new Set();
    const discovered=[];
    const linkGid=gidFromUrl(url);

    for(const props of sheets.slice(0,24)){
      let kind=kindFromTitle(props.title);
      let preview=null;
      if(!kind){
        try{
          preview=await getSheetValues(spreadsheetId,props.title,'A1:AZ8');
          kind=kindFromRows(preview);
        }catch(e){
          console.warn('No pude inspeccionar '+props.title,e);
        }
      }
      if(!kind || usedKinds.has(kind))continue;

      const rows=preview && preview.length>8 ? preview : await getSheetValues(spreadsheetId,props.title);
      if(!rows.length)continue;
      XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(rows),kind);
      usedKinds.add(kind);
      discovered.push({kind,title:props.title,rows:Math.max(0,rows.length-1)});
    }

    if(!usedKinds.size && linkGid){
      const props=sheets.find(x=>String(x.sheetId)===String(linkGid));
      if(props){
        const rows=await getSheetValues(spreadsheetId,props.title);
        const kind=kindFromTitle(props.title) || kindFromRows(rows);
        if(kind && rows.length){
          XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(rows),kind);
          usedKinds.add(kind);
          discovered.push({kind,title:props.title,rows:Math.max(0,rows.length-1)});
        }
      }
    }

    if(!usedKinds.size){
      throw new Error('No pude identificar pestañas de Propuestas, Inscripciones o Asistencias en esta Sheet.');
    }

    return {workbook:wb,spreadsheetId,title:meta.properties?.title||'',discovered};
  }

  globalThis.COPES_AUTH={
    init,signIn,signOut,isSignedIn,hasGoogleToken,getSession,
    workbookFromGoogleSheet,
    reconnectGoogle:signIn,
    get client(){return client}
  };
})();