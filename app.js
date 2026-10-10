const ITEMS_KEY = 'vault-items-v2';
const CATEGORIES_KEY = 'vault-categories-v2';
const LEGACY_KEY = 'vault-games-v1';
const TOKEN_KEY = 'vault-auth-token';
const DELETIONS_KEY = 'vault-pending-deletions-v2';
const API_BASE = (window.VAULT_CONFIG?.API_BASE_URL || '').replace(/\/$/, '');
const isNativeApp = Boolean(window.Capacitor?.isNativePlatform?.());

const DEFAULT_CATEGORIES = [
  {id:'local-games',systemKey:'games',name:'Videojogos',icon:'🎮',color:'#5df2c2',sortOrder:0},
  {id:'local-comics',systemKey:'comics',name:'Banda desenhada',icon:'📖',color:'#ffe45e',sortOrder:1},
  {id:'local-cards',systemKey:'cards',name:'Cartas',icon:'🃏',color:'#ff6b9d',sortOrder:2},
  {id:'local-pops',systemKey:'pops',name:'Funko Pop!',icon:'🤖',color:'#9b87f5',sortOrder:3},
  {id:'local-figures',systemKey:'figures',name:'Figuras',icon:'🦸',color:'#ff8a5b',sortOrder:4}
];
const SAMPLE_GAMES = [
  {id:'demo-1',title:'The Legend of Zelda: Tears of the Kingdom',platform:'Nintendo Switch',condition:'Como novo',paid:54.99,value:49.50,completeness:'Completo',region:'PAL',cover:'https://images.igdb.com/igdb/image/upload/t_cover_big/co5vmg.webp',createdAt:'2026-07-12'},
  {id:'demo-2',title:'Pokémon HeartGold',platform:'Nintendo DS',condition:'Muito bom',paid:39.90,value:112,completeness:'Completo',region:'PAL',cover:'https://images.igdb.com/igdb/image/upload/t_cover_big/co1z1x.webp',createdAt:'2026-07-10'},
  {id:'demo-3',title:'Shadow of the Colossus',platform:'PlayStation 2',condition:'Bom',paid:12.50,value:31,completeness:'Caixa + jogo',region:'PAL',cover:'https://images.igdb.com/igdb/image/upload/t_cover_big/co1r76.webp',createdAt:'2026-07-07'}
];

