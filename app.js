(() => {
"use strict";

const $ = id => document.getElementById(id);
const STORAGE_KEY = "notepal_notes_v2";
const CATEGORIES_KEY = "notepal_categories_v2";
const LOGO_KEY = "preach_mate_logo_v1";
const MAX_LOGO_BYTES = 50 * 1024;
const BACKUP_DB_NAME = "preach_mate_durable_storage_v1";
const BACKUP_STORE_NAME = "app_backups";
const BACKUP_RECORD_KEY = "latest";

const COLORS = [
  {name:"Yellow",value:"#fef08a"},
  {name:"Gold",value:"#fde047"},
  {name:"Orange",value:"#fed7aa"},
  {name:"Pink",value:"#fbcfe8"},
  {name:"Red",value:"#fecaca"},
  {name:"Purple",value:"#e9d5ff"},
  {name:"Blue",value:"#bfdbfe"},
  {name:"Sky",value:"#bae6fd"},
  {name:"Green",value:"#bbf7d0"},
  {name:"Mint",value:"#a7f3d0"},
  {name:"White",value:"#ffffff"},
  {name:"Gray",value:"#d1d5db"},
  {name:"Black",value:"#111827"},
  {name:"Dark blue",value:"#1d4ed8"},
  {name:"Dark red",value:"#b91c1c"},
  {name:"Dark green",value:"#047857"},
  {name:"Violet",value:"#7e22ce"},
  {name:"Brown",value:"#92400e"},
  {name:"Slate",value:"#475569"},
  {name:"Teal",value:"#0f766e"},
  {name:"Rose",value:"#e11d48"}
];

function makeId(){
  return "n_"+Date.now().toString(36)+"_"+Math.random().toString(36).slice(2,8);
}
function parseJSON(v,f){
  try{return JSON.parse(v)??f}catch(e){return f}
}
function safeStorageGet(key){
  try{return localStorage.getItem(key)}catch(e){return null}
}
function safeStorageSet(key,value){
  try{
    localStorage.setItem(key,value);
    return true;
  }catch(e){
    return false;
  }
}

/* DURABLE BACKUP USING INDEXEDDB */
let backupTimer=null;
let backupWriteQueue=Promise.resolve();

function openBackupDB(){
  return new Promise((resolve,reject)=>{
    if(!("indexedDB" in window)){
      reject(new Error("IndexedDB unavailable"));
      return;
    }
    let request;
    try{
      request=indexedDB.open(BACKUP_DB_NAME,1);
    }catch(e){
      reject(e);
      return;
    }
    request.onupgradeneeded=()=>{
      const db=request.result;
      if(!db.objectStoreNames.contains(BACKUP_STORE_NAME)){
        db.createObjectStore(BACKUP_STORE_NAME,{keyPath:"id"});
      }
    };
    request.onsuccess=()=>resolve(request.result);
    request.onerror=()=>reject(request.error||new Error("Database open failed"));
    request.onblocked=()=>reject(new Error("Database upgrade blocked"));
  });
}

async function readDurableBackup(){
  let db;
  try{
    db=await openBackupDB();
    return await new Promise((resolve,reject)=>{
      const tx=db.transaction(BACKUP_STORE_NAME,"readonly");
      const request=tx.objectStore(BACKUP_STORE_NAME).get(BACKUP_RECORD_KEY);
      request.onsuccess=()=>resolve(request.result||null);
      request.onerror=()=>reject(request.error||new Error("Backup read failed"));
      tx.onabort=()=>reject(tx.error||new Error("Backup read aborted"));
    });
  }catch(e){
    return null;
  }finally{
    if(db)db.close();
  }
}

async function writeDurableBackup(){
  const snapshot={
    id:BACKUP_RECORD_KEY,
    savedAt:Date.now(),
    notes:notes,
    categories:categories,
    logo:safeStorageGet(LOGO_KEY)
  };
  let db;
  try{
    db=await openBackupDB();
    await new Promise((resolve,reject)=>{
      const tx=db.transaction(BACKUP_STORE_NAME,"readwrite");
      tx.objectStore(BACKUP_STORE_NAME).put(snapshot);
      tx.oncomplete=()=>resolve(true);
      tx.onerror=()=>reject(tx.error||new Error("Backup write failed"));
      tx.onabort=()=>reject(tx.error||new Error("Backup write aborted"));
    });
    return true;
  }catch(e){
    return false;
  }finally{
    if(db)db.close();
  }
}

function scheduleDurableBackup(){
  clearTimeout(backupTimer);
  backupTimer=setTimeout(()=>{
    backupWriteQueue=backupWriteQueue
      .catch(()=>{})
      .then(()=>writeDurableBackup());
  },350);
}

function flushDurableBackup(){
  clearTimeout(backupTimer);
  backupTimer=null;
  backupWriteQueue=backupWriteQueue
    .catch(()=>{})
    .then(()=>writeDurableBackup());
  return backupWriteQueue;
}

/* REQUEST PERSISTENT STORAGE WHEN SUPPORTED */
async function requestPersistentStorage(){
  try{
    if(navigator.storage&&navigator.storage.persist){
      const alreadyPersistent=await navigator.storage.persisted();
      if(alreadyPersistent)return true;
      return await navigator.storage.persist();
    }
  }catch(e){}
  return false;
}

/* INSTALL BUTTON */
let deferredInstallPrompt=null;
let installCompleted=false;

function isInstalledApp(){
  return installCompleted||
    window.matchMedia("(display-mode: standalone)").matches||
    window.matchMedia("(display-mode: fullscreen)").matches||
    navigator.standalone===true;
}
function updateInstallButton(){
  const button=$("drawerInstall");
  if(button)button.classList.toggle("hidden",isInstalledApp());
}
window.addEventListener("beforeinstallprompt",event=>{
  event.preventDefault();
  deferredInstallPrompt=event;
  updateInstallButton();
});
window.addEventListener("appinstalled",()=>{
  installCompleted=true;
  deferredInstallPrompt=null;
  updateInstallButton();
  showToast("Preach Mate is installed!");
});

/* STARTUP DATA */
const DEFAULT_CATEGORIES=["All Notes","Personal","Study","Work","Ideas"];
const initialCategoriesRaw=safeStorageGet(CATEGORIES_KEY);
const initialNotesRaw=safeStorageGet(STORAGE_KEY);
const initialCategories=parseJSON(initialCategoriesRaw,null);
const initialNotes=parseJSON(initialNotesRaw,null);
const categoriesWereStored=Array.isArray(initialCategories)&&initialCategories.length>0;
const notesWereStored=Array.isArray(initialNotes);

let categories=categoriesWereStored?initialCategories:[...DEFAULT_CATEGORIES];
categories=["All Notes",...categories.filter(c=>typeof c==="string"&&c!=="All Notes")];
categories=[...new Set(categories)];

let notes=notesWereStored?initialNotes:null;
if(!Array.isArray(notes)){
  notes=[{
    id:makeId(),
    title:"Welcome to Preach Mate",
    content:"<p>Your notes are saved automatically on this device.</p><p><b>Read Mode:</b> Tap a word to temporarily mark where you stopped reading.</p><p><b>Edit Mode:</b> Select text, then choose highlight or font color from the toolbar.</p>",
    category:"Personal",favorite:false,pinned:false,fontSize:17,color:"#111827",updated:Date.now()
  }];
}
notes=notes.filter(n=>n&&typeof n==="object");
notes.forEach(n=>{
  if(!n.id)n.id=makeId();
  if(typeof n.title!=="string")n.title="";
  if(typeof n.content!=="string")n.content="";
  if(typeof n.pinned!=="boolean")n.pinned=false;
  if(typeof n.favorite!=="boolean")n.favorite=false;
});

let activeCategory="All Notes",favoritesOnly=false,currentNoteId=null,isEditMode=false;
let dialogAction=null,toastTimer=null,markerSpan=null,savedSelection=null;
let paletteType="highlight",dragInfo=null,suppressCategoryClick=false;
let saveStatusTimer=null;

const home=$("app"),editor=$("editorScreen"),noteTitle=$("noteTitle"),noteBody=$("noteBody");
const toolbar=$("editorToolbar"),palette=$("colorPalette"),menu=$("editorMenu");
const vv=window.visualViewport;

function setSaveStatus(state){
  const status=$("saveStatus");
  if(!status)return;
  status.classList.remove("saving","saved","error");
  status.classList.add(state);
  if(state==="saving")status.textContent="Saving…";
  else if(state==="saved")status.textContent="✓ Saved";
  else status.textContent="Save failed";
}
function scheduleSavedStatus(){
  clearTimeout(saveStatusTimer);
  saveStatusTimer=setTimeout(()=>setSaveStatus("saved"),220);
}
function persist(){
  let localSaved=true;
  try{
    localStorage.setItem(STORAGE_KEY,JSON.stringify(notes));
    localStorage.setItem(CATEGORIES_KEY,JSON.stringify(categories));
  }catch(e){
    localSaved=false;
  }
  scheduleDurableBackup();
  if(!localSaved){
    showToast("Local save failed. Export a backup if possible.");
  }
  return localSaved;
}
function currentNote(){
  return notes.find(n=>n.id===currentNoteId)||null;
}
function plainText(html){
  const box=document.createElement("div");
  box.innerHTML=html||"";
  return (box.innerText||box.textContent||"").replace(/\s+/g," ").trim();
}
function esc(s){
  return String(s).replace(/[&<>"']/g,c=>({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
  }[c]));
}
function escapeRegExp(s){
  return String(s).replace(/[.*+?^${}()|[\]\\]/g,"\\$&");
}
function highlightSearchTerms(text,query){
  const value=String(text||"");
  const terms=[...new Set(String(query||"").trim().split(/\s+/).filter(Boolean))]
    .sort((a,b)=>b.length-a.length);
  if(!terms.length)return esc(value);
  const regex=new RegExp("("+terms.map(escapeRegExp).join("|")+")","gi");
  return value.split(regex).map(part=>{
    const matched=terms.some(term=>part.toLowerCase()===term.toLowerCase());
    return matched?'<mark class="search-match">'+esc(part)+'</mark>':esc(part);
  }).join("");
}
function showToast(msg){
  $("toast").textContent=msg;
  $("toast").classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer=setTimeout(()=>$("toast").classList.add("hidden"),2400);
}

/* LOGO STORAGE AND RECOVERY */
function applySavedLogo(){
  const data=safeStorageGet(LOGO_KEY);
  ["topbarLogo","drawerLogo"].forEach(id=>{
    const img=$(id);
    if(!img)return;
    if(data){
      img.src=data;
      img.classList.remove("hidden");
    }else{
      img.removeAttribute("src");
      img.classList.add("hidden");
    }
  });
}
function chooseLogo(){
  const input=$("logoFileInput");
  if(!input)return;
  input.value="";
  input.click();
}
function compressLogo(file){
  if(!file||!file.type.startsWith("image/")){
    showToast("Please select an image.");
    return;
  }
  const reader=new FileReader();
  reader.onerror=()=>showToast("Unable to read this image.");
  reader.onload=()=>{
    const image=new Image();
    image.onerror=()=>showToast("Unable to open this image.");
    image.onload=()=>{
      const originalWidth=image.naturalWidth;
      const originalHeight=image.naturalHeight;
      if(!originalWidth||!originalHeight){
        showToast("Invalid image.");
        return;
      }
      const canvas=document.createElement("canvas");
      const ctx=canvas.getContext("2d");
      if(!ctx){
        showToast("Unable to process this image.");
        return;
      }
      const sizes=[320,280,240,200,160];
      const qualities=[0.82,0.70,0.58,0.46,0.34,0.25];
      let sizeIndex=0,qualityIndex=0,finished=false;

      function tryCompression(){
        if(finished)return;
        const maxSide=sizes[sizeIndex];
        const scale=Math.min(1,maxSide/Math.max(originalWidth,originalHeight));
        canvas.width=Math.max(1,Math.round(originalWidth*scale));
        canvas.height=Math.max(1,Math.round(originalHeight*scale));
        ctx.clearRect(0,0,canvas.width,canvas.height);
        ctx.drawImage(image,0,0,canvas.width,canvas.height);

        canvas.toBlob(blob=>{
          if(finished)return;
          if(!blob){
            showToast("Unable to compress this image.");
            return;
          }
          if(blob.size<=MAX_LOGO_BYTES){
            finished=true;
            const resultReader=new FileReader();
            resultReader.onerror=()=>showToast("Unable to save the image.");
            resultReader.onload=()=>{
              const saved=safeStorageSet(LOGO_KEY,resultReader.result);
              if(saved){
                applySavedLogo();
                scheduleDurableBackup();
                flushDurableBackup().then(()=>{
                  showToast("Logo saved on this device!");
                });
              }else{
                showToast("Could not save logo. Device storage may be full.");
              }
            };
            resultReader.readAsDataURL(blob);
            return;
          }
          qualityIndex++;
          if(qualityIndex>=qualities.length){
            qualityIndex=0;
            sizeIndex++;
          }
          if(sizeIndex>=sizes.length){
            finished=true;
            showToast("Image is too large to compress below 21 KB.");
            return;
          }
          tryCompression();
        },"image/webp",qualities[qualityIndex]);
      }
      tryCompression();
    };
    image.src=reader.result;
  };
  reader.readAsDataURL(file);
}

/* FIVE TAPS ON BRANDING TO CHANGE LOGO */
function setupLogoFiveTap(id){
  const area=$(id);
  if(!area)return;
  let taps=0,timer=null;
  area.addEventListener("click",()=>{
    taps++;
    clearTimeout(timer);
    if(taps>=5){
      taps=0;
      chooseLogo();
      return;
    }
    timer=setTimeout(()=>{taps=0},2200);
  });
}
setupLogoFiveTap("topbarBrand");
setupLogoFiveTap("drawerBrand");

$("logoFileInput").addEventListener("change",e=>{
  const file=e.target.files&&e.target.files[0];
  if(file)compressLogo(file);
});

function cleanTemporaryMarker(root){
  root.querySelectorAll(".read-word-marker").forEach(s=>s.replaceWith(...s.childNodes));
}
function saveCurrentNote(){
  const n=currentNote();
  if(!n)return;
  n.title=noteTitle.value.trim();
  const clone=noteBody.cloneNode(true);
  cleanTemporaryMarker(clone);
  n.content=clone.innerHTML;
  n.fontSize=parseInt(noteBody.dataset.fontSize||n.fontSize||17,10);
  n.color=noteBody.style.color||n.color||"#111827";
  n.updated=Date.now();
  setSaveStatus("saving");
  const saved=persist();
  if(saved)scheduleSavedStatus();
  else{
    clearTimeout(saveStatusTimer);
    setSaveStatus("error");
  }
}
function togglePin(id){
  const n=notes.find(x=>x.id===id);
  if(!n)return;
  n.pinned=!n.pinned;
  n.updated=Date.now();
  persist();
  renderNotes();
  if(currentNoteId===id)updatePinMenu();
  showToast(n.pinned?"📌 Note pinned to top":"Pin removed");
}
function updatePinMenu(){
  const n=currentNote();
  if(n)$("menuPin").textContent=n.pinned?"📌 Unpin Note":"📌 Pin to Top";
}

/* CATEGORIES */
function renderCategories(){
  const row=$("categoryTabs");
  row.innerHTML="";
  const ordered=["All Notes",...categories.filter(c=>c!=="All Notes")];
  ordered.forEach(cat=>{
    const b=document.createElement("button");
    b.className="category-tab"+(activeCategory===cat&&!favoritesOnly?" active":"");
    b.textContent=cat;
    b.dataset.category=cat;
    b.addEventListener("click",()=>{
      if(suppressCategoryClick){suppressCategoryClick=false;return}
      activeCategory=cat;
      favoritesOnly=false;
      renderCategories();
      renderNotes();
    });
    if(cat!=="All Notes")attachCategoryDrag(b,"tabs");
    row.appendChild(b);
  });
  const add=document.createElement("button");
  add.className="add-category";
  add.textContent="⊞+";
  add.title="Add category";
  add.setAttribute("aria-label","Add category");
  add.addEventListener("click",addCategoryDialog);
  row.appendChild(add);
  renderDrawerCategories();
}
function renderDrawerCategories(){
  const holder=$("drawerCategories");
  holder.innerHTML="";
  const ordered=["All Notes",...categories.filter(c=>c!=="All Notes")];
  ordered.forEach(cat=>{
    const b=document.createElement("button");
    b.className="drawer-category"+(activeCategory===cat&&!favoritesOnly?" active":"");
    b.dataset.category=cat;
    const handle=document.createElement("span");
    handle.className="cat-drag-handle";
    handle.textContent=cat==="All Notes"?"":"⠿";
    handle.setAttribute("aria-label",cat==="All Notes"?"":"Drag to reorder category");
    if(cat==="All Notes")handle.style.display="none";
    const icon=document.createElement("span");
    icon.className="cat-icon";
    icon.textContent=cat==="All Notes"?"▦":"▤";
    const name=document.createElement("span");
    name.className="cat-name";
    name.textContent=cat;
    const count=document.createElement("span");
    count.className="cat-count";
    count.textContent=cat==="All Notes"?notes.length:notes.filter(n=>n.category===cat).length;
    b.append(handle,icon,name,count);
    b.addEventListener("click",()=>{
      if(suppressCategoryClick){suppressCategoryClick=false;return}
      activeCategory=cat;
      favoritesOnly=false;
      $("searchInput").value="";
      renderCategories();
      renderNotes();
      closeDrawer();
    });
    if(cat!=="All Notes")attachCategoryDrag(b,"drawer");
    holder.appendChild(b);
  });
}
function attachCategoryDrag(button,surface){
  const isTabs=surface==="tabs";
  const container=isTabs?$("categoryTabs"):$("drawerCategories");
  const selector=isTabs?".category-tab[data-category]":".drawer-category[data-category]";
  const axis=isTabs?"x":"y";
  button.addEventListener("pointerdown",e=>{
    if(e.button!==0&&e.pointerType==="mouse")return;
    if(button.dataset.category==="All Notes")return;
    if(!isTabs&&!e.target.closest(".cat-drag-handle"))return;
    dragInfo={button,container,selector,axis,surface,pointerId:e.pointerId,startX:e.clientX,startY:e.clientY,moved:false};
    try{button.setPointerCapture(e.pointerId)}catch(err){}
  });
  button.addEventListener("pointermove",e=>{
    if(!dragInfo||dragInfo.button!==button||dragInfo.pointerId!==e.pointerId)return;
    const dx=e.clientX-dragInfo.startX,dy=e.clientY-dragInfo.startY;
    const primary=axis==="x"?dx:dy,secondary=axis==="x"?dy:dx;
    if(!dragInfo.moved){
      if(Math.abs(primary)<8)return;
      if(Math.abs(primary)<Math.abs(secondary))return;
      dragInfo.moved=true;
      button.classList.add("dragging");
    }
    if(e.cancelable)e.preventDefault();
    const underPointer=document.elementFromPoint(e.clientX,e.clientY);
    const target=underPointer?underPointer.closest(selector):null;
    if(!target||target===button||target.dataset.category==="All Notes"||target.parentElement!==container)return;
    container.querySelectorAll(".drag-target").forEach(el=>el.classList.remove("drag-target"));
    target.classList.add("drag-target");
    const rect=target.getBoundingClientRect();
    const before=axis==="x"?e.clientX<rect.left+rect.width/2:e.clientY<rect.top+rect.height/2;
    if(before){
      if(button.nextElementSibling!==target)container.insertBefore(button,target);
    }else if(target.nextElementSibling!==button){
      container.insertBefore(button,target.nextElementSibling);
    }
  });
  const finish=e=>{
    if(!dragInfo||dragInfo.button!==button||dragInfo.pointerId!==e.pointerId)return;
    const moved=dragInfo.moved;
    button.classList.remove("dragging");
    container.querySelectorAll(".drag-target").forEach(el=>el.classList.remove("drag-target"));
    if(moved){
      const reordered=[...container.querySelectorAll(selector)].map(el=>el.dataset.category).filter(cat=>cat&&cat!=="All Notes");
      const remaining=categories.filter(cat=>cat!=="All Notes"&&!reordered.includes(cat));
      categories=["All Notes",...reordered,...remaining];
      persist();
      suppressCategoryClick=true;
      renderCategories();
      renderNotes();
      showToast("Category order saved");
      setTimeout(()=>{suppressCategoryClick=false},350);
    }
    dragInfo=null;
  };
  button.addEventListener("pointerup",finish);
  button.addEventListener("pointercancel",finish);
  button.addEventListener("lostpointercapture",e=>{
    if(dragInfo&&dragInfo.button===button&&dragInfo.pointerId===e.pointerId)finish(e);
  });
}

/* NOTES LIST */
function renderNotes(){
  const grid=$("notesGrid");
  grid.innerHTML="";
  const search=$("searchInput").value.trim();
  const terms=search.toLowerCase().split(/\s+/).filter(Boolean);
  const list=notes.filter(n=>!favoritesOnly||n.favorite)
    .filter(n=>activeCategory==="All Notes"||n.category===activeCategory)
    .filter(n=>{
      if(!terms.length)return true;
      const searchable=[n.title||"",plainText(n.content),n.category||""].join(" ").toLowerCase();
      return terms.every(term=>searchable.includes(term));
    })
    .sort((a,b)=>(Number(!!b.pinned)-Number(!!a.pinned))||((b.updated||0)-(a.updated||0)));

  $("notesCount").textContent=(favoritesOnly?"Favorite notes":activeCategory==="All Notes"?"Your notes":activeCategory)+" · "+list.length;

  list.forEach(n=>{
    const card=document.createElement("article");
    card.className="note-card"+(n.pinned?" pinned":"");
    const title=document.createElement("div");
    title.className="note-card-title";
    const titleText=n.title||"Untitled note";
    title.innerHTML=search?highlightSearchTerms(titleText,search):esc(titleText);

    const preview=document.createElement("div");
    preview.className="note-card-preview";
    const previewText=plainText(n.content)||"No content yet";
    preview.innerHTML=search?highlightSearchTerms(previewText,search):esc(previewText);

    const meta=document.createElement("div");
    meta.className="note-card-meta";
    const cat=document.createElement("span");
    cat.textContent=n.category||"Personal";
    const date=document.createElement("span");
    date.textContent="· "+new Date(n.updated||Date.now()).toLocaleDateString();
    meta.append(cat,date);
    card.append(title,preview,meta);

    const pin=document.createElement("button");
    pin.type="button";
    pin.className="note-pin"+(n.pinned?" is-pinned":"");
    pin.textContent=n.pinned?"📌":"♧";
    pin.title=n.pinned?"Unpin note":"Pin to top";
    pin.setAttribute("aria-label",n.pinned?"Unpin note":"Pin note to top");
    pin.setAttribute("aria-pressed",String(!!n.pinned));
    pin.addEventListener("click",e=>{
      e.stopPropagation();
      togglePin(n.id);
    });
    card.appendChild(pin);

    if(n.favorite){
      const star=document.createElement("span");
      star.className="note-fav";
      star.textContent="★";
      card.appendChild(star);
    }
    card.addEventListener("click",()=>openNote(n.id));
    grid.appendChild(card);
  });
  $("emptyState").classList.toggle("hidden",list.length!==0);
}

function openNote(id){
  currentNoteId=id;
  const n=currentNote();
  if(!n)return;
  clearReadMarker();
  noteTitle.value=n.title||"";
  noteBody.innerHTML=n.content||"";
  noteBody.dataset.fontSize=String(n.fontSize||17);
  noteBody.style.fontSize=(n.fontSize||17)+"px";
  noteBody.style.color=n.color||"#111827";
  noteBody.style.paddingBottom="120px";
  home.classList.add("hidden");
  editor.classList.remove("hidden");
  menu.classList.add("hidden");
  closePalette();
  setMode(false);
  updatePinMenu();
  noteBody.scrollTop=0;
  clearTimeout(saveStatusTimer);
  setSaveStatus("saved");
}
function newNote(){
  const cat=activeCategory!=="All Notes"&&categories.includes(activeCategory)
    ?activeCategory:(categories.find(c=>c!=="All Notes")||"Personal");
  const n={
    id:makeId(),title:"",content:"",category:cat,
    favorite:false,pinned:false,fontSize:17,color:"#111827",updated:Date.now()
  };
  notes.unshift(n);
  persist();
  openNote(n.id);
  setMode(true);
  setTimeout(()=>noteTitle.focus(),100);
}
function closeEditor(){
  clearReadMarker();
  saveCurrentNote();
  closePalette();
  editor.classList.add("hidden");
  toolbar.classList.add("hidden");
  menu.classList.add("hidden");
  home.classList.remove("hidden");
  noteBody.style.paddingBottom="120px";
  currentNoteId=null;
  renderCategories();
  renderNotes();
}
function setMode(edit){
  clearReadMarker();
  isEditMode=!!edit;
  if(!isEditMode){
    saveCurrentNote();
    closePalette();
  }
  noteTitle.readOnly=!isEditMode;
  noteBody.contentEditable=isEditMode?"true":"false";
  $("modeLabel").textContent=isEditMode?"EDIT":"READ";
  $("menuMode").textContent=isEditMode?"Read Mode":"Edit Mode";
  toolbar.classList.toggle("hidden",!isEditMode);
  if(isEditMode){
    updateToolbarPosition();
    updateNoteBottomSpace();
    requestAnimationFrame(()=>scheduleTypingScroll());
  }else{
    toolbar.style.bottom="0px";
    noteBody.style.paddingBottom="120px";
  }
}

/* READ MODE WORD MARKER */
function clearReadMarker(){
  noteBody.querySelectorAll(".read-word-marker").forEach(old=>old.replaceWith(...old.childNodes));
  markerSpan=null;
}
function getRangeAtPoint(e){
  if(document.caretRangeFromPoint)return document.caretRangeFromPoint(e.clientX,e.clientY);
  if(document.caretPositionFromPoint){
    const p=document.caretPositionFromPoint(e.clientX,e.clientY);
    if(p){
      const r=document.createRange();
      r.setStart(p.offsetNode,p.offset);
      r.collapse(true);
      return r;
    }
  }
  return null;
}
function isWordChar(c){return !!c&&/[\p{L}\p{N}_'-]/u.test(c)}
function markWordAtPoint(e){
  if(isEditMode||e.target.closest("button,input,a,select,textarea"))return;
  const r=getRangeAtPoint(e);
  if(!r||r.startContainer.nodeType!==Node.TEXT_NODE)return;
  const node=r.startContainer,text=node.textContent||"";
  if(!text.length)return;
  let start=Math.min(r.startOffset,text.length-1);
  if(!isWordChar(text[start])&&start>0&&isWordChar(text[start-1]))start--;
  if(!isWordChar(text[start]))return;
  let end=start;
  while(start>0&&isWordChar(text[start-1]))start--;
  while(end<text.length&&isWordChar(text[end]))end++;
  clearReadMarker();
  try{
    const wr=document.createRange();
    wr.setStart(node,start);
    wr.setEnd(node,end);
    const span=document.createElement("span");
    span.className="read-word-marker";
    wr.surroundContents(span);
    markerSpan=span;
  }catch(err){}
}
noteBody.addEventListener("click",markWordAtPoint);

/* TEXT SELECTION AND EDITING */
function saveSelection(){
  const s=window.getSelection();
  if(!s||!s.rangeCount)return;
  const r=s.getRangeAt(0);
  if(noteBody.contains(r.commonAncestorContainer))savedSelection=r.cloneRange();
}
function restoreSelection(){
  if(!savedSelection)return;
  try{
    noteBody.focus({preventScroll:true});
    const s=window.getSelection();
    s.removeAllRanges();
    s.addRange(savedSelection);
  }catch(e){}
}
function applyCommand(command,value=null){
  if(!isEditMode)setMode(true);
  restoreSelection();
  try{
    noteBody.focus({preventScroll:true});
    document.execCommand(command,false,value);
  }catch(e){}
  saveCurrentNote();
  saveSelection();
}
function applyHistoryCommand(command){
  if(!isEditMode||!currentNote())return;
  restoreSelection();
  const previousScrollTop=noteBody.scrollTop;
  try{
    noteBody.focus({preventScroll:true});
    document.execCommand(command,false,null);
  }catch(e){}
  saveSelection();
  saveCurrentNote();
  requestAnimationFrame(()=>{noteBody.scrollTop=previousScrollTop});
}
function openPalette(type){
  if(!isEditMode)setMode(true);
  saveSelection();
  paletteType=type;
  $("paletteTitle").textContent=type==="highlight"?"Choose highlight color":"Choose font color";
  const holder=$("paletteColors");
  holder.innerHTML="";
  COLORS.forEach(color=>{
    const b=document.createElement("button");
    b.className="color-swatch";
    b.style.background=color.value;
    b.title=color.name;
    b.setAttribute("aria-label",color.name);
    b.addEventListener("mousedown",e=>e.preventDefault());
    b.addEventListener("click",()=>{
      restoreSelection();
      try{noteBody.focus({preventScroll:true})}catch(e){}
      if(type==="highlight"){
        try{document.execCommand("hiliteColor",false,color.value)}
        catch(e){try{document.execCommand("backColor",false,color.value)}catch(ignore){}}
      }else{
        try{document.execCommand("foreColor",false,color.value)}catch(e){}
        $("btnTextColor").style.color=color.value;
      }
      saveCurrentNote();
      saveSelection();
      closePalette();
    });
    holder.appendChild(b);
  });
  palette.classList.remove("hidden");
  updateToolbarPosition();
}
function closePalette(){palette.classList.add("hidden")}
function changeFontSize(delta){
  const n=currentNote();
  if(!n)return;
  let size=parseInt(noteBody.dataset.fontSize||n.fontSize||17,10);
  size=Math.max(12,Math.min(36,size+delta));
  noteBody.dataset.fontSize=String(size);
  noteBody.style.fontSize=size+"px";
  n.fontSize=size;
  saveCurrentNote();
}
function copyCurrentNote(){
  const n=currentNote();
  if(!n)return;
  const text=(noteTitle.value.trim()?noteTitle.value.trim()+"\n\n":"")+plainText(noteBody.innerHTML);
  if(navigator.clipboard?.writeText){
    navigator.clipboard.writeText(text).then(()=>showToast("Note copied"),()=>fallbackCopy(text));
  }else fallbackCopy(text);
}
function fallbackCopy(text){
  const area=document.createElement("textarea");
  area.value=text;
  area.style.position="fixed";
  area.style.opacity="0";
  document.body.appendChild(area);
  area.select();
  try{
    document.execCommand("copy");
    showToast("Note copied");
  }catch(e){showToast("Copy not available")}
  area.remove();
}

/* DIALOGS AND CATEGORY MANAGEMENT */
function openDialog(title,content,action,label="Save",danger=false){
  $("dialogTitle").textContent=title;
  $("dialogContent").innerHTML=content;
  $("dialogConfirm").textContent=label;
  $("dialogConfirm").classList.toggle("danger",danger);
  $("dialogBackdrop").classList.remove("hidden");
  dialogAction=action;
}
function closeDialog(){
  $("dialogBackdrop").classList.add("hidden");
  $("dialogContent").innerHTML="";
  dialogAction=null;
}
function addCategoryDialog(){
  openDialog("Add Category",'<input id="dialogCategoryName" maxlength="35" placeholder="Category name" autocomplete="off">',()=>{
    const name=$("dialogCategoryName").value.trim();
    if(!name){showToast("Enter a category name");return false}
    if(categories.some(c=>c.toLowerCase()===name.toLowerCase())){
      showToast("Category already exists");
      return false;
    }
    categories.push(name);
    activeCategory=name;
    favoritesOnly=false;
    persist();
    renderCategories();
    renderNotes();
    return true;
  });
  setTimeout(()=>$("dialogCategoryName")?.focus(),50);
}
function moveCategoryDialog(){
  const n=currentNote();
  if(!n)return;
  const options=categories.filter(c=>c!=="All Notes")
    .map(c=>`<option value="${esc(c)}" ${c===n.category?"selected":""}>${esc(c)}</option>`).join("");
  openDialog("Move to Category",`<select id="dialogMoveCategory">${options}</select>`,()=>{
    const cat=$("dialogMoveCategory").value;
    if(!cat)return false;
    n.category=cat;
    n.updated=Date.now();
    persist();
    renderCategories();
    renderNotes();
    showToast("Moved to "+cat);
    return true;
  });
}
function deleteCurrentNote(){
  const n=currentNote();
  if(!n)return;
  openDialog("Delete Note",`<p style="line-height:1.5;color:#4b5563">Delete “${esc(n.title||"Untitled note")}”? This cannot be undone.</p>`,()=>{
    notes=notes.filter(x=>x.id!==currentNoteId);
    persist();
    closeDialog();
    closeEditor();
    showToast("Note deleted");
    return false;
  },"Delete",true);
}
function toggleFavorite(){
  const n=currentNote();
  if(!n)return;
  n.favorite=!n.favorite;
  n.updated=Date.now();
  persist();
  $("menuFavorite").textContent=n.favorite?"★ Remove Favorite":"☆ Favorite";
  renderNotes();
  menu.classList.add("hidden");
  showToast(n.favorite?"Added to favorites":"Removed from favorites");
}
function showFavorites(){
  activeCategory="All Notes";
  favoritesOnly=true;
  renderCategories();
  renderNotes();
  closeDrawer();
}
function openDrawer(){$("drawerBackdrop").classList.remove("hidden")}
function closeDrawer(){$("drawerBackdrop").classList.add("hidden")}

/* EXPORT BACKUP INCLUDING LOGO */
function exportNotes(){
  try{
    const backup={
      app:"Preach Mate",
      version:2,
      exportedAt:new Date().toISOString(),
      categories:categories,
      notes:notes,
      logo:safeStorageGet(LOGO_KEY)
    };
    const blob=new Blob([JSON.stringify(backup,null,2)],{type:"application/json"});
    const url=URL.createObjectURL(blob);
    const a=document.createElement("a");
    a.href=url;
    a.download="preach-mate-backup.json";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(()=>URL.revokeObjectURL(url),1500);
    closeDrawer();
    showToast("Backup exported, including logo!");
  }catch(e){
    showToast("Unable to create backup.");
  }
}

function restoreNotesFromFile(file){
  if(!file)return;
  const reader=new FileReader();
  reader.onerror=()=>showToast("Unable to read backup file.");
  reader.onload=()=>{
    try{
      const data=JSON.parse(reader.result);
      if(!data||!Array.isArray(data.notes)||!Array.isArray(data.categories)){
        showToast("Invalid Preach Mate backup file.");
        return;
      }
      const validNotes=data.notes.every(n=>
        n&&typeof n.id==="string"&&typeof n.title==="string"&&typeof n.content==="string"
      );
      const validCategories=data.categories.every(c=>
        typeof c==="string"&&c.trim().length>0
      );
      if(!validNotes||!validCategories){
        showToast("Backup data is invalid.");
        return;
      }
      openDialog("Restore Backup?",`<p style="line-height:1.5;color:#4b5563">
        This will replace your current notes and categories with the selected backup.
        <br><br>Notes in backup: <b>${data.notes.length}</b>
        <br>Categories in backup: <b>${data.categories.length}</b>
        <br><br>The logo will also be restored if this backup contains one.
      </p>`,()=>{
        const oldNotes=notes;
        const oldCategories=categories;
        const oldActiveCategory=activeCategory;
        const oldFavoritesOnly=favoritesOnly;
        const oldLogo=safeStorageGet(LOGO_KEY);

        notes=data.notes.map(n=>({...n,favorite:!!n.favorite,pinned:!!n.pinned}));
        categories=["All Notes",...new Set(data.categories.map(c=>c.trim()).filter(c=>c&&c!=="All Notes"))];
        notes.forEach(n=>{
          if(n.category&&n.category!=="All Notes"&&!categories.includes(n.category)){
            categories.push(n.category);
          }
        });

        if(typeof data.logo==="string"&&data.logo.startsWith("data:image/")){
          if(!safeStorageSet(LOGO_KEY,data.logo)){
            notes=oldNotes;
            categories=oldCategories;
            safeStorageSet(LOGO_KEY,oldLogo||"");
            showToast("Could not restore logo. Storage may be full.");
            return false;
          }
        }

        if(!persist()){
          notes=oldNotes;
          categories=oldCategories;
          activeCategory=oldActiveCategory;
          favoritesOnly=oldFavoritesOnly;
          if(oldLogo)safeStorageSet(LOGO_KEY,oldLogo);
          else try{localStorage.removeItem(LOGO_KEY)}catch(e){}
          return false;
        }

        activeCategory="All Notes";
        favoritesOnly=false;
        $("searchInput").value="";
        applySavedLogo();
        renderCategories();
        renderNotes();
        closeDrawer();
        flushDurableBackup();
        showToast("Backup restored successfully!");
        return true;
      },"Restore",true);
    }catch(e){
      showToast("Invalid or damaged backup file.");
    }
  };
  reader.readAsText(file);
}

/* TOOLBAR POSITION */
function updateToolbarPosition(){
  if(!isEditMode||editor.classList.contains("hidden")){
    toolbar.classList.add("hidden");
    return;
  }
  toolbar.classList.remove("hidden");
  let bottom=0;
  if(vv){
    const gap=Math.max(0,window.innerHeight-vv.height-vv.offsetTop);
    bottom=vv.height<window.innerHeight*.82?gap:0;
  }
  toolbar.style.bottom=bottom+"px";
  if(!palette.classList.contains("hidden"))palette.style.bottom=(bottom+55)+"px";
}

/* AUTO-SCROLL FIX */
let typingScrollFrame=0,typingScrollFrame2=0;
let pasteScrollPending=false,pasteScrollToken=0;

function updateNoteBottomSpace(){
  if(!noteBody||!toolbar)return;
  const viewportHeight=vv?vv.height:window.innerHeight;
  const toolbarHeight=toolbar.classList.contains("hidden")?0:toolbar.getBoundingClientRect().height;
  const extraSpace=Math.max(120,viewportHeight-toolbarHeight);
  noteBody.style.paddingBottom=`calc(${Math.ceil(extraSpace)}px + env(safe-area-inset-bottom))`;
}
function getVisibleTypingArea(){
  const bodyRect=noteBody.getBoundingClientRect();
  const viewportTop=vv?vv.offsetTop:0;
  const viewportBottom=vv?vv.offsetTop+vv.height:window.innerHeight;
  const toolbarTop=toolbar.classList.contains("hidden")?viewportBottom:toolbar.getBoundingClientRect().top;
  const visibleTop=Math.max(bodyRect.top,viewportTop)+8;
  const visibleBottom=Math.min(bodyRect.bottom,toolbarTop,viewportBottom)-8;
  if(visibleBottom<=visibleTop)return null;
  return{visibleTop,visibleBottom,targetY:visibleTop+(visibleBottom-visibleTop)*0.65};
}
function getTypingCaretRect(){
  const selection=window.getSelection();
  if(!selection||!selection.rangeCount)return null;
  const range=selection.getRangeAt(0);
  if(!range.collapsed||!noteBody.contains(range.startContainer))return null;
  const caretRect=range.getBoundingClientRect();
  if(caretRect.height>0)return caretRect;
  const node=range.startContainer;
  if(node.nodeType===Node.TEXT_NODE&&node.textContent.length){
    const length=node.textContent.length;
    const offset=Math.max(0,Math.min(range.startOffset,length-1));
    const probe=document.createRange();
    probe.setStart(node,offset);
    probe.setEnd(node,Math.min(offset+1,length));
    const rects=probe.getClientRects();
    if(rects.length){
      const r=rects[rects.length-1];
      return{top:r.top,bottom:r.bottom,height:r.height,left:r.left,right:r.right,width:r.width};
    }
  }
  if(node.nodeType===Node.ELEMENT_NODE&&range.startOffset>0){
    const previous=node.childNodes[range.startOffset-1];
    if(previous){
      const probe=document.createRange();
      try{
        if(previous.nodeType===Node.TEXT_NODE&&previous.length){
          probe.setStart(previous,previous.length-1);
          probe.setEnd(previous,previous.length);
        }else{
          probe.selectNodeContents(previous);
          probe.collapse(false);
        }
        const r=probe.getBoundingClientRect();
        if(r.height>0)return r;
      }catch(e){}
    }
  }
  return null;
}
function keepTypingLineVisible(){
  if(pasteScrollPending||!isEditMode||editor.classList.contains("hidden")||document.activeElement!==noteBody)return;
  const caret=getTypingCaretRect(),area=getVisibleTypingArea();
  if(!caret||!area)return;
  if(caret.bottom>area.visibleBottom-2){
    noteBody.scrollTop+=caret.bottom-(area.visibleBottom-2);
    return;
  }
  if(caret.top<area.visibleTop)noteBody.scrollTop-=area.visibleTop-caret.top;
}
function scheduleTypingScroll(){
  if(pasteScrollPending)return;
  if(typingScrollFrame){cancelAnimationFrame(typingScrollFrame);typingScrollFrame=0}
  if(typingScrollFrame2){cancelAnimationFrame(typingScrollFrame2);typingScrollFrame2=0}
  typingScrollFrame=requestAnimationFrame(()=>{
    typingScrollFrame=0;
    typingScrollFrame2=requestAnimationFrame(()=>{
      typingScrollFrame2=0;
      keepTypingLineVisible();
    });
  });
}
function keepPastedTailAtTarget(){
  if(!isEditMode||editor.classList.contains("hidden")||document.activeElement!==noteBody)return false;
  const caret=getTypingCaretRect(),area=getVisibleTypingArea();
  if(!caret||!area)return false;
  const difference=caret.bottom-area.targetY;
  if(Math.abs(difference)>1)noteBody.scrollTop+=difference;
  return true;
}
function schedulePasteTailScroll(){
  pasteScrollPending=true;
  const token=++pasteScrollToken;
  setTimeout(()=>{
    if(token!==pasteScrollToken)return;
    updateToolbarPosition();
    updateNoteBottomSpace();
    let attempts=0;
    function positionPastedTail(){
      if(token!==pasteScrollToken)return;
      updateToolbarPosition();
      updateNoteBottomSpace();
      const positioned=keepPastedTailAtTarget();
      if(positioned||attempts>=8){
        pasteScrollPending=false;
        scheduleTypingScroll();
        return;
      }
      attempts++;
      requestAnimationFrame(positionPastedTail);
    }
    requestAnimationFrame(()=>requestAnimationFrame(positionPastedTail));
  },0);
}
noteBody.addEventListener("paste",schedulePasteTailScroll);
noteBody.addEventListener("input",scheduleTypingScroll);
noteBody.addEventListener("keyup",scheduleTypingScroll);
noteBody.addEventListener("click",scheduleTypingScroll);
noteBody.addEventListener("focus",scheduleTypingScroll);

if(vv){
  vv.addEventListener("resize",()=>{
    updateToolbarPosition();
    updateNoteBottomSpace();
    scheduleTypingScroll();
  });
  vv.addEventListener("scroll",()=>{
    updateToolbarPosition();
    updateNoteBottomSpace();
  });
}

["btnBold","btnItalic","btnUnderline","btnHighlight","btnTextColor"].forEach(id=>{
  $(id).addEventListener("mousedown",e=>e.preventDefault());
});
toolbar.querySelectorAll("button").forEach(b=>{
  b.addEventListener("mousedown",e=>{e.preventDefault();saveSelection()});
  b.addEventListener("touchstart",saveSelection,{passive:true});
});
$("btnUndo").addEventListener("click",()=>applyHistoryCommand("undo"));
$("btnRedo").addEventListener("click",()=>applyHistoryCommand("redo"));
$("btnBold").addEventListener("click",()=>applyCommand("bold"));
$("btnItalic").addEventListener("click",()=>applyCommand("italic"));
$("btnUnderline").addEventListener("click",()=>applyCommand("underline"));
$("btnHighlight").addEventListener("click",()=>openPalette("highlight"));
$("btnTextColor").addEventListener("click",()=>openPalette("font"));
$("btnFontMinus").addEventListener("click",()=>changeFontSize(-1));
$("btnFontPlus").addEventListener("click",()=>changeFontSize(1));
$("paletteClose").addEventListener("click",closePalette);
noteBody.addEventListener("keyup",saveSelection);
noteBody.addEventListener("mouseup",saveSelection);
noteBody.addEventListener("input",()=>{if(isEditMode)saveCurrentNote()});
noteTitle.addEventListener("input",()=>{if(isEditMode)saveCurrentNote()});

/* MAIN BUTTONS AND MENUS */
$("btnNewNote").addEventListener("click",newNote);
$("btnBack").addEventListener("click",closeEditor);
$("btnCopy").addEventListener("click",copyCurrentNote);
$("btnMenu").addEventListener("click",e=>{
  e.stopPropagation();
  const n=currentNote();
  if(n){
    $("menuFavorite").textContent=n.favorite?"★ Remove Favorite":"☆ Favorite";
    updatePinMenu();
  }
  menu.classList.toggle("hidden");
});
document.addEventListener("click",e=>{
  if(menu.classList.contains("hidden"))return;
  if(!menu.contains(e.target)&&!e.target.closest("#btnMenu"))menu.classList.add("hidden");
});
$("menuMode").addEventListener("click",()=>setMode(!isEditMode));
$("menuMove").addEventListener("click",()=>{
  menu.classList.add("hidden");
  moveCategoryDialog();
});
$("menuPin").addEventListener("click",()=>{
  const n=currentNote();
  if(n){
    togglePin(n.id);
    menu.classList.add("hidden");
  }
});
$("menuFavorite").addEventListener("click",toggleFavorite);
$("menuDelete").addEventListener("click",deleteCurrentNote);

$("btnDrawer").addEventListener("click",openDrawer);
$("drawerBackdrop").addEventListener("click",e=>{
  if(e.target===$("drawerBackdrop"))closeDrawer();
});
$("drawerHome").addEventListener("click",()=>{
  activeCategory="All Notes";
  favoritesOnly=false;
  $("searchInput").value="";
  renderCategories();
  renderNotes();
  closeDrawer();
});
$("drawerFavorites").addEventListener("click",showFavorites);
$("drawerNewCategory").addEventListener("click",()=>{
  closeDrawer();
  addCategoryDialog();
});
$("drawerNewNote").addEventListener("click",()=>{
  closeDrawer();
  newNote();
});
$("drawerExport").addEventListener("click",exportNotes);
$("drawerRestore").addEventListener("click",()=>{
  closeDrawer();
  const input=$("restoreFileInput");
  input.value="";
  input.click();
});
$("restoreFileInput").addEventListener("change",e=>{
  const file=e.target.files&&e.target.files[0];
  if(file)restoreNotesFromFile(file);
});
$("btnFavorites").addEventListener("click",showFavorites);
$("searchInput").addEventListener("input",renderNotes);
$("dialogCancel").addEventListener("click",closeDialog);
$("dialogBackdrop").addEventListener("click",e=>{
  if(e.target===$("dialogBackdrop"))closeDialog();
});
$("dialogConfirm").addEventListener("click",()=>{
  if(typeof dialogAction==="function"){
    const result=dialogAction();
    if(result!==false)closeDialog();
  }
});

/* INSTALL BUTTON */
$("drawerInstall").addEventListener("click",async()=>{
  if(isInstalledApp()){
    updateInstallButton();
    return;
  }
  if(deferredInstallPrompt){
    const promptEvent=deferredInstallPrompt;
    deferredInstallPrompt=null;
    try{
      await promptEvent.prompt();
      const choice=await promptEvent.userChoice;
      if(choice&&choice.outcome==="accepted"){
        showToast("Installing Preach Mate…");
      }else{
        showToast("Installation cancelled.");
      }
    }catch(e){
      showToast("To install, use your browser menu.");
    }
    updateInstallButton();
  }else{
    showToast("Open browser menu ⋮ and choose Install app or Add to Home screen.");
  }
});
updateInstallButton();

document.addEventListener("keydown",e=>{
  if(e.key==="Escape"){
    if(!$("dialogBackdrop").classList.contains("hidden"))closeDialog();
    else if(!$("drawerBackdrop").classList.contains("hidden"))closeDrawer();
    else if(!menu.classList.contains("hidden"))menu.classList.add("hidden");
    else if(!editor.classList.contains("hidden"))closeEditor();
  }
  if(e.key==="Enter"&&e.target.id==="dialogCategoryName"){
    e.preventDefault();
    $("dialogConfirm").click();
  }
});

/* ANDROID BACK BUTTON */
let lastHomeBackTime=0,backExitTimer=null;
let allowNativeBack=false,backActionInProgress=false;

function addBackGuard(){
  try{history.pushState({preachMateGuard:true},"",location.href)}catch(e){}
}
function handleAppBack(){
  if(!$("dialogBackdrop").classList.contains("hidden")){closeDialog();return}
  if(!$("drawerBackdrop").classList.contains("hidden")){closeDrawer();return}
  if(palette&&!palette.classList.contains("hidden")){closePalette();return}
  if(!menu.classList.contains("hidden")){menu.classList.add("hidden");return}
  if(!editor.classList.contains("hidden")){
    saveCurrentNote();
    closeEditor();
    lastHomeBackTime=0;
    clearTimeout(backExitTimer);
    return;
  }
  const now=Date.now();
  if(lastHomeBackTime!==0&&now-lastHomeBackTime<=2000){
    lastHomeBackTime=0;
    clearTimeout(backExitTimer);
    allowNativeBack=true;
    backActionInProgress=true;
    setTimeout(()=>{backActionInProgress=false},300);
    return;
  }
  lastHomeBackTime=now;
  showToast("Press back again to exit");
  clearTimeout(backExitTimer);
  backExitTimer=setTimeout(()=>{lastHomeBackTime=0},2000);
}
try{
  history.replaceState({preachMateBase:true},"",location.href);
  addBackGuard();
}catch(e){}
window.addEventListener("popstate",()=>{
  if(allowNativeBack){allowNativeBack=false;return}
  if(backActionInProgress)return;
  handleAppBack();
  if(!allowNativeBack)setTimeout(()=>{if(!allowNativeBack)addBackGuard()},0);
});
window.addEventListener("resize",()=>{
  updateToolbarPosition();
  updateNoteBottomSpace();
  scheduleTypingScroll();
});

/* SAVE BEFORE THE PAGE IS HIDDEN OR CLOSED */
window.addEventListener("pagehide",()=>{
  if(currentNoteId)saveCurrentNote();
  flushDurableBackup();
});
document.addEventListener("visibilitychange",()=>{
  if(document.visibilityState==="hidden"){
    if(currentNoteId)saveCurrentNote();
    flushDurableBackup();
  }
});
window.addEventListener("beforeunload",()=>{
  if(currentNoteId)saveCurrentNote();
});

/* CORRECTED STARTUP WITH INDEXEDDB RECOVERY */
async function startApp(){
  // Ask the browser to reduce automatic storage eviction where supported.
  requestPersistentStorage();

  // Read the existing IndexedDB backup BEFORE saving current/default data.
  const backup=await readDurableBackup();

  // Recover notes only if LocalStorage notes were absent or invalid.
  // A valid empty array means the user intentionally has no notes.
  if(!notesWereStored&&backup&&Array.isArray(backup.notes)){
    notes=backup.notes.filter(n=>n&&typeof n==="object");
    notes.forEach(n=>{
      if(!n.id)n.id=makeId();
      if(typeof n.title!=="string")n.title="";
      if(typeof n.content!=="string")n.content="";
      if(typeof n.pinned!=="boolean")n.pinned=false;
      if(typeof n.favorite!=="boolean")n.favorite=false;
    });
    showToast("Notes recovered from device backup.");
  }

  // Recover categories only when no valid categories were saved locally.
  if(!categoriesWereStored&&backup&&Array.isArray(backup.categories)&&backup.categories.length){
    categories=["All Notes",...backup.categories.filter(c=>typeof c==="string"&&c!=="All Notes")];
  }

  // Restore the logo from IndexedDB if the logo key is missing.
  if(!safeStorageGet(LOGO_KEY)&&backup&&typeof backup.logo==="string"&&backup.logo.startsWith("data:image/")){
    safeStorageSet(LOGO_KEY,backup.logo);
  }

  // Normalize categories and ensure every note has a valid category.
  categories=categories.filter(c=>typeof c==="string"&&c.trim()).map(c=>c.trim());
  categories=["All Notes",...categories.filter(c=>c!=="All Notes")];
  categories=[...new Set(categories)];

  if(!categories.some(c=>c!=="All Notes"))categories.push("Personal");

  notes.forEach(n=>{
    if(!n.category||n.category==="All Notes")n.category=categories.find(c=>c!=="All Notes")||"Personal";
    if(!categories.includes(n.category))categories.push(n.category);
    if(typeof n.favorite!=="boolean")n.favorite=false;
    if(typeof n.pinned!=="boolean")n.pinned=false;
  });

  // Restore first, then render. Persist recovered data back to both stores.
  try{
    localStorage.setItem(STORAGE_KEY,JSON.stringify(notes));
    localStorage.setItem(CATEGORIES_KEY,JSON.stringify(categories));
  }catch(e){}

  renderCategories();
  renderNotes();
  applySavedLogo();
  updateInstallButton();

  // Ensure the latest state is written to IndexedDB.
  await flushDurableBackup();
}
const appStartupPromise = startApp().catch(error => {
  console.error("Preach Mate startup error:", error);
  throw error;
});

/* SERVICE WORKER REGISTRATION */
if("serviceWorker" in navigator){
  window.addEventListener("load",()=>{
    navigator.serviceWorker.register("./sw.js",{scope:"./"})
      .then(registration=>{
        console.log("Preach Mate offline support enabled:",registration.scope);
      })
      .catch(error=>{
        console.error("Preach Mate service worker registration failed:",error);
      });
  });
}

/* END OF PREACH MATE APP */
/* CLOUD SYNC BRIDGE */
window.PreachMateApp = {
  isReady: false,

  getCloudData() {
    return {
      notes: JSON.parse(JSON.stringify(notes)),
      categories: JSON.parse(JSON.stringify(categories)),
      logo: safeStorageGet(LOGO_KEY) || ""
    };
  },

  applyCloudData(data) {
    if (
      !data ||
      !Array.isArray(data.notes) ||
      !Array.isArray(data.categories)
    ) {
      throw new Error("Invalid cloud backup.");
    }

    const previousNotes = notes;
    const previousCategories = categories;

    try {
      notes = data.notes;
      categories = data.categories;

      localStorage.setItem(STORAGE_KEY, JSON.stringify(notes));
      localStorage.setItem(CATEGORIES_KEY, JSON.stringify(categories));

      if (typeof data.logo === "string") {
        if (data.logo.startsWith("data:image/")) {
          localStorage.setItem(LOGO_KEY, data.logo);
        } else if (data.logo === "") {
          localStorage.removeItem(LOGO_KEY);
        }
      }

      applySavedLogo();
      renderCategories();
      renderNotes();
      flushDurableBackup();

      return true;
    } catch (error) {
      notes = previousNotes;
      categories = previousCategories;
      throw new Error(
        "Could not restore cloud data locally: " +
        (error?.message || "Unknown error")
      );
    }
  }
};

/* SIGNAL CLOUD SYNC AFTER APP STARTUP */
appStartupPromise
  .then(() => {
    window.PreachMateApp.isReady = true;

    window.dispatchEvent(
      new Event("preachmate:app-ready")
    );

    console.log("Preach Mate: app ready for cloud sync.");
  })
  .catch(error => {
    window.PreachMateApp.isReady = false;
    console.error("Preach Mate initialization failed:", error);
  });

})();
