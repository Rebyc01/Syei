const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
let currentUser = null, chatHistory = [], authMode = 'login', toastTimer;
const escapeHtml = (s='') => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function toast(message) { const el=$('#toast'); el.textContent=message; el.classList.add('show'); clearTimeout(toastTimer); toastTimer=setTimeout(()=>el.classList.remove('show'),3000); }
async function api(url, options={}) {
  const res = await fetch(url, { credentials:'same-origin', ...options, headers:{ ...(options.body ? {'Content-Type':'application/json'} : {}), ...(options.headers||{}) } });
  const type = res.headers.get('content-type')||'';
  const data = type.includes('application/json') ? await res.json() : await res.text();
  if (!res.ok) throw new Error(data.error || data || `Request failed (${res.status})`);
  return data;
}
function go(page) {
  $$('.page').forEach(p=>p.classList.toggle('active',p.id===`page-${page}`));
  $$('.nav-item').forEach(b=>b.classList.toggle('active',b.dataset.page===page));
  $('#crumb').textContent=({discover:'Discover',ai:'SYEI AI',movies:'Movies & Kannywood',search:'Search & downloads',builder:'AI Code Builder',saved:'Saved items'})[page]||page;
  if(page==='movies') loadMovies(); if(page==='saved') loadSaves();
  if(page==='ai' && !currentUser) toast('Sign in to use SYEI AI.');
  window.scrollTo({top:0,behavior:'smooth'});
}
$$('[data-page]').forEach(b=>b.addEventListener('click',()=>go(b.dataset.page)));
$$('[data-search]').forEach(b=>b.addEventListener('click',()=>{ $('#discover-query').value=b.dataset.search; loadDiscover(b.dataset.search); }));
function authUi() {
  $('#account-pill').textContent=currentUser ? currentUser.email : 'Guest mode';
  $('#avatar').textContent=currentUser ? currentUser.email.slice(0,1).toUpperCase() : 'S';
  $('#auth-open').textContent=currentUser ? 'Sign out' : 'Sign in / Create account';
  $('#status-text').textContent=currentUser ? 'Signed in · workspace active' : 'Public discovery active';
}
async function boot() {
  try {
    const [me, health] = await Promise.all([api('/api/me'),api('/api/health')]);
    currentUser=me.user; authUi();
    $('#status-text').textContent=health.aiConfigured ? 'AI connected · archives ready' : 'Add AI key to enable AI';
    await loadDiscover('african architecture');
  } catch(e) { $('#status-text').textContent='Server connection issue'; toast(e.message); }
}
$('#auth-open').addEventListener('click', async()=>{
  if(currentUser){ try{await api('/api/auth/logout',{method:'POST'});currentUser=null;chatHistory=[];authUi();toast('Signed out.');}catch(e){toast(e.message)} }
  else { authMode='login'; updateAuthDialog(); $('#auth-dialog').showModal(); }
});
$('#avatar').addEventListener('click',()=> currentUser ? toast(currentUser.email) : (authMode='login',updateAuthDialog(),$('#auth-dialog').showModal()));
$('#auth-close').addEventListener('click',()=>$('#auth-dialog').close());
$('#auth-switch').addEventListener('click',()=>{authMode=authMode==='login'?'register':'login';updateAuthDialog();});
function updateAuthDialog(){ $('#auth-title').textContent=authMode==='login'?'Welcome back.':'Create your workspace.'; $('#auth-submit').textContent=authMode==='login'?'Sign in':'Create account'; $('#auth-switch').textContent=authMode==='login'?'Create account instead':'I already have an account'; $('#auth-password').autocomplete=authMode==='login'?'current-password':'new-password'; $('#auth-error').textContent='';}
$('#auth-form').addEventListener('submit',async e=>{
  e.preventDefault(); $('#auth-error').textContent='';
  try{ const data=await api(`/api/auth/${authMode}`,{method:'POST',body:JSON.stringify({email:$('#auth-email').value,password:$('#auth-password').value})}); currentUser=data.user;authUi();$('#auth-dialog').close();toast(authMode==='login'?'Signed in.':'Account created.');if($('#page-saved').classList.contains('active'))loadSaves(); }
  catch(err){$('#auth-error').textContent=err.message;}
});
function pinCard(item) {
  return `<article class="pin-card"><a href="${escapeHtml(item.pageUrl||item.url||'#')}" target="_blank" rel="noopener noreferrer"><img loading="lazy" src="${escapeHtml(item.image||'')}" alt="${escapeHtml(item.title)}" onerror="this.style.display='none'"></a><div class="pin-body"><div class="pin-title">${escapeHtml(item.title)}</div><div class="pin-meta">${escapeHtml(item.credit||item.source||'Source details')}</div><div class="pin-actions"><button class="small-btn" data-save='${escapeHtml(JSON.stringify({id:item.id,title:item.title,image:item.image,url:item.pageUrl||item.url,type:'discovery',source:item.source||'Wikimedia Commons'}))}'>♡ Save</button><a class="small-btn" href="${escapeHtml(item.pageUrl||item.url||'#')}" target="_blank" rel="noopener noreferrer">Source ↗</a></div></div></article>`;
}
async function loadDiscover(q='african architecture') {
  $('#discover-grid').innerHTML='<div class="loading">Finding inspiration…</div>';
  try {const data=await api(`/api/discover?q=${encodeURIComponent(q)}`); $('#discover-grid').innerHTML=data.items.length?data.items.map(pinCard).join(''):'<div class="empty-state">No images found. Try another search.</div>';wireSaveButtons();}
  catch(e){$('#discover-grid').innerHTML=`<div class="empty-state">${escapeHtml(e.message)}. Check your internet connection.</div>`;}
}
$('#discover-form').addEventListener('submit',e=>{e.preventDefault();loadDiscover($('#discover-query').value.trim()||'design');});
async function wireSaveButtons(){
  $$('[data-save]').forEach(btn=>btn.addEventListener('click',async()=>{
    try {if(!currentUser){authMode='login';updateAuthDialog();$('#auth-dialog').showModal();return;} await api('/api/saves',{method:'POST',body:btn.dataset.save});toast('Saved to your collection.');btn.textContent='✓ Saved';}
    catch(e){toast(e.message);}
  }));
}
async function loadMovies(){
  const q=$('#movie-query').value||'', category=$('#movie-category').value||'';
  $('#movies-grid').innerHTML='<div class="loading">Loading authorized titles…</div>';
  try{
    const data=await api(`/api/movies?q=${encodeURIComponent(q)}&category=${encodeURIComponent(category)}`);
    const select=$('#movie-category');const previous=select.value;
    select.innerHTML='<option value="">All categories</option>'+data.categories.map(c=>`<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
    if(data.categories.includes(previous))select.value=previous;
    $('#movies-grid').innerHTML=data.items.length?data.items.map(m=>`<article class="movie-card"><img loading="lazy" src="${escapeHtml(m.poster||'')}" alt="${escapeHtml(m.title)}" onerror="this.style.display='none'"><div class="movie-info"><small>${escapeHtml(m.category)} ${m.year?'· '+m.year:''} ${m.language?'· '+escapeHtml(m.language):''}</small><h3>${escapeHtml(m.title)}</h3><p>${escapeHtml(m.description)}</p><div class="movie-links">${m.watchUrl?`<a class="small-btn" href="${escapeHtml(m.watchUrl)}" target="_blank" rel="noopener noreferrer">Watch ↗</a>`:''}${m.downloadUrl?`<a class="small-btn" href="${escapeHtml(m.downloadUrl)}" target="_blank" rel="noopener noreferrer">Download ↗</a>`:''}</div></div></article>`).join(''):'<div class="empty-state">No titles yet. Add films you are licensed to distribute in data/movies.json.</div>';
  }catch(e){$('#movies-grid').innerHTML=`<div class="empty-state">${escapeHtml(e.message)}</div>`;}
}
$('#movie-query').addEventListener('input',debounce(loadMovies,350));$('#movie-category').addEventListener('change',loadMovies);
$('#media-form').addEventListener('submit',async e=>{
  e.preventDefault();const q=$('#media-query').value.trim();if(!q)return;
  $('#media-results').innerHTML='<div class="loading">Searching public archives…</div>';
  try{
    const data=await api(`/api/media/search?q=${encodeURIComponent(q)}`);
    $('#media-results').innerHTML=data.items.length?data.items.map(item=>`<article class="result-card"><div class="result-icon">${item.mediaType==='movies'?'▶':item.mediaType==='audio'?'♫':'⌁'}</div><div class="result-content"><h3>${escapeHtml(item.title)}</h3><p>${escapeHtml(item.description||'No description supplied by source.')}</p><small>${escapeHtml(item.source)} · ${escapeHtml(item.mediaType)} ${item.year?'· '+escapeHtml(item.year):''} ${item.creator?'· '+escapeHtml(item.creator):''}</small></div><div class="result-actions"><a class="small-btn" href="${escapeHtml(item.sourceUrl)}" target="_blank" rel="noopener noreferrer">Open item ↗</a><a class="small-btn" href="${escapeHtml(item.downloadUrl)}" target="_blank" rel="noopener noreferrer">Browse files / download ↗</a><button class="small-btn" data-media-save='${escapeHtml(JSON.stringify({id:item.id,title:item.title,url:item.sourceUrl,type:'archive',source:item.source}))}'>♡ Save</button></div></article>`).join(''):'<div class="empty-state">No results. Try broader search terms.</div>';
    $$('[data-media-save]').forEach(b=>b.addEventListener('click',async()=>{try{if(!currentUser){authMode='login';updateAuthDialog();$('#auth-dialog').showModal();return;}await api('/api/saves',{method:'POST',body:b.dataset.mediaSave});toast('Saved.');}catch(e){toast(e.message)}}));
  }catch(err){$('#media-results').innerHTML=`<div class="empty-state">${escapeHtml(err.message)}</div>`;}
});
function debounce(fn,delay){let timer;return(...args)=>{clearTimeout(timer);timer=setTimeout(()=>fn(...args),delay)};}
$('#chat-form').addEventListener('submit',async e=>{
  e.preventDefault();const text=$('#chat-input').value.trim();if(!text)return;
  if(!currentUser){authMode='login';updateAuthDialog();$('#auth-dialog').showModal();return;}
  chatHistory.push({role:'user',content:text});renderChat();$('#chat-input').value='';const send=$('#chat-form button');send.disabled=true;send.textContent='Thinking…';
  try{const data=await api('/api/ai/chat',{method:'POST',body:JSON.stringify({messages:chatHistory.slice(-20)})});chatHistory.push({role:'assistant',content:data.answer});renderChat();}
  catch(err){chatHistory.pop();toast(err.message);renderChat();}
  finally{send.disabled=false;send.textContent='Send ↗';}
});
function renderChat(){
  const log=$('#chat-log');
  log.innerHTML=chatHistory.length?chatHistory.map(m=>`<div class="chat-message ${m.role}">${m.role==='assistant'?'<div class="speaker">✳ SYEI AI</div>':''}${escapeHtml(m.content)}</div>`).join(''):`<div class="welcome-message"><div class="ai-icon">✳</div><h2>What can we figure out together?</h2><p>Ask a question, plan a project, or explore something new.</p><div class="prompt-chips"><button>Help me plan a small business website</button><button>Explain APIs in simple terms</button><button>Give me 5 creative project ideas</button></div></div>`;
  log.scrollTop=log.scrollHeight;
  $$('.prompt-chips button').forEach(b=>b.addEventListener('click',()=>{$('#chat-input').value=b.textContent;$('#chat-input').focus();}));
}
$$('.prompt-chips button').forEach(b=>b.addEventListener('click',()=>{$('#chat-input').value=b.textContent;$('#chat-input').focus();}));
$('#build-button').addEventListener('click',async()=>{
  const prompt=$('#builder-prompt').value.trim();if(prompt.length<10){toast('Describe your project in a little more detail.');return;}
  if(!currentUser){authMode='login';updateAuthDialog();$('#auth-dialog').showModal();return;}
  const btn=$('#build-button');btn.disabled=true;btn.textContent='Generating…';$('#builder-output').classList.remove('hidden');$('#code-output').textContent='Generating your project with the configured AI model…';
  try{const data=await api('/api/ai/build',{method:'POST',body:JSON.stringify({prompt,stack:$('#builder-stack').value})});$('#code-output').textContent=data.output;toast('Project draft generated. Review before running.');}
  catch(e){$('#code-output').textContent=e.message;toast(e.message);}
  finally{btn.disabled=false;btn.textContent='Generate project ✦';}
});
$('#copy-code').addEventListener('click',async()=>{try{await navigator.clipboard.writeText($('#code-output').textContent);toast('Output copied.');}catch{toast('Clipboard access unavailable in this browser.');}});
async function loadSaves(){
  if(!currentUser){$('#saved-grid').innerHTML='<div class="empty-state">Sign in to save and view your collection.</div>';return;}
  try{
    const data=await api('/api/saves');
    $('#saved-grid').innerHTML=data.items.length?data.items.map(i=>`<article class="pin-card">${i.image?`<img loading="lazy" src="${escapeHtml(i.image)}" alt="${escapeHtml(i.title)}">`:''}<div class="pin-body"><div class="pin-title">${escapeHtml(i.title)}</div><div class="pin-meta">${escapeHtml(i.source||i.type||'Saved item')}</div>${i.url?`<p><a class="small-btn" href="${escapeHtml(i.url)}" target="_blank" rel="noopener noreferrer">Open ↗</a></p>`:''}<button class="small-btn" data-delete-save="${i.id}">Remove</button></div></article>`).join(''):'<div class="empty-state">Nothing saved yet. Explore and save something you like.</div>';
    $$('[data-delete-save]').forEach(b=>b.addEventListener('click',async()=>{try{await api(`/api/saves/${b.dataset.deleteSave}`,{method:'DELETE'});loadSaves();toast('Removed from saved items.');}catch(e){toast(e.message)}}));
  }catch(e){$('#saved-grid').innerHTML=`<div class="empty-state">${escapeHtml(e.message)}</div>`;}
}
boot();