let authUser = null;
let authMode = 'login';
let selectedCategory = 'all';
const now = () => new Date().toISOString();
let categories = loadJson(CATEGORIES_KEY, DEFAULT_CATEGORIES);
let items = loadItems();
const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const esc = value => String(value ?? '').replace(/[&<>'"]/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]));
const euro = value => new Intl.NumberFormat('pt-PT',{style:'currency',currency:'EUR'}).format(Number(value)||0);
const categoryOf = item => categories.find(category => category.id === item.categoryId) || {name:'Sem categoria',icon:'◇',color:'#999'};
const safeImage = value => { try { const url = new URL(value); return ['http:','https:'].includes(url.protocol) ? url.href : ''; } catch { return ''; } };

function loadJson(key, fallback) { try { const value=JSON.parse(localStorage.getItem(key)); return Array.isArray(value)?value:fallback; } catch { return fallback; } }
function loadItems() {
  const saved=loadJson(ITEMS_KEY,null); if(saved) return saved;
  const legacy=loadJson(LEGACY_KEY,SAMPLE_GAMES);
  const migrated=legacy.map(game=>({...game,categoryId:'local-games',status:'owned',quantity:1,series:'',brand:'',reference:'',barcode:'',notes:'',updatedAt:now()}));
  localStorage.setItem(ITEMS_KEY,JSON.stringify(migrated)); return migrated;
}
function persist({sync=true}={}) { localStorage.setItem(ITEMS_KEY,JSON.stringify(items)); localStorage.setItem(CATEGORIES_KEY,JSON.stringify(categories)); renderAll(); if(sync) queueSync(); }

async function api(path, options={}) {
  const token=localStorage.getItem(TOKEN_KEY);
  const response=await fetch(`${API_BASE}${path}`,{...options,headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{ }),...options.headers}});
  const data=response.status===204?null:await response.json().catch(()=>({}));
  if(!response.ok) throw new Error(data?.error||'Não foi possível contactar o servidor.');
  return data;
}
function queueSync(){if(!authUser||!navigator.onLine)return;clearTimeout(window.syncTimer);window.syncTimer=setTimeout(()=>syncCollection(false),700);}
async function syncCollection(showMessage=true){
  if(!authUser||!navigator.onLine)return;
  setSyncStatus('A sincronizar…');
  try{
    const remote=await api('/api/categories');
    const idMap=new Map();
    for(const local of categories){
      let match=remote.categories.find(category=>local.systemKey&&category.systemKey===local.systemKey)||remote.categories.find(category=>category.id===local.id||category.name.toLowerCase()===local.name.toLowerCase());
      if(!match&&!local.systemKey){const created=await api('/api/categories',{method:'POST',body:JSON.stringify({name:local.name,icon:local.icon,color:local.color})});match=created.category;remote.categories.push(match);}
      if(match)idMap.set(local.id,match.id);
    }
    items=items.map(item=>({...item,categoryId:idMap.get(item.categoryId)||item.categoryId}));
    categories=remote.categories;
    const deletedIds=loadJson(DELETIONS_KEY,[]);
    const data=await api('/api/sync',{method:'POST',body:JSON.stringify({items,deletedIds})});
    categories=data.categories; items=data.items; localStorage.removeItem(DELETIONS_KEY); persist({sync:false});
    setSyncStatus('Cloud save ativo'); if(showMessage)toast('Coleção sincronizada');
  }catch(error){setSyncStatus('Alterações por sincronizar');if(showMessage)toast(error.message);}
}

function setSyncStatus(text){$('#profileStatus').textContent=text;}
function updateProfile(){
  if(authUser){$('#profileName').textContent=authUser.name;$('#profileAvatar').textContent=authUser.name.split(/\s+/).map(x=>x[0]).join('').slice(0,2).toUpperCase();setSyncStatus(navigator.onLine?'Cloud save ativo':'Modo offline');}
  else{$('#profileName').textContent='Modo offline';$('#profileAvatar').textContent='P1';setSyncStatus('Neste dispositivo');}
}
function showAuth(mode='login'){authMode=mode;const register=mode==='register';$('#authScreen').classList.add('open');$('#authScreen').classList.toggle('register-mode',register);$('#authTitle').textContent=register?'CRIAR NOVO JOGADOR':'ENTRAR NA VAULT';$('.auth-submit').textContent=register?'Criar conta':'Entrar';$('#authSwitch').textContent=register?'Já tens conta? Entrar':'Novo na Vault? Criar conta';$('#authPassword').autocomplete=register?'new-password':'current-password';$('#authError').textContent='';}
function hideAuth(){$('#authScreen').classList.remove('open');}
function launchApp(mode='login'){$('#landing').hidden=true;$('#appShell').hidden=false;document.body.classList.remove('marketing');window.scrollTo(0,0);if(!localStorage.getItem(TOKEN_KEY))showAuth(mode);}
async function initAuth(){const token=localStorage.getItem(TOKEN_KEY);if(!token){if(isNativeApp)showAuth();updateProfile();return;}try{const data=await api('/api/me');authUser=data.user;updateProfile();await syncCollection(false);}catch{localStorage.removeItem(TOKEN_KEY);showAuth();updateProfile();}}
function logout(){localStorage.removeItem(TOKEN_KEY);authUser=null;updateProfile();showAuth();toast('Sessão terminada');}

function imageMarkup(item){const url=safeImage(item.cover);return url?`<img src="${esc(url)}" alt="Imagem de ${esc(item.title)}" loading="lazy">`:`<div class="cover-placeholder">${esc(item.title.charAt(0).toUpperCase())}</div>`;}
function itemMeta(item){return [item.platform,item.series,item.reference].filter(Boolean).slice(0,2).join(' · ')||categoryOf(item).name;}
function renderAll(){
  const owned=items.filter(item=>item.status==='owned'),total=owned.reduce((sum,item)=>sum+Number(item.value)*Number(item.quantity||1),0),invested=owned.reduce((sum,item)=>sum+Number(item.paid)*Number(item.quantity||1),0),gain=total-invested;
  $('#totalValue').textContent=euro(total);$('#totalItems').textContent=owned.reduce((sum,item)=>sum+Number(item.quantity||1),0);$('#totalInvested').textContent=euro(invested);$('#totalGain').textContent=(gain>=0?'+ ':'− ')+euro(Math.abs(gain));
  const percent=invested?gain/invested*100:0;$('#gainBadge').textContent=`${percent>=0?'↗':'↘'} ${Math.abs(percent).toFixed(1)}%`;$('#gainBadge').className=`trend ${percent>=0?'positive':'neutral'}`;
  const used=new Set(owned.map(item=>item.categoryId));$('#categoryCount').textContent=`${used.size} ${used.size===1?'categoria':'categorias'}`;$('#averagePaid').textContent=`Média ${euro(owned.length?invested/owned.length:0)} / item`;$('#navCount').textContent=owned.length;$('#donutTotal').childNodes[0].nodeValue=owned.length;
  renderHighlights(owned);renderDistribution(owned);renderRecent();renderCollection();renderWishlist();renderCategoryControls();
}
function renderHighlights(owned){const top=[...owned].sort((a,b)=>b.value-a.value).slice(0,3);$('#itemHighlights').innerHTML=top.length?top.map(item=>`<div class="highlight-card">${imageMarkup(item)}<div class="highlight-info"><span class="highlight-value">${euro(item.value)}</span><strong>${esc(item.title)}</strong><span>${esc(itemMeta(item))}</span></div></div>`).join(''):'<p class="muted">Adiciona itens para veres os destaques.</p>';}
function renderDistribution(owned){const counts=owned.reduce((acc,item)=>(acc[item.categoryId]=(acc[item.categoryId]||0)+1,acc),{}),entries=Object.entries(counts).sort((a,b)=>b[1]-a[1]).slice(0,6);let start=0;const stops=entries.map(([id,count])=>{const category=categories.find(c=>c.id===id)||{},end=start+(count/Math.max(owned.length,1)*100),stop=`${category.color||'#888'} ${start}% ${end}%`;start=end;return stop;});$('#categoryDonut').style.background=owned.length?`conic-gradient(${stops.join(',')})`:'#29243a';$('#categoryLegend').innerHTML=entries.map(([id,count])=>{const category=categories.find(c=>c.id===id)||{name:'Outro',color:'#888'};return `<div class="legend-item"><i class="legend-dot" style="background:${esc(category.color)}"></i><span>${esc(category.name)}</span><span>${count}</span></div>`;}).join('')||'<span class="muted">Sem dados</span>';}
function renderRecent(){const recent=[...items].filter(i=>i.status==='owned').sort((a,b)=>String(b.updatedAt||b.createdAt).localeCompare(String(a.updatedAt||a.createdAt))).slice(0,5);$('#recentTable').innerHTML=recent.map(item=>{const category=categoryOf(item);return `<tr><td><div class="table-game"><div class="table-cover">${imageMarkup(item)}</div>${esc(item.title)}</div></td><td><span class="platform-pill">${esc(category.icon)} ${esc(category.name)}</span></td><td><span class="condition-pill">${esc(item.condition)}</span></td><td>${euro(item.paid)}</td><td class="value-cell">${euro(item.value)}</td><td><button class="text-button item-edit" data-id="${esc(item.id)}">Editar</button></td></tr>`;}).join('')||'<tr><td colspan="6">Ainda não existem itens.</td></tr>';}
function filteredItems(){const q=$('#collectionSearch').value.toLowerCase(),category=$('#categoryFilter').value,condition=$('#conditionFilter').value;return items.filter(item=>item.status==='owned'&&(category==='all'||item.categoryId===category)&&(condition==='all'||item.condition===condition)&&[item.title,item.series,item.brand,item.platform,item.reference,item.barcode].some(value=>String(value||'').toLowerCase().includes(q)));}
function cardMarkup(item){const category=categoryOf(item);return `<article class="game-card"><div class="game-card-cover">${imageMarkup(item)}<span class="category-corner" style="--category:${esc(category.color)}">${esc(category.icon)} ${esc(category.name)}</span><span class="card-value">${euro(item.value)}</span></div><div class="game-card-body"><h3 title="${esc(item.title)}">${esc(item.title)}</h3><div class="game-meta"><span>${esc(itemMeta(item))}</span>${item.quantity>1?`<span>×${item.quantity}</span>`:''}</div><div class="card-footer"><span>${esc(item.condition)}${item.completeness?' · '+esc(item.completeness):''}</span><div class="card-actions"><button class="item-edit" data-id="${esc(item.id)}" title="Editar">✎</button><button class="item-delete" data-id="${esc(item.id)}" title="Remover">×</button></div></div></div></article>`;}
function renderCollection(){const list=filteredItems(),owned=items.filter(i=>i.status==='owned');$('#collectionSubtitle').textContent=`${owned.length} ${owned.length===1?'item guardado':'itens guardados'} no teu arquivo.`;$('#resultCount').textContent=`${list.length} ${list.length===1?'resultado':'resultados'}`;$('#collectionGrid').innerHTML=list.map(cardMarkup).join('');$('#emptyState').style.display=list.length?'none':'block';}
function renderWishlist(){const list=items.filter(i=>i.status==='wishlist');$('#wishlistGrid').innerHTML=list.map(cardMarkup).join('');$('#wishlistEmpty').style.display=list.length?'none':'block';}
function renderCategoryControls(){const options=categories.map(c=>`<option value="${esc(c.id)}">${esc(c.icon)} ${esc(c.name)}</option>`).join(''),filter=$('#categoryFilter'),current=filter.value||selectedCategory;filter.innerHTML='<option value="all">Todas as categorias</option>'+options;filter.value=categories.some(c=>c.id===current)?current:'all';$('#categoryId').innerHTML=options;renderCategoryManager();}
function renderCategoryManager(){if(!$('#categoryManagerList'))return;$('#categoryManagerList').innerHTML=categories.map(category=>{const count=items.filter(item=>item.categoryId===category.id).length;return `<div class="category-row"><span class="category-swatch" style="--category:${esc(category.color)}">${esc(category.icon)}</span><span><strong>${esc(category.name)}</strong><small>${count} ${count===1?'item':'itens'}${category.systemKey?' · incluída':''}</small></span>${category.systemKey?'':`<button class="text-button category-delete" data-id="${esc(category.id)}">Eliminar</button>`}</div>`;}).join('');}

function showView(name){$$('.view').forEach(v=>v.classList.remove('active'));$$('.nav-item').forEach(n=>n.classList.toggle('active',n.dataset.view===name));$(`#${name}View`).classList.add('active');$('.sidebar').classList.remove('open');window.scrollTo({top:0,behavior:'smooth'});}
function updateDynamicForm(){const category=categories.find(c=>c.id===$('#categoryId').value),isGame=category?.systemKey==='games';$('#platformField').style.display=isGame?'grid':'none';$('#platform').required=isGame;}
function openItemModal(item=null,status='owned'){const form=$('#itemForm');form.reset();$('#itemId').value=item?.id||'';$('#modalTitle').textContent=item?'Editar item':'Adicionar à Vault';const fields=['categoryId','title','platform','series','brand','reference','condition','completeness','region','quantity','barcode','paid','value','cover','notes','status'];fields.forEach(key=>{const element=$(`#${key}`);if(element)element.value=item?.[key]??(key==='categoryId'?(selectedCategory!=='all'?selectedCategory:categories[0]?.id):key==='status'?status:key==='quantity'?1:key==='paid'||key==='value'?0:'');});updateDynamicForm();$('#itemModal').classList.add('open');setTimeout(()=>$('#title').focus(),80);}
function closeItemModal(){$('#itemModal').classList.remove('open');}
function openCategoryModal(){$('#categoryModal').classList.add('open');renderCategoryManager();}
function closeCategoryModal(){$('#categoryModal').classList.remove('open');}
function deleteItem(id){const item=items.find(entry=>entry.id===id);if(item&&confirm(`Remover “${item.title}” da Vault?`)){items=items.filter(entry=>entry.id!==id);const pending=new Set(loadJson(DELETIONS_KEY,[]));pending.add(id);localStorage.setItem(DELETIONS_KEY,JSON.stringify([...pending]));persist();toast('Item removido');}}
function toast(message){const element=$('#toast');element.textContent=message;element.classList.add('show');clearTimeout(window.toastTimer);window.toastTimer=setTimeout(()=>element.classList.remove('show'),2600);}
function exportCsv(){const header=['Categoria','Título','Série','Marca/Editora','Referência','Plataforma','Condição','Quantidade','Preço pago','Valor atual','Estado','Código','Data'];const rows=items.map(item=>[categoryOf(item).name,item.title,item.series,item.brand,item.reference,item.platform,item.condition,item.quantity,item.paid,item.value,item.status,item.barcode,item.createdAt]);const csv=[header,...rows].map(row=>row.map(value=>`"${String(value??'').replaceAll('"','""')}"`).join(';')).join('\n');const blob=new Blob(['\ufeff'+csv],{type:'text/csv;charset=utf-8'}),link=document.createElement('a');link.href=URL.createObjectURL(blob);link.download=`vault-backup-${new Date().toISOString().slice(0,10)}.csv`;link.click();URL.revokeObjectURL(link.href);toast('Coleção exportada');}

$$('.nav-item').forEach(node=>node.addEventListener('click',()=>showView(node.dataset.view)));$$('[data-go]').forEach(button=>button.addEventListener('click',()=>showView(button.dataset.go)));
['addItemTop','addItemCollection','emptyAdd'].forEach(id=>$(`#${id}`).addEventListener('click',()=>openItemModal()));
$('#addWishlist').addEventListener('click',()=>openItemModal(null,'wishlist'));$('#manageCategories').addEventListener('click',openCategoryModal);
$('#modalClose').addEventListener('click',closeItemModal);$('#cancelButton').addEventListener('click',closeItemModal);$('#itemModal').addEventListener('click',event=>{if(event.target===event.currentTarget)closeItemModal();});
$('#categoryModalClose').addEventListener('click',closeCategoryModal);$('#categoryModal').addEventListener('click',event=>{if(event.target===event.currentTarget)closeCategoryModal();});
$('#mobileMenu').addEventListener('click',()=>$('.sidebar').classList.toggle('open'));$('#collectionSearch').addEventListener('input',renderCollection);$('#categoryFilter').addEventListener('change',event=>{selectedCategory=event.target.value;renderCollection();});$('#conditionFilter').addEventListener('change',renderCollection);$('#exportButton').addEventListener('click',exportCsv);$('#categoryId').addEventListener('change',updateDynamicForm);
$('#globalSearch').addEventListener('input',event=>{$('#collectionSearch').value=event.target.value;if(event.target.value)showView('collection');renderCollection();});
document.addEventListener('click',event=>{const edit=event.target.closest('.item-edit'),remove=event.target.closest('.item-delete'),categoryDelete=event.target.closest('.category-delete');if(edit)openItemModal(items.find(item=>item.id===edit.dataset.id));if(remove)deleteItem(remove.dataset.id);if(categoryDelete)deleteCategory(categoryDelete.dataset.id);});
document.addEventListener('keydown',event=>{if((event.metaKey||event.ctrlKey)&&event.key==='k'){event.preventDefault();$('#globalSearch').focus();}if(event.key==='Escape'){closeItemModal();closeCategoryModal();}});

$('#itemForm').addEventListener('submit',event=>{event.preventDefault();const id=$('#itemId').value,previous=items.find(item=>item.id===id),item={id:id||crypto.randomUUID(),categoryId:$('#categoryId').value,title:$('#title').value.trim(),platform:$('#platform').value.trim(),series:$('#series').value.trim(),brand:$('#brand').value.trim(),reference:$('#reference').value.trim(),condition:$('#condition').value,completeness:$('#completeness').value.trim(),region:$('#region').value.trim(),quantity:Number($('#quantity').value)||1,barcode:$('#barcode').value.trim(),paid:Number($('#paid').value)||0,value:Number($('#value').value)||0,cover:safeImage($('#cover').value.trim()),notes:$('#notes').value.trim(),status:$('#status').value,currency:'EUR',createdAt:previous?.createdAt||new Date().toISOString().slice(0,10),updatedAt:now()};items=id?items.map(entry=>entry.id===id?item:entry):[item,...items];persist();closeItemModal();toast(id?'Item atualizado':'Item adicionado');});
$('#categoryForm').addEventListener('submit',async event=>{event.preventDefault();const draft={name:$('#categoryName').value.trim(),icon:$('#categoryIcon').value.trim()||'◇',color:$('#categoryColor').value};try{if(authUser){const data=await api('/api/categories',{method:'POST',body:JSON.stringify(draft)});categories.push(data.category);}else{categories.push({...draft,id:crypto.randomUUID(),systemKey:null,sortOrder:categories.length});}$('#categoryForm').reset();$('#categoryIcon').value='◇';persist({sync:false});toast('Categoria criada');}catch(error){toast(error.message);}});
async function deleteCategory(id){const category=categories.find(c=>c.id===id);if(!category||category.systemKey)return;if(items.some(item=>item.categoryId===id))return toast('Move ou remove primeiro os itens desta categoria');if(!confirm(`Eliminar a categoria “${category.name}”?`))return;try{if(authUser)await api(`/api/categories/${encodeURIComponent(id)}`,{method:'DELETE'});categories=categories.filter(c=>c.id!==id);persist({sync:false});toast('Categoria eliminada');}catch(error){toast(error.message);}}

$('#authSwitch').addEventListener('click',()=>showAuth(authMode==='login'?'register':'login'));$('#offlineButton').addEventListener('click',hideAuth);$('#accountButton').addEventListener('click',()=>authUser?(confirm(`Sessão iniciada como ${authUser.email}. Sair?`)&&logout()):showAuth());
$('#authForm').addEventListener('submit',async event=>{event.preventDefault();const button=$('.auth-submit');button.disabled=true;$('#authError').textContent='';try{const body={email:$('#authEmail').value,password:$('#authPassword').value,...(authMode==='register'?{name:$('#authName').value}:{})};const data=await api(`/api/auth/${authMode}`,{method:'POST',body:JSON.stringify(body)});localStorage.setItem(TOKEN_KEY,data.token);authUser=data.user;updateProfile();hideAuth();await syncCollection(true);}catch(error){$('#authError').textContent=error.message;}finally{button.disabled=false;}});
window.addEventListener('online',()=>{updateProfile();syncCollection(false);});window.addEventListener('offline',updateProfile);
$$('[data-launch]').forEach(button=>button.addEventListener('click',()=>launchApp(button.dataset.launch)));
if(isNativeApp||location.hash==='#app'||localStorage.getItem(TOKEN_KEY))launchApp('login');else document.body.classList.add('marketing');
renderAll();initAuth();
